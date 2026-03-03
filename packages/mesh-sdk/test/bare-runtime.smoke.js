#!/usr/bin/env node
import { createMeshClient as createDefaultMeshClient } from "@mesh/mesh-sdk";
import { createMeshClient as createBareMeshClient } from "@mesh/mesh-sdk/bare";

function assertOk(value, message) {
  if (!value) throw new Error(message);
}

function assertHasKeys(obj, keys, label) {
  for (const key of keys) {
    if (!Object.prototype.hasOwnProperty.call(obj, key)) {
      throw new Error(`${label} missing key: ${key}`);
    }
  }
}

function assertClientShape(client, label) {
  const methods = ["state", "trace", "proposePub", "proposeRat", "waitForMaterialization", "watchState", "close"];
  for (const name of methods) {
    if (typeof client[name] !== "function") {
      throw new Error(`${label} client missing method: ${name}`);
    }
  }
}

async function resolveRmRecursive() {
  try {
    const fsMod = await import("bare-fs");
    if (fsMod?.promises?.rm) {
      return async (target) => {
        await fsMod.promises.rm(target, { recursive: true, force: true });
      };
    }
  } catch {}

  try {
    const fsMod = await import("fs");
    if (fsMod?.promises?.rm) {
      return async (target) => {
        await fsMod.promises.rm(target, { recursive: true, force: true });
      };
    }
  } catch {}

  return async () => {};
}

async function checkEnvelope(client, label) {
  const state = await client.state();
  assertHasKeys(state, ["schema", "schemaVersion", "command", "ok", "concerns", "summary"], `${label}.state`);
  assertOk(state.schema === "mesh-ecology-packs/state/v1", `${label}.state schema mismatch`);
  assertOk(state.schemaVersion === 1, `${label}.state schemaVersion mismatch`);
  assertOk(state.command === "state", `${label}.state command mismatch`);
  assertOk(Array.isArray(state.concerns), `${label}.state concerns must be an array`);

  const trace = await client.trace({ jobKey: "00".repeat(32) });
  assertHasKeys(trace, ["schema", "schemaVersion", "command", "jobKey", "concerns", "summary"], `${label}.trace`);
  assertOk(trace.schema === "mesh-ecology-packs/trace/v1", `${label}.trace schema mismatch`);
  assertOk(trace.schemaVersion === 1, `${label}.trace schemaVersion mismatch`);
  assertOk(trace.command === "trace", `${label}.trace command mismatch`);
  assertOk(Array.isArray(trace.concerns), `${label}.trace concerns must be an array`);
}

async function run() {
  assertOk(typeof createDefaultMeshClient === "function", "default export must provide createMeshClient");
  assertOk(typeof createBareMeshClient === "function", "bare export must provide createMeshClient");

  const suffix = `${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
  const defaultStoreRoot = `/tmp/mesh-sdk-bare-runtime/default-${suffix}`;
  const bareStoreRoot = `/tmp/mesh-sdk-bare-runtime/bare-${suffix}`;
  const baseConfig = {
    concernKeys: [],
    noDoctor: true
  };

  const defaultClient = createDefaultMeshClient({
    ...baseConfig,
    storeRoot: defaultStoreRoot
  });
  const bareClient = createBareMeshClient({
    ...baseConfig,
    storeRoot: bareStoreRoot
  });
  const rmRecursive = await resolveRmRecursive();

  assertClientShape(defaultClient, "default");
  assertClientShape(bareClient, "bare");

  try {
    await checkEnvelope(defaultClient, "default");
    await checkEnvelope(bareClient, "bare");
  } finally {
    await defaultClient.close().catch(() => {});
    await bareClient.close().catch(() => {});
    await rmRecursive(defaultStoreRoot).catch(() => {});
    await rmRecursive(bareStoreRoot).catch(() => {});
  }

  console.log("[mesh-sdk] bare runtime smoke passed");
}

await run();
