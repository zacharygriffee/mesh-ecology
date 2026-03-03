#!/usr/bin/env node
import assert from "assert/strict";
import b4a from "b4a";

import { createHashPortBlake2b256 } from "@mesh/mesh-sdk/node";

function run() {
  const hashPort = createHashPortBlake2b256();
  assert.equal(hashPort.alg, "blake2b-256", "alg should be blake2b-256");

  const input = new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8, 9]);
  const outA = hashPort.hash32(input);
  const outB = hashPort.hash32(input);

  assert.equal(outA instanceof Uint8Array, true, "hash32 should return Uint8Array");
  assert.equal(outA.byteLength, 32, "hash32 output should be 32 bytes");
  assert.equal(b4a.equals(outA, outB), true, "hash32 should be deterministic for same input");
}

try {
  run();
  console.log("[mesh-sdk] hashport conformance test passed");
} catch (err) {
  console.error("[mesh-sdk] hashport conformance test failed");
  console.error(err?.stack || err?.message || String(err));
  process.exit(1);
}

