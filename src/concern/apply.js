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

  for await (const update of updates) {
    const { value, optimistic, from } = update;
    if (optimistic) {
      const fromKey = from.key;
      switch (value.op) {
        case OP.PUB: {
          const { cap, ref, meta } = value;
          const key = ref.k;
          if (!b4a.equals(value.key, key)) continue;
          const job = await view.sub(JOB_KEY).get(key);
          if (!job) continue;
          const attemptToken = ref.a;
          const existingAttempt = await view.sub(PUB_KEY).sub(key).sub(fromKey).get(attemptToken);
          if (existingAttempt) continue;
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
          if (!econResult.ok) continue;
          await host.ackWriter(from.key);
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
          break;
        }
        case OP.RAT:
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

          if (!b4a.equals(jobKey, ref.k)) continue;

          // Ensure the job actually exists
          const job = await view.sub(JOB_KEY).get(jobKey);
          if (!job) continue;

          // Ensure job attempt actually exists.
          const attempt = await view
            .sub(PUB_KEY)
            .sub(jobKey)
            .sub(organismKey)
            .get(attemptToken, { valueEncoding: viewPubEncoding });

          if (!attempt) continue;

          // Ensure the ratification doesn't exist already.
          const existingRatification = await view
            .sub(RAT_KEY)
            .sub(jobKey)
            .sub(ratifierKey)
            .sub(organismKey)
            .get(attemptToken, { valueEncoding: viewRatEncoding });

          if (existingRatification) continue;
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
          if (!econResult.ok) continue;

          await host.ackWriter(from.key);
          await view.sub(RAT_KEY)
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
          break;
      }
    } else {
      switch (value.op) {
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
  applyWithDeps
};
