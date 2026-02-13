import test from "brittle";
import b4a from "b4a";
import {
    OP,
    validateJob,
    validatePub,
    validateRat,
    validateEvent
} from "../../src/validity/index.js";
import * as ERR from "../../src/validity/errors.js";

const jobKey = b4a.alloc(32, 1);
const otherKey = b4a.alloc(32, 2);
const originKey = b4a.alloc(32, 3);
const attemptToken = b4a.alloc(32, 4);

const baseRef = { t: "work", k: jobKey, a: attemptToken };

const okPub = { key: jobKey, cap: "cap", ref: baseRef };
const okRat = {
    jK: jobKey,
    oK: originKey,
    aK: attemptToken,
    d: 1,
    tr: 1,
    cap: "cap",
    ref: baseRef,
    n: "note"
};

const hex = (buf) => b4a.toString(buf, "hex");

function getterMaps({ withJob = true, withAttempt = false, withRat = false } = {}) {
    const jobs = new Map();
    if (withJob) jobs.set(hex(jobKey), true);
    const attempts = new Map();
    if (withAttempt) attempts.set(`${hex(jobKey)}:${hex(attemptToken)}:${hex(originKey)}`, true);
    const rats = new Map();
    if (withRat) rats.set(`${hex(jobKey)}:${hex(originKey)}:${hex(attemptToken)}`, true);

    return {
        getJob: (k) => jobs.get(hex(k)),
        getAttempt: (jK, aToken, oK) => attempts.get(`${hex(jK)}:${aToken}:${oK ? hex(oK) : ""}`),
        getRat: (jK, _rK, oK, aToken) => rats.get(`${hex(jK)}:${oK ? hex(oK) : ""}:${aToken}`)
    };
}

test("job key length error", (t) => {
    const res = validateJob({ key: b4a.alloc(31), data: { cap: "cap", in: {} } });
    t.is(res.ok, false);
    t.is(res.code, ERR.ERR_KEYLEN);
});

test("pub ref mismatch", (t) => {
    const res = validatePub({ ...okPub, ref: { ...baseRef, k: otherKey } });
    t.is(res.ok, false);
    t.is(res.code, ERR.ERR_REF_KEY_MISMATCH);
});

test("cap bounds on pub", (t) => {
    const longCap = "a".repeat(257);
    const res = validatePub({ ...okPub, cap: longCap });
    t.is(res.ok, false);
    t.is(res.code, ERR.ERR_CAP_BOUNDS);
});

test("meta bounds on pub", (t) => {
    const bigMeta = { x: "x".repeat(16001) };
    const res = validatePub({ ...okPub, meta: bigMeta });
    t.is(res.ok, false);
    t.is(res.code, ERR.ERR_META_BOUNDS);
});

test("note bounds on rat", (t) => {
    const res = validateRat({ ...okRat, n: "n".repeat(257) });
    t.is(res.ok, false);
    t.is(res.code, ERR.ERR_NOTE_BOUNDS);
});

test("job missing via getter", (t) => {
    const getters = getterMaps({ withJob: false });
    const res = validatePub(okPub, getters);
    t.is(res.ok, false);
    t.is(res.code, ERR.ERR_JOB_MISSING);
});

test("duplicate attempt rejected", (t) => {
    const getters = getterMaps({ withJob: true, withAttempt: true });
    const res = validatePub({ ...okPub, oK: originKey }, getters);
    t.is(res.ok, false);
    t.is(res.code, ERR.ERR_DUP_ATTEMPT);
});

test("attempt missing for rat", (t) => {
    const getters = getterMaps({ withJob: true, withAttempt: false });
    const res = validateRat({ ...okRat }, getters);
    t.is(res.ok, false);
    t.is(res.code, ERR.ERR_ATTEMPT_MISSING);
});

test("duplicate rat rejected", (t) => {
    const getters = getterMaps({ withJob: true, withAttempt: true, withRat: true });
    const res = validateRat({ ...okRat }, getters);
    t.is(res.ok, false);
    t.is(res.code, ERR.ERR_DUP_RAT);
});

test("tier bounds", (t) => {
    const res = validateRat({ ...okRat, tr: 70000 });
    t.is(res.ok, false);
    t.is(res.code, ERR.ERR_TIER_BOUNDS);
});

test("determination bounds", (t) => {
    const res = validateRat({ ...okRat, d: 999 });
    t.is(res.ok, false);
    t.is(res.code, ERR.ERR_DETERMINATION_BOUNDS);
});

test("validateEvent dispatches", (t) => {
    const res = validateEvent(OP.PUB, okPub, getterMaps({ withJob: true }));
    t.is(res.ok, true);
});
