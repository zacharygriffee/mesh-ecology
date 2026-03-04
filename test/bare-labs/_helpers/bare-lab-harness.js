import Corestore from "corestore";
import idEncoding from "hypercore-id-encoding";
import * as bareFs from "bare-fs";

import {
  ensureConcernSurface,
  createJob as createConcernJob
} from "../../../src/concern.js";

let tmpCounter = 0;

function toStepCount(value, fallback = 1) {
  const num = Number(value);
  if (!Number.isFinite(num) || num <= 0) return fallback;
  return Math.floor(num);
}

function toDelayMs(value, fallback = 0) {
  const num = Number(value);
  if (!Number.isFinite(num) || num < 0) return fallback;
  return Math.floor(num);
}

function sleepMs(ms) {
  if (ms <= 0) return Promise.resolve();
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function createNoopSwarm() {
  return {
    connections: new Set(),
    on() {},
    off() {},
    join() {
      return {
        flushed: async () => {},
        destroy() {}
      };
    },
    flush: async () => {},
    close: async () => {}
  };
}

function createDeterministicTransport() {
  const hostSwarm = createNoopSwarm();
  const clientSwarm = createNoopSwarm();

  return {
    hostSwarm,
    clientSwarm,
    async flushStep() {
      await hostSwarm.flush();
      await clientSwarm.flush();
    },
    async close() {
      await hostSwarm.close().catch(() => {});
      await clientSwarm.close().catch(() => {});
    }
  };
}

function nextSuffix() {
  tmpCounter += 1;
  return `${Date.now()}-${tmpCounter}`;
}

async function makeTmpRoot(prefix = "mesh-sdk-bare-labs") {
  const safePrefix = String(prefix || "mesh-sdk-bare-labs").replace(/[^a-zA-Z0-9._-]/g, "-");
  const tmpRoot = `/tmp/${safePrefix}-${nextSuffix()}`;
  await bareFs.promises.mkdir(tmpRoot, { recursive: true });
  return tmpRoot;
}

async function loadCreateMeshClient() {
  try {
    const mod = await import("@mesh/mesh-sdk");
    if (typeof mod.createMeshClient === "function") return mod.createMeshClient;
  } catch {}

  const fallback = await import("../../../packages/mesh-sdk/src/entry/bare.js");
  if (typeof fallback.createMeshClient !== "function") {
    throw new Error("Unable to load createMeshClient for Bare labs");
  }
  return fallback.createMeshClient;
}

function keyWithByte(byteValue) {
  const key = new Uint8Array(32);
  key.fill(byteValue & 0xff);
  return key;
}

async function settleWithPump(waitPromise, pump, { maxSteps = 120, stepDelayMs = 2 } = {}) {
  const steps = toStepCount(maxSteps, 120);
  const delayMs = toDelayMs(stepDelayMs, 2);

  let settled = false;
  let result;
  let failure;

  waitPromise.then(
    (value) => {
      settled = true;
      result = value;
    },
    (err) => {
      settled = true;
      failure = err;
    }
  );

  for (let i = 0; i < steps && !settled; i++) {
    await pump(1, { stepDelayMs: delayMs });
  }

  if (!settled) {
    throw new Error(`wait promise did not settle within ${steps} pump steps`);
  }
  if (failure) throw failure;
  return result;
}

async function makeHarness(opts = {}) {
  const tmpRoot = opts.tmpRoot ? String(opts.tmpRoot) : await makeTmpRoot(opts.prefix || "mesh-sdk-bare-labs");
  const hostStoreDir = `${tmpRoot}/host-store`;
  const clientStoreDir = `${tmpRoot}/client-store`;

  await bareFs.promises.mkdir(hostStoreDir, { recursive: true });
  await bareFs.promises.mkdir(clientStoreDir, { recursive: true });

  const transport = createDeterministicTransport();
  const createMeshClient = typeof opts.createMeshClient === "function"
    ? opts.createMeshClient
    : await loadCreateMeshClient();

  let concernKeyBuf = null;

  async function withHostWritable(action) {
    const hostStore = new Corestore(hostStoreDir);
    await hostStore.ready?.();

    const concernConfig = concernKeyBuf ? { key: concernKeyBuf } : {};
    const hostBase = await ensureConcernSurface(hostStore.namespace("concern-host"), transport.hostSwarm, concernConfig);
    await hostBase.update({ wait: true }).catch(() => {});

    try {
      return await action(hostBase, hostStore);
    } finally {
      await hostBase.close().catch(() => {});
      await hostStore.close().catch(() => {});
    }
  }

  concernKeyBuf = await withHostWritable(async (hostBase) => hostBase.key);
  const concernKey = idEncoding.encode(concernKeyBuf);

  const clientStoreRoot = opts.clientStoreRoot ? String(opts.clientStoreRoot) : hostStoreDir;
  const concernKeys = Array.isArray(opts.concernKeys) && opts.concernKeys.length
    ? opts.concernKeys
    : [concernKey];

  const api = {
    host: null,
    client: null,
    paths: {
      tmpRoot,
      hostStoreDir,
      clientStoreDir,
      clientStoreRoot
    },
    pump,
    closeAll
  };

  async function openClient() {
    if (api.client) return api.client;
    api.client = createMeshClient({
      storeRoot: clientStoreRoot,
      concernKeys,
      swarm: transport.clientSwarm,
      noDoctor: true,
      ...(opts.clientConfig || {})
    });
    return api.client;
  }

  async function closeClient() {
    if (!api.client) return;
    const current = api.client;
    api.client = null;
    await current.close().catch(() => {});
  }

  await openClient();

  async function hostStep() {
    // Single-store Bare lab mode does not run a parallel host writer loop.
    // Host writes are materialized via createJob() and client poll drives view refresh.
  }

  async function createHostJob({ cap = "cap/sdk-bare-lab", input = { in: "bare-lab" } } = {}) {
    await closeClient();
    const jobKey = await withHostWritable(async (hostBase) => {
      const key = await createConcernJob(hostBase, String(cap), input);
      await hostBase.update({ wait: true }).catch(() => {});
      return key;
    });
    await openClient();
    return jobKey;
  }

  async function clientStep() {
    const client = await openClient();
    await client.state().catch(() => {});
  }

  async function pump(steps = 1, { stepDelayMs = 0 } = {}) {
    const total = toStepCount(steps, 1);
    const delayMs = toDelayMs(stepDelayMs, 0);

    for (let i = 0; i < total; i++) {
      // Fixed deterministic step order for every tick.
      await hostStep();
      await transport.flushStep();
      await clientStep();
      await sleepMs(delayMs);
    }
  }

  api.host = {
    base: { concernKey },
    concernKey,
    createJob: createHostJob,
    step: hostStep
  };

  let closed = false;
  let cleaned = false;

  async function closeAll({ cleanup = true } = {}) {
    if (!closed) {
      closed = true;
      await closeClient();
      await transport.close().catch(() => {});
    }

    if (cleanup && !cleaned) {
      cleaned = true;
      await bareFs.promises.rm(tmpRoot, { recursive: true, force: true }).catch(() => {});
    }
  }

  return api;
}

export {
  makeTmpRoot,
  makeHarness,
  keyWithByte,
  settleWithPump
};
