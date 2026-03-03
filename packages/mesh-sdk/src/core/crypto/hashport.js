/**
 * Canonical mesh-sdk hashing interface.
 *
 * No implicit encoding is allowed: callers must pass raw bytes and receive raw bytes.
 *
 * @typedef {object} HashPort
 * @property {string} alg Algorithm identifier (for example `blake2b-256`).
 * @property {(input: Uint8Array) => Uint8Array} hash32 Hash a byte input and return exactly 32 bytes.
 */

/**
 * JSDoc identity helper so the HashPort typedef is available from the public SDK surface.
 * This function intentionally performs no validation and is not used in hot paths.
 *
 * @param {HashPort} hashPort
 * @returns {HashPort}
 */
function asHashPort(hashPort) {
  return hashPort;
}

export { asHashPort };

