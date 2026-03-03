/**
 * @import { HashPort } from "./hashport.js"
 */

function assertUint8Array(value, label) {
  if (!(value instanceof Uint8Array)) {
    throw new TypeError(`${label} must be Uint8Array`);
  }
}

function assertHash32Output(output) {
  assertUint8Array(output, "hash32 output");
  if (output.byteLength !== 32) {
    throw new TypeError("hash32 output must be exactly 32 bytes");
  }
}

/**
 * Runtime shape check for HashPort.
 * Intended for tests/conformance and adapter wiring checks, not hot paths.
 *
 * @param {unknown} hashPort
 * @returns {asserts hashPort is HashPort}
 */
function assertHashPort(hashPort) {
  if (!hashPort || typeof hashPort !== "object") {
    throw new TypeError("hashPort must be an object");
  }
  if (typeof hashPort.alg !== "string" || !hashPort.alg.trim()) {
    throw new TypeError("hashPort.alg must be a non-empty string");
  }
  if (typeof hashPort.hash32 !== "function") {
    throw new TypeError("hashPort.hash32 must be a function");
  }
}

/**
 * Validate HashPort input/output contract for a single call.
 *
 * @param {HashPort} hashPort
 * @param {Uint8Array} input
 * @returns {Uint8Array}
 */
function hash32Checked(hashPort, input) {
  assertHashPort(hashPort);
  assertUint8Array(input, "hash32 input");
  const output = hashPort.hash32(input);
  assertHash32Output(output);
  return output;
}

/**
 * Wrap a HashPort with input/output contract checks.
 * Intended for tests/conformance and explicit adapter validation.
 *
 * @param {HashPort} hashPort
 * @returns {HashPort}
 */
function createCheckedHashPort(hashPort) {
  assertHashPort(hashPort);
  return {
    alg: hashPort.alg,
    hash32(input) {
      return hash32Checked(hashPort, input);
    }
  };
}

export {
  assertHashPort,
  assertHash32Output,
  hash32Checked,
  createCheckedHashPort
};

