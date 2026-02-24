import path from "path";
import { access } from "fs/promises";
import { pathToFileURL } from "url";
import b4a from "b4a";
import idEncoding from "hypercore-id-encoding";

let cachedModulePath = "";
let cachedResolver = null;

function asBuf32(value, label) {
  const buf = b4a.isBuffer(value) ? value : idEncoding.decode(String(value || ""));
  if (!b4a.isBuffer(buf) || buf.length !== 32) {
    throw new Error(`${label} must be a 32-byte key`);
  }
  return buf;
}

function parsePredicateResult(result) {
  if (result === true) return { shouldRatify: true };
  if (result === false || result == null) return { shouldRatify: false };
  if (typeof result === "object") {
    const shouldRatify = result.ratify === true || result.ok === true;
    const note = typeof result.note === "string" && result.note.length ? result.note : null;
    const cap = typeof result.cap === "string" && result.cap.length ? result.cap : null;
    return { shouldRatify, note, cap };
  }
  return { shouldRatify: false };
}

function marker(jobKey, orgKey, attempt) {
  return `${idEncoding.encode(jobKey)}:${idEncoding.encode(orgKey)}:${idEncoding.encode(attempt)}`;
}

function findPubCap(pub) {
  return typeof pub?.value?.cap === "string" && pub.value.cap.length
    ? pub.value.cap
    : "cap/fn-rat/v1";
}

function normalizeDecision(raw) {
  if (!raw || typeof raw !== "object") throw new Error("decision must be an object");
  const jobKey = asBuf32(raw.jobKey, "decision.jobKey");
  const orgKey = asBuf32(raw.orgKey, "decision.orgKey");
  const attempt = asBuf32(raw.attempt ?? raw.attemptZ32 ?? raw.attemptToken, "decision.attempt");
  const note = typeof raw.note === "string" && raw.note.length ? raw.note : "fn-rat";
  const cap = typeof raw.cap === "string" && raw.cap.length ? raw.cap : null;
  return { jobKey, orgKey, attempt, note, cap };
}

function createAcceptedCtx(ctx, acceptedPubs) {
  return {
    ...ctx,
    pubs: async function* pubsSnapshot() {
      for (const pub of acceptedPubs) yield pub;
    }
  };
}

async function loadFnRatModule() {
  const spec = String(process.env.FN_RAT_MODULE || "").trim();
  if (!spec) throw new Error("FN_RAT_MODULE is required for fn-rat ratifier");

  const resolved = path.resolve(spec);
  if (cachedResolver && cachedModulePath === resolved) {
    return cachedResolver;
  }

  await access(resolved);
  const mod = await import(pathToFileURL(resolved).href);
  const predicate = typeof mod?.shouldRatify === "function" ? mod.shouldRatify : null;
  const run = typeof mod?.default === "function"
    ? mod.default
    : typeof mod?.run === "function"
      ? mod.run
      : null;

  if (!predicate && !run) {
    throw new Error(
      `FN_RAT_MODULE must export shouldRatify(pub, ctx, api) or default/run(ctx, api): ${resolved}`
    );
  }

  const loaded = predicate
    ? { mode: "predicate", fn: predicate }
    : { mode: "decision-list", fn: run };
  cachedModulePath = resolved;
  cachedResolver = loaded;
  return loaded;
}

export default {
  name: "fn-rat",
  async onTick(ctx, api) {
    let loaded = null;
    try {
      loaded = await loadFnRatModule();
    } catch (err) {
      api.log?.("fn-rat module load failed", err?.message || err);
      return;
    }

    const acceptedPubs = [];
    const acceptedByMarker = new Map();
    for await (const pub of ctx.pubs()) {
      let jobKey = null;
      let orgKey = null;
      let attempt = null;
      try {
        jobKey = asBuf32(pub?.jobKey, "pub.jobKey");
        orgKey = asBuf32(pub?.value?.oK, "pub.value.oK");
        attempt = asBuf32(pub?.attempt, "pub.attempt");
      } catch (err) {
        api.log?.("fn-rat skip invalid accepted pub shape", err?.message || err);
        continue;
      }
      acceptedPubs.push(pub);
      acceptedByMarker.set(marker(jobKey, orgKey, attempt), { pub, jobKey, orgKey, attempt });
    }

    if (loaded.mode === "predicate") {
      for (const entry of acceptedByMarker.values()) {
        let decision = null;
        try {
          decision = parsePredicateResult(await loaded.fn(entry.pub, ctx, api));
        } catch (err) {
          api.log?.("fn-rat predicate failed; skipping pub", err?.message || err);
          continue;
        }
        if (!decision.shouldRatify) continue;

        const cap = decision.cap || findPubCap(entry.pub);
        const note = decision.note || "fn-rat";
        await api.publish.rat({
          concernKey: ctx.concern.key,
          jobKey: entry.jobKey,
          orgKey: entry.orgKey,
          attemptZ32: idEncoding.encode(entry.attempt),
          cap,
          note
        });
      }
      return;
    }

    let decisions = null;
    try {
      decisions = await loaded.fn(createAcceptedCtx(ctx, acceptedPubs), api);
    } catch (err) {
      api.log?.("fn-rat decision module failed", err?.message || err);
      return;
    }

    if (decisions == null) return;
    const items = Array.isArray(decisions) ? decisions : [decisions];
    for (const raw of items) {
      let normalized = null;
      try {
        normalized = normalizeDecision(raw);
      } catch (err) {
        api.log?.("fn-rat skip invalid decision", err?.message || err);
        continue;
      }

      const key = marker(normalized.jobKey, normalized.orgKey, normalized.attempt);
      const accepted = acceptedByMarker.get(key);
      if (!accepted) {
        api.log?.("fn-rat skip decision not in accepted ctx.pubs()", key);
        continue;
      }

      const cap = normalized.cap || findPubCap(accepted.pub);
      await api.publish.rat({
        concernKey: ctx.concern.key,
        jobKey: normalized.jobKey,
        orgKey: normalized.orgKey,
        attemptZ32: idEncoding.encode(normalized.attempt),
        cap,
        note: normalized.note
      });
    }
  }
};
