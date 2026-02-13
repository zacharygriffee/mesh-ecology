import test from "brittle";
import { normalizeStrictConfigV1, ECON_MODE } from "../../src/validity/index.js";

const defaults = { v: 1n, econ: { mode: ECON_MODE.OFF, attemptBurn: 0n, ratBurn: 0n } };

test("defaults when missing fields", (t) => {
  const res = normalizeStrictConfigV1({});
  t.alike(res, defaults);
});

test("rejects invalid mode", (t) => {
  t.exception(() => normalizeStrictConfigV1({ econ: { mode: 99 } }));
});

test("rejects negative burns", (t) => {
  t.exception(() => normalizeStrictConfigV1({ econ: { attemptBurn: -1 } }));
  t.exception(() => normalizeStrictConfigV1({ econ: { ratBurn: -2 } }));
});

test("rejects burns above uint64", (t) => {
  const tooBig = (2n ** 64n);
  t.exception(() => normalizeStrictConfigV1({ econ: { attemptBurn: tooBig } }));
  t.exception(() => normalizeStrictConfigV1({ econ: { ratBurn: tooBig } }));
});

test("accepts numeric burns", (t) => {
  const res = normalizeStrictConfigV1({ econ: { mode: 1, attemptBurn: 5, ratBurn: 6 } });
  t.is(res.econ.mode, 1);
  t.is(res.econ.attemptBurn, 5n);
  t.is(res.econ.ratBurn, 6n);
});

test("accepts bigint burns", (t) => {
  const res = normalizeStrictConfigV1({ econ: { mode: ECON_MODE.BURN, attemptBurn: 5n, ratBurn: 7n } });
  t.is(res.econ.mode, ECON_MODE.BURN);
  t.is(res.econ.attemptBurn, 5n);
  t.is(res.econ.ratBurn, 7n);
});

test("deterministic shape", (t) => {
  const res = normalizeStrictConfigV1({ econ: { mode: 2, attemptBurn: 1 } });
  t.alike(Object.keys(res), ["v", "econ"]);
  t.alike(Object.keys(res.econ), ["mode", "attemptBurn", "ratBurn"]);
});

test("passes through provided version", (t) => {
  const res = normalizeStrictConfigV1({ v: 2, econ: { mode: ECON_MODE.OFF } });
  t.is(res.v, 2n);
});

test("rejects negative version", (t) => {
  t.exception(() => normalizeStrictConfigV1({ v: -1 }));
  t.exception(() => normalizeStrictConfigV1({ v: -1n }));
});

test("rejects version above uint64", (t) => {
  const tooBig = 2n ** 64n;
  t.exception(() => normalizeStrictConfigV1({ v: tooBig }));
});
