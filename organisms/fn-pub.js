import crypto from "crypto";
import path from "path";
import { access } from "fs/promises";
import { pathToFileURL } from "url";
import b4a from "b4a";
import idEncoding from "hypercore-id-encoding";

let cachedModulePath = "";
let cachedRunnerFn = null;
let tickCounter = 0;

function asBuf32(value, label) {
  const buf = b4a.isBuffer(value) ? value : idEncoding.decode(String(value || ""));
  if (!b4a.isBuffer(buf) || buf.length !== 32) {
    throw new Error(`${label} must be a 32-byte key`);
  }
  return buf;
}

function deriveAttempt(jobKey, tickId, idx) {
  return crypto
    .createHash("sha256")
    .update("mesh/fn-pub/attempt/v1")
    .update(jobKey)
    .update(String(tickId))
    .update(String(idx))
    .digest()
    .subarray(0, 32);
}

async function loadRunnerFn() {
  const spec = String(process.env.FN_PUB_MODULE || "").trim();
  if (!spec) throw new Error("FN_PUB_MODULE is required for fn-pub organism");

  const resolved = path.resolve(spec);
  if (cachedRunnerFn && cachedModulePath === resolved) {
    return cachedRunnerFn;
  }

  await access(resolved);
  const mod = await import(pathToFileURL(resolved).href);
  const fn = typeof mod?.default === "function"
    ? mod.default
    : typeof mod?.run === "function"
      ? mod.run
      : null;

  if (!fn) {
    throw new Error(`FN_PUB_MODULE must export default function or named run(): ${resolved}`);
  }

  cachedModulePath = resolved;
  cachedRunnerFn = fn;
  return fn;
}

export default {
  name: "fn-pub",
  async onTick(ctx, api) {
    let fn = null;
    try {
      fn = await loadRunnerFn();
    } catch (err) {
      api.log?.("fn-pub module load failed", err?.message || err);
      return;
    }

    const tickId = ++tickCounter;
    let out = null;
    try {
      out = await fn(ctx, api);
    } catch (err) {
      api.log?.("fn-pub module run failed", err?.message || err);
      return;
    }

    if (out == null) return;
    const specs = Array.isArray(out) ? out : [out];

    for (let i = 0; i < specs.length; i++) {
      const spec = specs[i];
      if (!spec || typeof spec !== "object") {
        api.log?.("fn-pub skip invalid spec (not object)", spec);
        continue;
      }

      let jobKey = null;
      let refK = null;
      try {
        jobKey = asBuf32(spec.jobKey, "jobKey");
        if (!spec.ref || typeof spec.ref !== "object") throw new Error("ref object required");
        if (typeof spec.ref.t !== "string" || !spec.ref.t.length) throw new Error("ref.t required");
        refK = asBuf32(spec.ref.k, "ref.k");
      } catch (err) {
        api.log?.("fn-pub skip invalid spec shape", err?.message || err);
        continue;
      }

      if (!b4a.equals(jobKey, refK)) {
        api.log?.("fn-pub skip: ref.k must match jobKey");
        continue;
      }

      let attempt = null;
      try {
        attempt = spec.ref.a ? asBuf32(spec.ref.a, "ref.a") : deriveAttempt(jobKey, tickId, i);
      } catch (err) {
        api.log?.("fn-pub skip invalid attempt token", err?.message || err);
        continue;
      }

      const cap = typeof spec.cap === "string" && spec.cap.length ? spec.cap : "cap/fn-pub/v1";
      const meta = spec.meta && typeof spec.meta === "object" ? { ...spec.meta } : {};
      if (!meta.schema || !meta.outUri) {
        api.log?.("fn-pub warning: meta.schema/meta.outUri recommended for traceability");
      }
      if (spec.ref.h != null && meta.refHash == null) meta.refHash = spec.ref.h;
      if (meta.refType == null) meta.refType = spec.ref.t;

      // Proposal only: publish success is not acceptance.
      await api.publish.pub({
        concernKey: ctx.concern.key,
        jobKey,
        cap,
        meta,
        attemptZ32: idEncoding.encode(attempt)
      });
    }
  }
};
