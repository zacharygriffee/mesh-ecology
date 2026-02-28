import path from "path";
import b4a from "b4a";
import idEncoding from "hypercore-id-encoding";

import { ensureCorestore } from "../../../src/ensureCorestore.js";
import { ensureDiscoverySurface, KIND } from "../../../src/discovery.js";
import {
  ensureConcernSurface,
  getJobView,
  getPublishView,
  getRatView,
  publishJobWork,
  publishJobRatification
} from "../../../src/concern.js";

const STATE_SCHEMA = "mesh-ecology-packs/state/v1";
const TRACE_SCHEMA = "mesh-ecology-packs/trace/v1";
const SCHEMA_VERSION = 1;

const DEFAULT_STALE_AFTER_S = 300;
const DEFAULT_ATTEMPTS_LIMIT = 10;
const DEFAULT_RATIFIERS_LIMIT = 25;

const NULL_SWARM = {
  connections: new Set(),
  on() {},
  off() {},
  join() {
    return {
      flushed: async () => {},
      destroy() {}
    };
  }
};

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function toPositiveInt(value, fallback) {
  const n = Number(value);
  if (!Number.isFinite(n) || n <= 0) return fallback;
  return Math.floor(n);
}

function assertString(value, label) {
  if (typeof value !== "string" || !value.trim()) {
    throw new Error(`${label} is required`);
  }
  return value.trim();
}

function normalizeKey32(value, label) {
  if (b4a.isBuffer(value)) {
    if (value.length !== 32) throw new Error(`${label} must be 32 bytes`);
    return value;
  }
  const raw = assertString(String(value || ""), label);
  if (/^[0-9a-fA-F]{64}$/.test(raw)) return b4a.from(raw, "hex");
  const decoded = idEncoding.decode(raw);
  if (!decoded || decoded.length !== 32) throw new Error(`${label} must be z32 or 64-hex`);
  return decoded;
}

function encodeKey(key) {
  return idEncoding.encode(normalizeKey32(key, "key"));
}

function unknownArtifact(pathValue = null, withFiles = false) {
  const out = {
    path: pathValue,
    mtimeMs: null,
    ageSeconds: null,
    freshness: "unknown"
  };
  if (withFiles) out.files = [];
  return out;
}

function makeArtifacts(staleAfterS) {
  return {
    summary: {
      freshness: "unknown",
      staleAfterS
    },
    items: {
      session: unknownArtifact(null),
      readcheck: unknownArtifact(null),
      prepare: unknownArtifact(null),
      hostLogs: unknownArtifact(null, true),
      loopLogs: unknownArtifact(null, true)
    }
  };
}

function deriveConcernStage(counts = {}) {
  const jobs = Number.isFinite(counts.jobs) ? counts.jobs : null;
  const pubs = Number.isFinite(counts.pubs) ? counts.pubs : null;
  const rats = Number.isFinite(counts.rats) ? counts.rats : null;
  if (jobs == null || pubs == null || rats == null) return "counts_unavailable";
  if (jobs < 0 || pubs < 0 || rats < 0) return "counts_unavailable";
  if (jobs === 0) return "no_jobs";
  if (pubs === 0) return "jobs_present_pub_missing";
  if (rats === 0) return "pub_materialized_rat_missing";
  return "rat_materialized";
}

function deriveTraceStage(jobPresent, attempts) {
  if (!jobPresent) return "job_missing";
  if (!Array.isArray(attempts) || attempts.length === 0) return "job_present_pub_missing";
  if (attempts.some((row) => Array.isArray(row.ratifiers) && row.ratifiers.length > 0)) return "rat_present";
  return "pub_present_rat_missing";
}

async function countEntries(view) {
  let count = 0;
  for await (const _entry of view.createReadStream()) count += 1;
  return count;
}

async function joinTopic(swarm, topicBuf) {
  if (!swarm || typeof swarm.join !== "function") return null;
  let handle = null;
  try {
    handle = swarm.join(topicBuf, { server: true, client: true });
  } catch {
    handle = swarm.join(topicBuf);
  }
  if (handle && typeof handle.flushed === "function") {
    await Promise.race([handle.flushed(), delay(60)]).catch(() => {});
  }
  return handle;
}

async function closeMaybe(obj) {
  if (!obj) return;
  await obj.close?.().catch(() => {});
}

function normalizeConcernList(values) {
  if (!values) return [];
  const raw = Array.isArray(values) ? values : String(values).split(",");
  const keys = [];
  for (const value of raw) {
    const trimmed = String(value || "").trim();
    if (!trimmed) continue;
    keys.push(encodeKey(trimmed));
  }
  return Array.from(new Set(keys));
}

function normalizeRef(ref, { jobKeyBuf, attemptBuf }) {
  if (!ref || typeof ref !== "object") throw new Error("ref is required");
  const out = {
    t: assertString(String(ref.t || ""), "ref.t"),
    k: jobKeyBuf,
    p: ref.p,
    a: attemptBuf
  };
  if (ref.h != null) out.h = normalizeKey32(ref.h, "ref.h");
  return out;
}

function matchAttempt(attempt, { attemptToken, organismKey }) {
  if (attemptToken && attempt.attemptToken !== attemptToken) return false;
  if (organismKey && attempt.organismKey !== organismKey) return false;
  return true;
}

function materialized(attempts, { kind, attemptToken = null, organismKey = null, ratifierKey = null }) {
  const filtered = attempts.filter((row) => matchAttempt(row, { attemptToken, organismKey }));
  if (kind === "pub") return filtered.some((row) => row.pubPresent);
  if (kind === "rat") {
    if (!ratifierKey) return filtered.some((row) => row.ratifiers.length > 0);
    return filtered.some((row) => row.ratifiers.includes(ratifierKey));
  }
  return false;
}

function createMeshClient(config = {}) {
  const storeRoot = path.resolve(assertString(String(config.storeRoot || ""), "storeRoot"));
  const discoveryKey = config.discoveryKey ? encodeKey(config.discoveryKey) : null;
  const mode = String(config.mode || "optimistic").trim().toLowerCase() === "trusted" ? "trusted" : "optimistic";
  const noDoctor = config.noDoctor !== false;
  const staleAfterS = toPositiveInt(config.staleAfterS, DEFAULT_STALE_AFTER_S);
  const initialConcernKeys = normalizeConcernList(config.concernKeys);
  const swarm = config.swarm || NULL_SWARM;
  const ownsSwarm = !config.swarm;

  let corestore = null;
  let discoveryBase = null;
  const concernBases = new Map();

  async function ensureReady() {
    if (corestore) return;
    corestore = ensureCorestore(storeRoot);
    await corestore.ready?.();
  }

  async function getDiscoveryBase() {
    if (!discoveryKey) return null;
    await ensureReady();
    if (discoveryBase) return discoveryBase;
    const keyBuf = normalizeKey32(discoveryKey, "discoveryKey");
    const namespace = `sdk-disc-${discoveryKey}`;
    discoveryBase = await ensureDiscoverySurface(corestore.namespace(namespace), { key: keyBuf }, swarm);
    await joinTopic(swarm, discoveryBase.discoveryKey);
    await discoveryBase.update({ wait: false }).catch(() => {});
    return discoveryBase;
  }

  async function getConcernBase(concernKey) {
    await ensureReady();
    const keyBuf = normalizeKey32(concernKey, "concernKey");
    const keyZ32 = idEncoding.encode(keyBuf);
    if (concernBases.has(keyZ32)) return concernBases.get(keyZ32);
    const namespace = `concern-${b4a.toString(keyBuf, "hex")}`;
    const base = await ensureConcernSurface(corestore.namespace(namespace), swarm, { key: keyBuf });
    concernBases.set(keyZ32, base);
    await joinTopic(swarm, base.discoveryKey);
    await base.update({ wait: false }).catch(() => {});
    return base;
  }

  async function scanDiscoveryConcerns() {
    const disc = await getDiscoveryBase();
    if (!disc) return [];
    await disc.update({ wait: false }).catch(() => {});

    const seen = new Map();
    for await (const row of disc.view.createReadStream()) {
      if (!row || row.t !== KIND.CONCERN || !row.k32) continue;
      const key = idEncoding.encode(row.k32);
      if (seen.has(key)) continue;
      seen.set(key, {
        key,
        label: typeof row.v === "string" && row.v ? row.v : null,
        source: "discovery"
      });
    }
    return Array.from(seen.values());
  }

  async function resolveTargets(overrideConcernKeys) {
    const override = normalizeConcernList(overrideConcernKeys);
    if (override.length) {
      return {
        discoveryScan: false,
        source: "config",
        concerns: override.map((key) => ({ key, label: null, source: "config" }))
      };
    }
    if (initialConcernKeys.length) {
      return {
        discoveryScan: false,
        source: "config",
        concerns: initialConcernKeys.map((key) => ({ key, label: null, source: "config" }))
      };
    }
    if (discoveryKey) {
      const concerns = await scanDiscoveryConcerns();
      return {
        discoveryScan: true,
        source: "discovery",
        concerns
      };
    }
    return {
      discoveryScan: false,
      source: "config",
      concerns: []
    };
  }

  async function collectState({ overrideConcernKeys = null } = {}) {
    await ensureReady();
    const targets = await resolveTargets(overrideConcernKeys);
    const concerns = [];

    for (const target of targets.concerns) {
      const concernsRow = {
        key: target.key,
        label: target.label || null,
        namespace: `concern-${b4a.toString(normalizeKey32(target.key, "concernKey"), "hex")}`,
        source: "unknown",
        counts: { jobs: null, pubs: null, rats: null, connections: null },
        stage: "counts_unavailable",
        hints: [],
        processes: {
          hostAlive: null,
          orgLoopAlive: null,
          ratLoopAlive: null
        },
        errors: {
          publishErrorCount: 0,
          rejectedPub: 0,
          rejectedRat: 0
        }
      };

      try {
        const base = await getConcernBase(target.key);
        await base.update({ wait: false }).catch(() => {});
        concernsRow.source = "view";
        concernsRow.counts.jobs = await countEntries(getJobView(base));
        concernsRow.counts.pubs = await countEntries(getPublishView(base));
        concernsRow.counts.rats = await countEntries(getRatView(base));
        concernsRow.stage = deriveConcernStage(concernsRow.counts);
      } catch (err) {
        concernsRow.hints.push("view_unavailable");
        concernsRow.error = err?.message || String(err);
      }

      concerns.push(concernsRow);
    }

    const stageCounts = concerns.reduce((acc, row) => {
      acc[row.stage] = (acc[row.stage] || 0) + 1;
      return acc;
    }, {});

    return {
      ok: true,
      command: "state",
      schema: STATE_SCHEMA,
      schemaVersion: SCHEMA_VERSION,
      mode,
      flags: {
        noDoctor,
        staleAfterS
      },
      topology: {
        discoveryScan: targets.discoveryScan,
        concernKeys: concerns.map((row) => row.key),
        source: targets.source
      },
      sideEffects: [
        "mesh-sdk is non-mutating: no writer admission, no process lifecycle control, no doctor artifacts"
      ],
      artifacts: makeArtifacts(staleAfterS),
      checks: [
        {
          id: "doctor",
          ok: null,
          note: "mesh-sdk does not run doctor checks",
          detail: "operator diagnostics remain in CLI tooling"
        }
      ],
      processes: [],
      concerns,
      summary: {
        concerns: concerns.length,
        stages: stageCounts
      }
    };
  }

  async function state(_options = {}) {
    return collectState({});
  }

  async function trace({
    jobKey,
    concernKeys = null,
    attemptsLimit = DEFAULT_ATTEMPTS_LIMIT,
    ratifiersLimit = DEFAULT_RATIFIERS_LIMIT
  } = {}) {
    const jobKeyBuf = normalizeKey32(jobKey, "jobKey");
    const jobKeyZ32 = idEncoding.encode(jobKeyBuf);
    const attemptsCap = toPositiveInt(attemptsLimit, DEFAULT_ATTEMPTS_LIMIT);
    const ratifiersCap = toPositiveInt(ratifiersLimit, DEFAULT_RATIFIERS_LIMIT);

    const baseState = await collectState({ overrideConcernKeys: concernKeys });
    const concerns = [];

    for (const concernState of baseState.concerns) {
      const key = concernState.key;
      try {
        const base = await getConcernBase(key);
        await base.update({ wait: false }).catch(() => {});

        const jobView = getJobView(base);
        const publishView = getPublishView(base);
        const ratView = getRatView(base);

        const jobPresent = !!(await jobView.get(jobKeyBuf, { valueEncoding: jobView.valueEncoding }).catch(() => null));
        const attemptsMap = new Map();
        const publishSub = publishView.sub(jobKeyBuf);

        for await (const fromEntry of publishSub.createReadStream()) {
          const organismBuf = fromEntry?.key;
          if (!organismBuf || organismBuf.length !== 32) continue;
          const organismKey = idEncoding.encode(organismBuf);
          for await (const { key: attemptKey, value } of publishSub.sub(organismBuf).createReadStream({ valueEncoding: publishView.valueEncoding })) {
            const attemptBuf = value?.ref?.a || attemptKey;
            if (!attemptBuf || attemptBuf.length !== 32) continue;
            const attemptToken = idEncoding.encode(attemptBuf);
            const id = `${organismKey}:${attemptToken}`;
            attemptsMap.set(id, {
              organismKey,
              attemptToken,
              pubPresent: true,
              ratifiers: new Set()
            });
          }
        }

        const ratSub = ratView.sub(jobKeyBuf);
        for await (const ratifierEntry of ratSub.createReadStream()) {
          const ratifierBuf = ratifierEntry?.key;
          if (!ratifierBuf || ratifierBuf.length !== 32) continue;
          const ratifierKey = idEncoding.encode(ratifierBuf);
          const byRatifier = ratSub.sub(ratifierBuf);
          for await (const organismEntry of byRatifier.createReadStream()) {
            const organismBuf = organismEntry?.key;
            if (!organismBuf || organismBuf.length !== 32) continue;
            const organismKey = idEncoding.encode(organismBuf);
            for await (const { key: attemptKey, value } of byRatifier.sub(organismBuf).createReadStream({ valueEncoding: ratView.valueEncoding })) {
              const attemptBuf = value?.ref?.a || attemptKey;
              if (!attemptBuf || attemptBuf.length !== 32) continue;
              const attemptToken = idEncoding.encode(attemptBuf);
              const id = `${organismKey}:${attemptToken}`;
              if (!attemptsMap.has(id)) {
                attemptsMap.set(id, {
                  organismKey,
                  attemptToken,
                  pubPresent: false,
                  ratifiers: new Set()
                });
              }
              attemptsMap.get(id).ratifiers.add(ratifierKey);
            }
          }
        }

        const attemptsSorted = Array.from(attemptsMap.values())
          .map((row) => ({
            organismKey: row.organismKey,
            attemptToken: row.attemptToken,
            pubPresent: row.pubPresent,
            ratifiers: Array.from(row.ratifiers).sort()
          }))
          .sort((a, b) => `${a.organismKey}:${a.attemptToken}`.localeCompare(`${b.organismKey}:${b.attemptToken}`));

        const attemptsTotal = attemptsSorted.length;
        const attempts = attemptsSorted.slice(0, attemptsCap).map((attempt) => {
          const ratifiersTotal = attempt.ratifiers.length;
          const ratifiers = attempt.ratifiers.slice(0, ratifiersCap);
          return {
            ...attempt,
            ratifiers,
            ratifiersTotal,
            ratifiersReturned: ratifiers.length,
            ratifiersLimit: ratifiersCap,
            ratifiersTruncated: ratifiersTotal > ratifiers.length
          };
        });

        concerns.push({
          key,
          label: concernState.label,
          namespace: concernState.namespace,
          source: "view",
          stage: deriveTraceStage(jobPresent, attempts),
          jobPresent,
          attempts,
          attemptsTotal,
          attemptsReturned: attempts.length,
          attemptsLimit: attemptsCap,
          attemptsTruncated: attemptsTotal > attempts.length,
          hints: Array.from(new Set([...(concernState.hints || [])])),
          processes: concernState.processes
        });
      } catch (err) {
        concerns.push({
          key,
          label: concernState.label,
          namespace: concernState.namespace,
          source: "unknown",
          stage: "job_missing",
          jobPresent: false,
          attempts: [],
          attemptsTotal: 0,
          attemptsReturned: 0,
          attemptsLimit: attemptsCap,
          attemptsTruncated: false,
          hints: Array.from(new Set([...(concernState.hints || []), "view_unavailable"])),
          processes: concernState.processes,
          error: err?.message || String(err)
        });
      }
    }

    const stageCounts = concerns.reduce((acc, row) => {
      acc[row.stage] = (acc[row.stage] || 0) + 1;
      return acc;
    }, {});

    return {
      ...baseState,
      command: "trace",
      schema: TRACE_SCHEMA,
      schemaVersion: SCHEMA_VERSION,
      jobKey: jobKeyZ32,
      concerns,
      summary: {
        concerns: concerns.length,
        stages: stageCounts
      }
    };
  }

  async function proposePub({ concernKey, cap, ref, meta } = {}) {
    try {
      const base = await getConcernBase(concernKey);
      const capValue = assertString(String(cap || ""), "cap");
      const jobKeyBuf = normalizeKey32(ref?.k, "ref.k");
      const attemptBuf = normalizeKey32(ref?.a, "ref.a");
      const normalizedRef = normalizeRef(ref, { jobKeyBuf, attemptBuf });
      await publishJobWork(base, jobKeyBuf, capValue, normalizedRef, meta);
      return { ok: true, submitted: true, accepted: false, deduped: false };
    } catch (err) {
      return {
        ok: false,
        submitted: false,
        accepted: false,
        deduped: false,
        error: true,
        message: err?.message || String(err)
      };
    }
  }

  async function proposeRat({
    concernKey,
    jobKey,
    organismKey,
    orgKey,
    attemptToken,
    determination = 1,
    tier = 1,
    cap,
    ref,
    note = ""
  } = {}) {
    try {
      const base = await getConcernBase(concernKey);
      const jobKeyBuf = normalizeKey32(jobKey, "jobKey");
      const orgBuf = normalizeKey32(organismKey || orgKey, "organismKey");
      const attemptBuf = normalizeKey32(attemptToken, "attemptToken");
      const capValue = assertString(String(cap || ""), "cap");
      const normalizedRef = normalizeRef(ref || { t: "result", k: jobKeyBuf, a: attemptBuf }, { jobKeyBuf, attemptBuf });
      await publishJobRatification(
        base,
        jobKeyBuf,
        orgBuf,
        attemptBuf,
        Number(determination) || 1,
        Number(tier) || 1,
        capValue,
        normalizedRef,
        String(note || "")
      );
      return { ok: true, submitted: true, accepted: false, deduped: false };
    } catch (err) {
      return {
        ok: false,
        submitted: false,
        accepted: false,
        deduped: false,
        error: true,
        message: err?.message || String(err)
      };
    }
  }

  async function waitForMaterialization({
    concernKey,
    jobKey,
    kind,
    attemptToken = null,
    organismKey = null,
    ratifierKey = null,
    intervalMs = 500,
    timeoutMs = 15000
  } = {}) {
    const concernZ32 = encodeKey(concernKey);
    const jobZ32 = encodeKey(jobKey);
    if (kind !== "pub" && kind !== "rat") throw new Error("kind must be 'pub' or 'rat'");
    const attemptZ32 = attemptToken ? encodeKey(attemptToken) : null;
    const organismZ32 = organismKey ? encodeKey(organismKey) : null;
    const ratifierZ32 = ratifierKey ? encodeKey(ratifierKey) : null;
    const pollMs = toPositiveInt(intervalMs, 500);
    const maxMs = toPositiveInt(timeoutMs, 15000);
    const start = Date.now();

    while (Date.now() - start <= maxMs) {
      const snapshot = await trace({
        jobKey: jobZ32,
        concernKeys: [concernZ32],
        attemptsLimit: 256,
        ratifiersLimit: 256
      });
      const concern = (snapshot.concerns || [])[0];
      const attempts = Array.isArray(concern?.attempts) ? concern.attempts : [];
      const found = materialized(attempts, {
        kind,
        attemptToken: attemptZ32,
        organismKey: organismZ32,
        ratifierKey: ratifierZ32
      });
      if (found) {
        return {
          ok: true,
          kind,
          found: true,
          concernKey: concernZ32,
          jobKey: jobZ32,
          atMs: Date.now() - start
        };
      }
      await delay(pollMs);
    }

    return {
      ok: false,
      kind,
      found: false,
      timeout: true,
      concernKey: concernZ32,
      jobKey: jobZ32,
      elapsedMs: Date.now() - start
    };
  }

  function watchState({ intervalMs = 1000 } = {}, onState) {
    if (typeof onState !== "function") throw new Error("onState callback is required");
    const everyMs = toPositiveInt(intervalMs, 1000);
    let closed = false;
    let running = false;
    const tick = async () => {
      if (closed || running) return;
      running = true;
      try {
        const snapshot = await state();
        await onState(snapshot);
      } finally {
        running = false;
      }
    };
    const timer = setInterval(() => {
      void tick();
    }, everyMs);
    void tick();
    return () => {
      closed = true;
      clearInterval(timer);
    };
  }

  async function close() {
    for (const base of concernBases.values()) await closeMaybe(base);
    concernBases.clear();
    await closeMaybe(discoveryBase);
    discoveryBase = null;
    await closeMaybe(corestore);
    corestore = null;
    if (ownsSwarm) await closeMaybe(swarm);
  }

  return {
    state,
    trace,
    proposePub,
    proposeRat,
    waitForMaterialization,
    watchState,
    close
  };
}

export { createMeshClient };
