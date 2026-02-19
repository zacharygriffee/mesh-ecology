import b4a from "b4a";
import { ensureConcernSurface, getStrictState } from "../concern.js";
import { replicateResource } from "../replicateBase.js";
import { normalizeRetryPolicy, normalizeWarmupBudget } from "./config.js";

// Warmset manager: keeps concerns opened/replicating with skip + revisit semantics.

function createWarmsetManager({ warmN, openConcern }) {
  const warmMap = new Map(); // keyHex -> entry

  function lruEvictIfNeeded() {
    while (warmMap.size > warmN) {
      let oldestKey = null;
      let oldest = Infinity;
      for (const [k, v] of warmMap.entries()) {
        if (v.lastUsed < oldest) {
          oldest = v.lastUsed;
          oldestKey = k;
        }
      }
      if (oldestKey) {
        const { base } = warmMap.get(oldestKey);
        base.close?.().catch(() => {});
        warmMap.delete(oldestKey);
      } else break;
    }
  }

  async function warm(keyBuf, { warmupBudget, retryPolicy, now = Date.now() } = {}) {
    const budget = normalizeWarmupBudget(warmupBudget);
    const retry = normalizeRetryPolicy(retryPolicy);
    const hex = b4a.toString(keyBuf, "hex");
    const entry = warmMap.get(hex) || {
      base: null,
      lastUsed: now,
      keyBuf,
      status: "warming",
      attemptCount: 0,
      attemptTicks: 0,
      attemptStartedAt: now,
      cooldownUntil: 0,
      lastAttemptAt: 0
    };

    entry.lastUsed = now;

    if (entry.status === "skipped") {
      if (now < entry.cooldownUntil) {
        warmMap.set(hex, entry);
        return entry;
      }
      // cooldown elapsed: resume warming
      entry.status = "warming";
      entry.attemptTicks = 0;
      entry.attemptStartedAt = now;
    }

    entry.attemptTicks += 1;
    entry.attemptCount += 1;

    try {
      if (!entry.base) {
        entry.base = await openConcern(keyBuf);
        await entry.base.ready();
      }
      await entry.base.update();
      const strictState = await getStrictState(entry.base, 1n).catch(() => null);

      const ready = budget.minViewReadable ? !!strictState : true;
      if (!ready) {
        throw new Error("not-ready");
      }

      entry.status = "warmed";
      entry.attemptTicks = 0;
      entry.attemptStartedAt = now;
      entry.lastAttemptAt = now;
      entry.cooldownUntil = 0;
      warmMap.set(hex, entry);
      lruEvictIfNeeded();
      return entry;
    } catch {
      const durationMs = now - entry.attemptStartedAt;
      const ticksExceeded = budget.maxTicks > 0 && entry.attemptTicks >= budget.maxTicks;
      const timeExceeded = budget.maxMs > 0 && durationMs >= budget.maxMs;
      const attemptsExceeded = retry.maxAttempts > 0 && entry.attemptCount >= retry.maxAttempts;

      if (ticksExceeded || timeExceeded || attemptsExceeded) {
        entry.status = "skipped";
        const factor = retry.backoff === "exp" ? Math.pow(2, entry.attemptCount - 1) : entry.attemptCount;
        entry.cooldownUntil = now + retry.cooldownMs * factor;
        entry.lastAttemptAt = now;
      } else {
        entry.status = "warming";
      }
      warmMap.set(hex, entry);
      lruEvictIfNeeded();
      return entry;
    }
  }

  function getWarm() {
    return Array.from(warmMap.values()).filter((e) => e.status === "warmed");
  }

  function getStatuses() {
    return Array.from(warmMap.entries()).map(([keyHex, v]) => ({
      keyHex,
      keyBuf: v.keyBuf,
      status: v.status,
      attemptCount: v.attemptCount,
      attemptTicks: v.attemptTicks,
      attemptStartedAt: v.attemptStartedAt,
      cooldownUntil: v.cooldownUntil,
      lastAttemptAt: v.lastAttemptAt,
      isWritable: !!v.base?.writable,
      isCreator: !!(v.base && v.base.key && v.base.local && v.base.key.equals?.(v.base.local.key))
    }));
  }

  async function close() {
    for (const { base } of warmMap.values()) {
      await base?.close?.().catch(() => {});
    }
    warmMap.clear();
  }

  return { warm, getWarm, getStatuses, close };
}

async function defaultOpenConcern({ cs, swarm }) {
  return async function open(keyBuf) {
    const base = await ensureConcernSurface(cs.namespace(`concern-${b4a.toString(keyBuf, "hex")}`), swarm, { key: keyBuf });
    if (swarm) replicateResource(base, swarm);
    return base;
  };
}

export { createWarmsetManager, defaultOpenConcern };
