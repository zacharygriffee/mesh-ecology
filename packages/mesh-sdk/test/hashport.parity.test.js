#!/usr/bin/env node
import assert from "assert/strict";
import b4a from "b4a";

import { createHashPortBlake2b256 as createNodeHashPort } from "@mesh/mesh-sdk/node";
import { createHashPortBlake2b256 as createBareHashPort } from "@mesh/mesh-sdk/bare";

function run() {
  const nodeHashPort = createNodeHashPort();
  const bareHashPort = createBareHashPort();

  const input = new Uint8Array([0, 5, 10, 15, 20, 25, 30, 35, 40, 45]);
  const nodeDigest = nodeHashPort.hash32(input);
  const bareDigest = bareHashPort.hash32(input);

  assert.equal(nodeHashPort.alg, "blake2b-256");
  assert.equal(bareHashPort.alg, "blake2b-256");
  assert.equal(nodeDigest instanceof Uint8Array, true);
  assert.equal(bareDigest instanceof Uint8Array, true);
  assert.equal(nodeDigest.byteLength, 32);
  assert.equal(bareDigest.byteLength, 32);
  assert.equal(b4a.equals(nodeDigest, bareDigest), true, "node and bare hash outputs should match exactly");
}

try {
  run();
  console.log("[mesh-sdk] hashport parity test passed");
} catch (err) {
  console.error("[mesh-sdk] hashport parity test failed");
  console.error(err?.stack || err?.message || String(err));
  process.exit(1);
}

