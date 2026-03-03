import Krypto from "hypercore-crypto";

/**
 * @param {Uint8Array} input
 * @returns {Uint8Array}
 */
function hash32Blake2b256(input) {
  return Krypto.hash(input);
}

export { hash32Blake2b256 };

