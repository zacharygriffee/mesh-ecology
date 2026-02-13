import test from "brittle";
import b4a from "b4a";
import { validateEconomic } from "../../src/validity/index.js";
import { ECON_MODE } from "../../src/validity/state.js";
import {
  ERR_ECON_CONFIG_INVALID,
  ERR_ECON_PROVIDER_MISSING,
  ERR_ECON_UNSUPPORTED_MODE,
  ERR_BUDGET_INSUFFICIENT
} from "../../src/validity/errors-economic.js";

const actorKey = b4a.alloc(32, 1);
const jobKey = b4a.alloc(32, 2);
const attemptToken = b4a.alloc(4, 3);

function ctx(overrides = {}) {
  return {
    mode: ECON_MODE.OFF,
    attemptBurn: 0n,
    ratBurn: 0n,
    actorKey,
    jobKey,
    attemptToken,
    kind: "attempt",
    econProvider: null,
    ...overrides
  };
}

function provider(initial, burned) {
  return {
    getInitialBudget: () => initial,
    getBurnedTotal: () => burned
  };
}

test("OFF mode passes without provider", (t) => {
  const res = validateEconomic(ctx({ mode: ECON_MODE.OFF }));
  t.is(res.ok, true);
  t.alike(res.effects, []);
});

test("invalid config rejected", (t) => {
  const res = validateEconomic(ctx({ mode: 99 }));
  t.is(res.ok, false);
  t.is(res.code, ERR_ECON_CONFIG_INVALID);
});

test("LOCK mode unsupported", (t) => {
  const res = validateEconomic(ctx({ mode: ECON_MODE.LOCK }));
  t.is(res.ok, false);
  t.is(res.code, ERR_ECON_UNSUPPORTED_MODE);
});

test("BURN missing provider", (t) => {
  const res = validateEconomic(ctx({ mode: ECON_MODE.BURN, attemptBurn: 5n }));
  t.is(res.ok, false);
  t.is(res.code, ERR_ECON_PROVIDER_MISSING);
});

test("BURN insufficient budget", (t) => {
  const res = validateEconomic(ctx({ mode: ECON_MODE.BURN, attemptBurn: 10n, econProvider: provider(8n, 1n) }));
  t.is(res.ok, false);
  t.is(res.code, ERR_BUDGET_INSUFFICIENT);
  t.alike(res.details.required, 10n);
});

test("BURN sufficient produces deterministic effect", (t) => {
  const base = ctx({ mode: ECON_MODE.BURN, attemptBurn: 4n, econProvider: provider(10n, 2n) });
  const res1 = validateEconomic(base);
  const res2 = validateEconomic(base);
  t.is(res1.ok, true);
  t.alike(res1.effects, res2.effects);
  t.alike(res1.effects, [{
    type: "burn",
    kind: "attempt",
    actorKey,
    jobKey,
    attemptToken,
    amount: 4n
  }]);
});

test("provider negative values treated as missing", (t) => {
  const res1 = validateEconomic(ctx({ mode: ECON_MODE.BURN, attemptBurn: 1n, econProvider: provider(-1n, 0n) }));
  t.is(res1.ok, false);
  t.is(res1.code, ERR_ECON_PROVIDER_MISSING);
  const res2 = validateEconomic(ctx({ mode: ECON_MODE.BURN, attemptBurn: 1n, econProvider: provider(1n, -1n) }));
  t.is(res2.ok, false);
  t.is(res2.code, ERR_ECON_PROVIDER_MISSING);
});
