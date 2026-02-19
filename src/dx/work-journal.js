import crypto from "crypto";
import b4a from "b4a";
import idEncoding from "hypercore-id-encoding";

const WORK_PREFIX = "work/";
const WORK_OPEN_PREFIX = "work-open/";
const DEFAULT_LIST_LIMIT = 128;

// DX note:
// - This journal stores workflow progress for long-running actor logic.
// - It is not protocol truth; concern acceptance is still derived from concern views.
// - Do not mark work done until your actor has observed acceptance.

function asBuf32(key, label) {
  const buf = b4a.isBuffer(key) ? key : idEncoding.decode(String(key));
  if (!b4a.isBuffer(buf) || buf.length !== 32) {
    throw new Error(`${label} must be a 32-byte key`);
  }
  return buf;
}

function keyToZ32(key, label) {
  return idEncoding.encode(asBuf32(key, label));
}

function assertStateBee(stateBee) {
  if (!stateBee || typeof stateBee.get !== "function" || typeof stateBee.put !== "function") {
    throw new Error("stateBee with get/put/del methods is required");
  }
}

function asMs(input, fallback) {
  if (input === undefined || input === null) return fallback;
  const n = Number(input);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(0, Math.trunc(n));
}

function asObject(value, fallback = {}) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return fallback;
  return value;
}

function asStatus(value) {
  if (value === "done") return "done";
  if (value === "abandoned") return "abandoned";
  // Keep open/waiting unified as "open" so listOpen only needs one status check.
  return "open";
}

function padMs(ms) {
  return String(asMs(ms, 0)).padStart(16, "0");
}

function newWorkId() {
  return crypto.randomBytes(12).toString("hex");
}

function workKey({ concernZ32, jobZ32, id }) {
  return `${WORK_PREFIX}${concernZ32}/${jobZ32}/${id}`;
}

function openKey({ concernKey, jobKey, id, nextRunAtMs }) {
  return `${WORK_OPEN_PREFIX}${padMs(nextRunAtMs)}/${concernKey}/${jobKey}/${id}`;
}

function parseOpenKey(key) {
  const raw = String(key || "");
  if (!raw.startsWith(WORK_OPEN_PREFIX)) return null;
  const parts = raw.split("/");
  if (parts.length !== 5) return null;
  const [, nextRunAtRaw, concernKey, jobKey, id] = parts;
  const nextRunAtMs = Number.parseInt(nextRunAtRaw, 10);
  if (!Number.isFinite(nextRunAtMs)) return null;
  if (!concernKey || !jobKey || !id) return null;
  return { concernKey, jobKey, id, nextRunAtMs };
}

function normalizeWork(work, { nowMs, existing }) {
  const src = asObject(work, null);
  if (!src) throw new Error("work must be an object");

  const concernKey = keyToZ32(src.concernKey ?? existing?.concernKey, "work.concernKey");
  const jobKey = keyToZ32(src.jobKey ?? existing?.jobKey, "work.jobKey");
  const id = String(src.id ?? existing?.id ?? "").trim();
  if (!id) throw new Error("work.id is required");

  const createdAtMs = asMs(src.createdAtMs, asMs(existing?.createdAtMs, nowMs));
  const nextRunAtMs = asMs(src.nextRunAtMs, asMs(existing?.nextRunAtMs, nowMs));
  const attempts = asMs(src.attempts, asMs(existing?.attempts, 0));

  return {
    id,
    concernKey,
    jobKey,
    status: asStatus(src.status ?? existing?.status),
    phase: String(src.phase ?? existing?.phase ?? "new"),
    createdAtMs,
    updatedAtMs: nowMs,
    nextRunAtMs,
    attempts,
    pubAttemptZ32: src.pubAttemptZ32 ?? existing?.pubAttemptZ32,
    ratAttemptZ32: src.ratAttemptZ32 ?? existing?.ratAttemptZ32,
    data: asObject(src.data, asObject(existing?.data, {})),
    note: src.note ?? existing?.note,
    outcome: src.outcome ?? existing?.outcome,
    reason: src.reason ?? existing?.reason
  };
}

function fromNode(node) {
  if (!node) return null;
  return node.value ?? node;
}

async function createWorkJournal({ stateBee, nowFn = Date.now } = {}) {
  assertStateBee(stateBee);

  function now() {
    return asMs(nowFn(), Date.now());
  }

  async function get({ concernKey, jobKey, id }) {
    const concernZ32 = keyToZ32(concernKey, "concernKey");
    const jobZ32 = keyToZ32(jobKey, "jobKey");
    const key = workKey({ concernZ32, jobZ32, id: String(id || "") });
    return fromNode(await stateBee.get(key));
  }

  async function put(work) {
    const existing = await get(work);
    const normalized = normalizeWork(work, { nowMs: now(), existing });

    const batch = stateBee.batch();
    if (existing && asStatus(existing.status) === "open") {
      await batch.del(openKey(existing));
    }

    await batch.put(workKey({ concernZ32: normalized.concernKey, jobZ32: normalized.jobKey, id: normalized.id }), normalized);

    if (normalized.status === "open") {
      await batch.put(openKey(normalized), 1);
    }

    await batch.flush();
    return normalized;
  }

  async function create({ concernKey, jobKey, id, phase = "new", nextRunAtMs, data = {} }) {
    const concernZ32 = keyToZ32(concernKey, "concernKey");
    const jobZ32 = keyToZ32(jobKey, "jobKey");
    const workId = String(id || newWorkId());
    const existing = await get({ concernKey: concernZ32, jobKey: jobZ32, id: workId });
    if (existing) return existing;

    const createdAtMs = now();
    return put({
      id: workId,
      concernKey: concernZ32,
      jobKey: jobZ32,
      status: "open",
      phase,
      createdAtMs,
      updatedAtMs: createdAtMs,
      nextRunAtMs: asMs(nextRunAtMs, createdAtMs),
      attempts: 0,
      data: asObject(data, {})
    });
  }

  async function listOpen({ nowMs = now(), limit = DEFAULT_LIST_LIMIT } = {}) {
    const out = [];
    const max = Math.max(1, asMs(limit, DEFAULT_LIST_LIMIT));
    const stale = [];
    const stream = stateBee.createReadStream({
      gte: WORK_OPEN_PREFIX,
      lte: `${WORK_OPEN_PREFIX}${padMs(nowMs)}/\uffff`,
      limit: max * 4
    });

    for await (const entry of stream) {
      if (out.length >= max) break;
      const parsed = parseOpenKey(entry?.key);
      if (!parsed) {
        if (entry?.key) stale.push(String(entry.key));
        continue;
      }

      const work = await get(parsed);
      if (!work) {
        stale.push(String(entry.key));
        continue;
      }

      if (work.status !== "open") {
        stale.push(String(entry.key));
        continue;
      }

      if (asMs(work.nextRunAtMs, 0) > nowMs) continue;
      if (openKey(work) !== String(entry.key)) {
        stale.push(String(entry.key));
        continue;
      }

      out.push(work);
    }

    if (stale.length) {
      const batch = stateBee.batch();
      for (const key of stale) await batch.del(key);
      await batch.flush();
    }

    return out;
  }

  async function markWaiting(work, { nextRunAtMs, note } = {}) {
    return put({
      ...work,
      status: "open",
      nextRunAtMs: asMs(nextRunAtMs, asMs(work?.nextRunAtMs, now())),
      note
    });
  }

  async function markDone(work, { outcome } = {}) {
    return put({ ...work, status: "done", outcome, nextRunAtMs: asMs(work?.nextRunAtMs, now()) });
  }

  async function abandon(work, { reason } = {}) {
    return put({ ...work, status: "abandoned", reason, nextRunAtMs: asMs(work?.nextRunAtMs, now()) });
  }

  async function existsForJob({ concernKey, jobKey }) {
    const concernZ32 = keyToZ32(concernKey, "concernKey");
    const jobZ32 = keyToZ32(jobKey, "jobKey");
    const prefix = `${WORK_PREFIX}${concernZ32}/${jobZ32}/`;
    for await (const _entry of stateBee.createReadStream({ gte: prefix, lt: `${prefix}\uffff`, limit: 1 })) {
      return true;
    }
    return false;
  }

  return {
    create,
    get,
    put,
    listOpen,
    markWaiting,
    markDone,
    abandon,
    existsForJob
  };
}

export { createWorkJournal };
