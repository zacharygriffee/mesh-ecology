#!/usr/bin/env node
import assert from "assert/strict";

import {
  createHashPortBlake2b256,
  assertHashPort,
  hash32Checked,
  createCheckedHashPort
} from "../src/entry/node.js";

function makeGoodHashPort() {
  return {
    alg: "blake2b-256",
    hash32(input) {
      return new Uint8Array(32).fill(input.byteLength & 0xff);
    }
  };
}

function run() {
  const defaultHashPort = createHashPortBlake2b256();
  assert.equal(defaultHashPort.alg, "blake2b-256", "default hashport algorithm should be blake2b-256");
  const defaultDigest = defaultHashPort.hash32(new Uint8Array([0, 1, 2]));
  assert.ok(defaultDigest instanceof Uint8Array, "default hashport output must be Uint8Array");
  assert.equal(defaultDigest.byteLength, 32, "default hashport output must be 32 bytes");

  const good = makeGoodHashPort();
  assert.doesNotThrow(() => assertHashPort(good), "valid HashPort should pass shape check");

  assert.throws(
    () => hash32Checked(good, "abc"),
    /Uint8Array/,
    "hash32Checked should reject non-Uint8Array input"
  );

  const wrongLen = {
    alg: "blake2b-256",
    hash32() {
      return new Uint8Array(31);
    }
  };
  assert.doesNotThrow(() => assertHashPort(wrongLen), "shape check does not validate call output length");
  assert.throws(
    () => hash32Checked(wrongLen, new Uint8Array([1])),
    /32 bytes/,
    "hash32Checked should reject non-32-byte outputs"
  );

  const wrapped = createCheckedHashPort(good);
  const out = wrapped.hash32(new Uint8Array([1, 2, 3]));
  assert.ok(out instanceof Uint8Array, "wrapped HashPort returns Uint8Array");
  assert.equal(out.byteLength, 32, "wrapped HashPort returns 32-byte output");
}

try {
  run();
  console.log("[mesh-sdk] hashport contract test passed");
} catch (err) {
  console.error("[mesh-sdk] hashport contract test failed");
  console.error(err?.stack || err?.message || String(err));
  process.exit(1);
}
