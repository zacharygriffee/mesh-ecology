import b4a from "b4a";

/** @typedef {Buffer} Key32 */

/**
 * @typedef {Object} Ref
 * @property {Key32} k - Job key
 * @property {string|Buffer|number} [a] - Attempt identifier
 * @property {string} [t] - Work result type
 * @property {string} [p] - Optional path
 * @property {Key32} [h] - Optional hash
 */

/**
 * @typedef {Object} JobValue
 * @property {Key32} key
 * @property {{ in: any, cap: string }} [data]
 * @property {any} [in]
 * @property {string} [cap]
 */

/**
 * @typedef {Object} PubValue
 * @property {Key32} key
 * @property {string} cap
 * @property {Ref} ref
 * @property {Object} [meta]
 * @property {string|Buffer|number} [attemptToken]
 * @property {Key32} [oK] - Optional origin key for duplicate detection
 */

/**
 * @typedef {Object} RatValue
 * @property {Key32} jK
 * @property {Key32} oK
 * @property {Key32|string|Buffer|number} [aK]
 * @property {Ref} ref
 * @property {string} cap
 * @property {number} d - Determination (uint8)
 * @property {number} tr - Tier (uint16)
 * @property {string} [n] - Optional note
 * @property {string|Buffer|number} [attemptToken]
 */

/**
 * @typedef {Object} Getters
 * @property {(jobKey: Key32) => any} [getJob]
 * @property {(jobKey: Key32, attemptToken: string, originKey?: Key32) => any} [getAttempt]
 * @property {(jobKey: Key32, ratifierKey: Key32 | undefined, originKey: Key32 | undefined, attemptToken: string) => any} [getRat]
 */

/**
 * Test for a 32-byte buffer key.
 * @param {any} buf
 * @returns {buf is Key32}
 */
function isKey32(buf) {
    return b4a.isBuffer(buf) && buf.length === 32;
}

/**
 * Check if a UTF-8 string is within byte bounds.
 * @param {any} str
 * @param {number} max
 * @returns {boolean}
 */
function boundedUtf8ByteLen(str, max) {
    return typeof str === "string" && b4a.byteLength(str, "utf8") <= max;
}

function isUint8(n) {
    return Number.isInteger(n) && n >= 0 && n <= 0xff;
}

function isUint16(n) {
    return Number.isInteger(n) && n >= 0 && n <= 0xffff;
}

function isBoundedCap(cap, max = 256) {
    return boundedUtf8ByteLen(cap, max);
}

function normalizeAttemptToken(x) {
    if (x === undefined || x === null) return undefined;
    if (b4a.isBuffer(x)) return b4a.toString(x, "hex");
    if (ArrayBuffer.isView(x)) return b4a.toString(b4a.from(x), "hex");
    return String(x);
}

export {
    isKey32,
    boundedUtf8ByteLen,
    isUint8,
    isUint16,
    isBoundedCap,
    normalizeAttemptToken
};
