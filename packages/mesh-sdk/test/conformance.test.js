#!/usr/bin/env node
import assert from "assert/strict";
import b4a from "b4a";

import { createMeshClient as createNodeMeshClient } from "../src/entry/node.js";
import { createMeshClient as createBareMeshClient } from "../src/entry/bare.js";
import { createHashPortBlake2b256 as createNodeHashPort } from "../src/entry/node.js";
import { createHashPortBlake2b256 as createBareHashPort } from "../src/entry/bare.js";
import { createMeshClientCore } from "../src/core/createMeshClientCore.js";

function makeMockRuntimeOps() {
  return {
    ensureCorestore() {
      return {
        async ready() {},
        namespace() {
          return {};
        },
        async close() {}
      };
    },
    async ensureDiscoverySurface() {
      return {
        discoveryKey: Buffer.alloc(32),
        view: {
          async *createReadStream() {}
        },
        async update() {},
        async close() {}
      };
    },
    async ensureConcernSurface() {
      return {
        discoveryKey: Buffer.alloc(32),
        async update() {},
        async close() {}
      };
    },
    getJobView() {
      return {
        async get() {
          return null;
        },
        async *createReadStream() {},
        valueEncoding: null,
        sub() {
          return {
            async *createReadStream() {},
            sub() {
              return {
                async *createReadStream() {}
              };
            }
          };
        }
      };
    },
    getPublishView() {
      return {
        async *createReadStream() {},
        valueEncoding: null,
        sub() {
          return {
            async *createReadStream() {},
            sub() {
              return {
                async *createReadStream() {}
              };
            }
          };
        }
      };
    },
    getRatView() {
      return {
        async *createReadStream() {},
        valueEncoding: null,
        sub() {
          return {
            async *createReadStream() {},
            sub() {
              return {
                async *createReadStream() {}
              };
            }
          };
        }
      };
    },
    async publishJobWork() {},
    async publishJobRatification() {},
    KIND: {
      CONCERN: 2
    }
  };
}

function makeMockPlatform() {
  return {
    resolveStoreRoot(storeRoot) {
      return String(storeRoot);
    },
    async loadMeshRuntime() {
      return makeMockRuntimeOps();
    },
    sleep(ms) {
      return new Promise((resolve) => setTimeout(resolve, ms));
    },
    nowMs() {
      return Date.now();
    },
    scheduleInterval(task, intervalMs) {
      const timer = setInterval(() => {
        void task();
      }, intervalMs);
      return () => clearInterval(timer);
    }
  };
}

async function runConformance() {
  assert.equal(typeof createNodeMeshClient, "function", "node entry must export createMeshClient");
  assert.equal(typeof createBareMeshClient, "function", "bare entry must export createMeshClient");
  assert.equal(typeof createNodeHashPort, "function", "node entry must export createHashPortBlake2b256");
  assert.equal(typeof createBareHashPort, "function", "bare entry must export createHashPortBlake2b256");

  const nodeHashPort = createNodeHashPort();
  const bareHashPort = createBareHashPort();
  assert.equal(nodeHashPort.alg, "blake2b-256");
  assert.equal(bareHashPort.alg, "blake2b-256");
  const input = new Uint8Array([0, 1, 2, 3, 4, 5]);
  const nodeDigest = nodeHashPort.hash32(input);
  const bareDigest = bareHashPort.hash32(input);
  assert.equal(nodeDigest instanceof Uint8Array, true, "node hash32 must return Uint8Array");
  assert.equal(bareDigest instanceof Uint8Array, true, "bare hash32 must return Uint8Array");
  assert.equal(nodeDigest.byteLength, 32, "node hash32 must return 32 bytes");
  assert.equal(bareDigest.byteLength, 32, "bare hash32 must return 32 bytes");
  assert.equal(b4a.equals(nodeDigest, bareDigest), true, "node and bare hashports should match for same input");

  const sharedConfig = {
    storeRoot: "./store/conformance",
    concernKeys: [],
    noDoctor: true
  };

  const nodeClient = createNodeMeshClient(sharedConfig);
  const bareClient = createBareMeshClient(sharedConfig);

  const methodNames = ["state", "trace", "proposePub", "proposeRat", "waitForMaterialization", "watchState", "close"];
  for (const methodName of methodNames) {
    assert.equal(typeof nodeClient[methodName], "function", `node client must expose ${methodName}()`);
    assert.equal(typeof bareClient[methodName], "function", `bare client must expose ${methodName}()`);
  }

  await nodeClient.close();
  await bareClient.close();

  const coreClient = createMeshClientCore(makeMockPlatform(), {
    storeRoot: "./mock-store",
    concernKeys: []
  });

  const state = await coreClient.state();
  assert.equal(state.command, "state");
  assert.equal(state.schema, "mesh-ecology-packs/state/v1");
  assert.equal(state.schemaVersion, 1);
  assert.equal(typeof state.ok, "boolean");
  assert.ok(Array.isArray(state.concerns));
  assert.equal(typeof state.summary, "object");

  const trace = await coreClient.trace({
    jobKey: Buffer.alloc(32).toString("hex")
  });
  assert.equal(trace.command, "trace");
  assert.equal(trace.schema, "mesh-ecology-packs/trace/v1");
  assert.equal(trace.schemaVersion, 1);
  assert.equal(typeof trace.jobKey, "string");
  assert.ok(Array.isArray(trace.concerns));
  assert.equal(typeof trace.summary, "object");

  await coreClient.close();
}

try {
  await runConformance();
  console.log("[mesh-sdk] conformance test passed");
} catch (err) {
  console.error("[mesh-sdk] conformance test failed");
  console.error(err?.stack || err?.message || String(err));
  process.exit(1);
}
