import b4a from "b4a";
import * as ERR from "./errors.js";
import {
    boundedUtf8ByteLen,
    isBoundedCap,
    isKey32,
    isUint16,
    isUint8,
    normalizeAttemptToken
} from "./types.js";

const CAP_MAX_BYTES = 256;
const META_MAX_BYTES = 16000;
const NOTE_MAX_BYTES = 256;
const JOB_MAX_BYTES = 16000;
const REF_TYPE_MAX_BYTES = 256;
const REF_PATH_MAX_BYTES = 256;

const OP = { JOB: 1, PUB: 2, RAT: 3 };

const ok = () => ({ ok: true });
const fail = (code, details) => ({ ok: false, code, details });

function jsonWithin(value, max) {
    if (value === undefined) return true;
    const s = JSON.stringify(value);
    if (s === undefined) return false;
    return b4a.byteLength(s, "utf8") <= max;
}

function validateRefStructure(ref) {
    if (!ref || typeof ref !== "object") return fail(ERR.ERR_REF_MISSING);
    const { k, a, t, p, h } = ref;
    if (!isKey32(k)) return fail(ERR.ERR_KEYLEN, { where: "ref.k" });
    if (t === undefined || !boundedUtf8ByteLen(t, REF_TYPE_MAX_BYTES)) return fail(ERR.ERR_META_BOUNDS, { where: "ref.t", max: REF_TYPE_MAX_BYTES });
    if (p !== undefined && !boundedUtf8ByteLen(p, REF_PATH_MAX_BYTES)) return fail(ERR.ERR_META_BOUNDS, { where: "ref.p", max: REF_PATH_MAX_BYTES });
    if (h !== undefined && !isKey32(h)) return fail(ERR.ERR_KEYLEN, { where: "ref.h" });
    if (b4a.isBuffer(a) && a.length !== 32) return fail(ERR.ERR_KEYLEN, { where: "ref.a" });
    const attemptToken = normalizeAttemptToken(a);
    return { ok: true, attemptToken };
}

function validateJob(value = {}) {
    if (!isKey32(value.key)) return fail(ERR.ERR_KEYLEN, { where: "job.key" });
    const data = value.data && typeof value.data === "object" ? value.data : {};
    const cap = data.cap ?? value.cap;
    if (!isBoundedCap(cap, CAP_MAX_BYTES)) return fail(ERR.ERR_CAP_BOUNDS, { where: "job.cap", max: CAP_MAX_BYTES });
    if (data.in !== undefined || value.in !== undefined) {
        const payload = data.in ?? value.in;
        if (!jsonWithin(payload, JOB_MAX_BYTES)) return fail(ERR.ERR_META_BOUNDS, { where: "job.in", max: JOB_MAX_BYTES });
    }
    return ok();
}

function validatePub(value = {}, getters = {}) {
    if (!isKey32(value.key)) return fail(ERR.ERR_KEYLEN, { where: "pub.key" });
    const refResult = validateRefStructure(value.ref);
    if (!refResult.ok) return refResult;
    if (!b4a.equals(value.key, value.ref.k)) return fail(ERR.ERR_REF_KEY_MISMATCH, { expected: value.key, got: value.ref.k });
    const attemptToken = normalizeAttemptToken(value.attemptToken ?? refResult.attemptToken);
    if (attemptToken === undefined) return fail(ERR.ERR_ATTEMPT_MISSING, { where: "pub.ref.a" });
    if (!isBoundedCap(value.cap, CAP_MAX_BYTES)) return fail(ERR.ERR_CAP_BOUNDS, { where: "pub.cap", max: CAP_MAX_BYTES });
    if (value.meta !== undefined && !jsonWithin(value.meta, META_MAX_BYTES)) return fail(ERR.ERR_META_BOUNDS, { where: "pub.meta", max: META_MAX_BYTES });

    if (getters.getJob && !getters.getJob(value.ref.k, value)) return fail(ERR.ERR_JOB_MISSING, { job: value.ref.k });
    if (getters.getAttempt && getters.getAttempt(value.ref.k, attemptToken, value.oK)) return fail(ERR.ERR_DUP_ATTEMPT, { job: value.ref.k, attemptToken });

    return ok();
}

function validateRat(value = {}, getters = {}) {
    if (!isKey32(value.jK)) return fail(ERR.ERR_KEYLEN, { where: "rat.jK" });
    if (!isKey32(value.oK)) return fail(ERR.ERR_KEYLEN, { where: "rat.oK" });
    if (b4a.isBuffer(value.aK) && value.aK.length !== 32) return fail(ERR.ERR_KEYLEN, { where: "rat.aK" });

    const refResult = validateRefStructure(value.ref);
    if (!refResult.ok) return refResult;
    if (!b4a.equals(value.jK, value.ref.k)) return fail(ERR.ERR_REF_KEY_MISMATCH, { expected: value.jK, got: value.ref.k });

    const attemptToken = normalizeAttemptToken(value.attemptToken ?? value.aK ?? refResult.attemptToken);
    if (attemptToken === undefined) return fail(ERR.ERR_ATTEMPT_MISSING, { where: "rat.aK/ref.a" });

    if (!isBoundedCap(value.cap, CAP_MAX_BYTES)) return fail(ERR.ERR_CAP_BOUNDS, { where: "rat.cap", max: CAP_MAX_BYTES });
    if (value.n !== undefined && !boundedUtf8ByteLen(value.n, NOTE_MAX_BYTES)) return fail(ERR.ERR_NOTE_BOUNDS, { where: "rat.n", max: NOTE_MAX_BYTES });
    if (!isUint16(value.tr)) return fail(ERR.ERR_TIER_BOUNDS, { where: "rat.tr" });
    if (!isUint8(value.d)) return fail(ERR.ERR_DETERMINATION_BOUNDS, { where: "rat.d" });

    if (getters.getJob && !getters.getJob(value.jK, value)) return fail(ERR.ERR_JOB_MISSING, { job: value.jK });
    if (getters.getAttempt && !getters.getAttempt(value.jK, attemptToken, value.oK)) return fail(ERR.ERR_ATTEMPT_MISSING, { job: value.jK, attemptToken, origin: value.oK });

    const ratifierKey = value.rK ?? value.ratifierKey;
    if (getters.getRat && getters.getRat(value.jK, ratifierKey, value.oK, attemptToken)) return fail(ERR.ERR_DUP_RAT, { job: value.jK, origin: value.oK, attemptToken });

    return ok();
}

function validateEvent(op, value, getters = {}) {
    const opcode = typeof op === "string" ? OP[op.toUpperCase()] : op;
    switch (opcode) {
        case OP.JOB:
            return validateJob(value);
        case OP.PUB:
            return validatePub(value, getters);
        case OP.RAT:
            return validateRat(value, getters);
        default:
            return fail(ERR.ERR_OP_UNSUPPORTED, { op });
    }
}

export {
    OP,
    validateJob,
    validatePub,
    validateRat,
    validateEvent
};
