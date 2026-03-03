import b4a from "b4a";
import c from "compact-encoding";
import { validateEconomic } from "../validity/economic.js";
import {
  OP,
  JOB_KEY,
  PUB_KEY,
  RAT_KEY,
  STATE_KEY,
  ECON_BURN_TOTAL_KEY,
  ECON_LOCK_TOTAL_KEY
} from "./keys.js";
import {
  jobEncoding,
  stateEncoding,
  viewPubEncoding,
  viewRatEncoding
} from "./encodings.js";
import { strictConfigKey, getStrictStateFromView } from "./strict-state.js";

// INTENT(phase-c5-style): Keep concern apply projection isolated while preserving acceptance rules, econ validation boundaries, and exact derived-view write paths.

let applyProbe = null;

function isApplyProbeEnabled() {
  return globalThis.process?.env?.MESH_TEST_APPLY_PROBE === "1";
}

function maybeProbeApplyEvent(payload) {
  if (!isApplyProbeEnabled()) return;
  if (typeof applyProbe !== "function") return;
  try {
    applyProbe(payload);
  } catch {
    // Test probe must never alter runtime behavior.
  }
}

function __setApplyProbe(fn) {
  if (!isApplyProbeEnabled()) return;
  applyProbe = typeof fn === "function" ? fn : null;
}

async function getEconTotal(view, rootKey, actorKey) {
  const res = await view.sub(rootKey).get(actorKey, { valueEncoding: c.uint64 }).catch(() => null);
  if (!res) return 0n;
  const value = res.value ?? res;
  return typeof value === "bigint" ? value : BigInt(value);
}

async function createEconProvider(view, actorKey) {
  const burnedTotal = await getEconTotal(view, ECON_BURN_TOTAL_KEY, actorKey);
  const lockedTotal = await getEconTotal(view, ECON_LOCK_TOTAL_KEY, actorKey);
  return {
    getInitialBudget: () => null,
    getBurnedTotal: () => burnedTotal,
    getLockedTotal: () => lockedTotal
  };
}

async function applyEconomicEffects(view, effects = []) {
  for (const effect of effects) {
    if (effect.type === "burn") {
      const actorKey = effect.actorKey;
      const current = await getEconTotal(view, ECON_BURN_TOTAL_KEY, actorKey);
      const next = current + effect.amount;
      await view
        .sub(ECON_BURN_TOTAL_KEY)
        .put(actorKey, next, { valueEncoding: c.uint64 });
    }
  }
}

async function apply(updates, view, host) {
  // Invariants: deterministic/replay-safe; no base appends; no env/time/random/network reads.
  // Autobase feeds Hypercore updates; this handler projects them into the Hyperbee view.
  return applyWithDeps(updates, view, host, {});
}

async function applyWithDeps(updates, view, host, deps = {}) {
  const econValidate = deps.validateEconomic ?? validateEconomic;
  const econApplyEffects = deps.applyEconomicEffects ?? applyEconomicEffects;
  const econGetState = deps.getStrictStateFromView ?? getStrictStateFromView;
  const econCreateProvider = deps.createEconProvider ?? createEconProvider;
  const admittedCache = new Map();

  async function isAdmittedWriter(fromKey) {
    if (!fromKey) return false;
    const cacheKey = b4a.toString(fromKey, "hex");
    if (admittedCache.has(cacheKey)) return admittedCache.get(cacheKey);
    const member = await host?.system?.get?.(fromKey, { unflushed: true }).catch(() => null);
    const admitted = member !== null;
    admittedCache.set(cacheKey, admitted);
    return admitted;
  }

  async function applyPubValue(value, fromKey, { ackWriter = false } = {}) {
    const { cap, ref, meta } = value;
    if (!fromKey || !ref) return;

    const key = ref.k;
    if (!b4a.equals(value.key, key)) return;
    const job = await view.sub(JOB_KEY).get(key);
    if (!job) return;

    const attemptToken = ref.a;
    const existingAttempt = await view.sub(PUB_KEY).sub(key).sub(fromKey).get(attemptToken);
    if (existingAttempt) return;

    const strictState = await econGetState(view).catch(() => null);
    const { econ: strictEcon = { mode: 0, attemptBurn: 0n, ratBurn: 0n } } = strictState || {};
    const econProvider = strictEcon.mode === 0 ? null : await econCreateProvider(view, fromKey);
    const econResult = await econValidate({
      mode: strictEcon.mode,
      attemptBurn: strictEcon.attemptBurn,
      ratBurn: strictEcon.ratBurn,
      actorKey: fromKey,
      jobKey: key,
      attemptToken,
      kind: "attempt",
      econProvider
    });
    if (!econResult.ok) return;

    if (ackWriter) await host.ackWriter(fromKey);
    await view
      .sub(PUB_KEY)
      .sub(key)
      .sub(fromKey)
      .put(attemptToken, { oK: fromKey, cap, ref, meta }, {
        valueEncoding: viewPubEncoding
      });
    if (econResult.effects && econResult.effects.length) {
      await econApplyEffects(view, econResult.effects);
    }
  }

  async function applyRatValue(value, fromKey, { ackWriter = false } = {}) {
    if (!fromKey) return;
    const ratifierKey = fromKey;
    const {
      jK: jobKey,
      oK: organismKey,
      aK: attemptToken,
      d: determination,
      tr: tier,
      cap,
      ref,
      n: note
    } = value;
    if (!jobKey || !organismKey || !attemptToken || !ref) return;

    if (!b4a.equals(jobKey, ref.k)) return;

    // Ensure the job actually exists.
    const job = await view.sub(JOB_KEY).get(jobKey);
    if (!job) return;

    // Ensure job attempt actually exists.
    const attempt = await view
      .sub(PUB_KEY)
      .sub(jobKey)
      .sub(organismKey)
      .get(attemptToken, { valueEncoding: viewPubEncoding });
    if (!attempt) return;

    // Ensure the ratification doesn't exist already.
    const existingRatification = await view
      .sub(RAT_KEY)
      .sub(jobKey)
      .sub(ratifierKey)
      .sub(organismKey)
      .get(attemptToken, { valueEncoding: viewRatEncoding });
    if (existingRatification) return;

    const strictState = await econGetState(view).catch(() => null);
    const { econ: strictEcon = { mode: 0, attemptBurn: 0n, ratBurn: 0n } } = strictState || {};
    const econProvider = strictEcon.mode === 0 ? null : await econCreateProvider(view, ratifierKey);
    const econResult = await econValidate({
      mode: strictEcon.mode,
      attemptBurn: strictEcon.attemptBurn,
      ratBurn: strictEcon.ratBurn,
      actorKey: ratifierKey,
      jobKey,
      attemptToken,
      kind: "rat",
      econProvider
    });
    if (!econResult.ok) return;

    if (ackWriter) await host.ackWriter(fromKey);
    await view
      .sub(RAT_KEY)
      .sub(jobKey)
      .sub(ratifierKey)
      .sub(organismKey)
      .put(attemptToken, {
        d: determination,
        tr: tier,
        cap,
        ref,
        n: note
      }, { valueEncoding: viewRatEncoding });
    if (econResult.effects && econResult.effects.length) {
      await econApplyEffects(view, econResult.effects);
    }
  }

  for await (const update of updates) {
    const { value, optimistic, from } = update;
    const op = value?.op;
    const fromKey = from?.key || null;
    if (op === OP.PUB || op === OP.RAT) {
      const jobKey = op === OP.PUB ? value?.ref?.k : value?.jK;
      maybeProbeApplyEvent({
        op,
        optimistic: !!optimistic,
        writerKey: from?.key || null,
        jobKey: jobKey || null,
        viewKey: view?.feed?.key || null
      });
    }
    if (optimistic) {
      switch (value.op) {
        case OP.PUB: {
          await applyPubValue(value, fromKey, { ackWriter: true });
          break;
        }
        case OP.RAT: {
          await applyRatValue(value, fromKey, { ackWriter: true });
          break;
        }
      }
    } else {
      switch (value.op) {
        case OP.PUB: {
          if (!(await isAdmittedWriter(fromKey))) break;
          await applyPubValue(value, fromKey, { ackWriter: false });
          break;
        }
        case OP.RAT: {
          if (!(await isAdmittedWriter(fromKey))) break;
          await applyRatValue(value, fromKey, { ackWriter: false });
          break;
        }
        case OP.ADD: {
          await host.addWriter(value.key);
          break;
        }
        case OP.JOB: {
          await view
            .sub(JOB_KEY)
            .put(value.key, value.data, { valueEncoding: jobEncoding });
          break;
        }
        case OP.STATE: {
          const {
            v,
            econ
          } = value;
          const key = strictConfigKey(v);
          const stateView = view.sub(STATE_KEY);
          const exists = await stateView.get(key, { valueEncoding: stateEncoding });
          if (exists) continue;

          await view
            .sub(STATE_KEY)
            .put(key, { v, econ }, {
              valueEncoding: stateEncoding
            });
          break;
        }
      }
    }
  }
}

export {
  apply,
  applyWithDeps,
  __setApplyProbe
};
