import { asHashPort } from "./hashport.js";

/**
 * Create a canonical blake2b-256 HashPort from an injected hash backend.
 *
 * This module intentionally does not import any hashing backend directly.
 *
 * @param {(input: Uint8Array) => Uint8Array} hash32Impl
 * @returns {import("./hashport.js").HashPort}
 */
function createHashPortBlake2b256(hash32Impl) {
  if (typeof hash32Impl !== "function") {
    throw new TypeError("hash32Impl must be a function");
  }

  return asHashPort({
    alg: "blake2b-256",
    hash32(input) {
      return hash32Impl(input);
    }
  });
}

export { createHashPortBlake2b256 };

