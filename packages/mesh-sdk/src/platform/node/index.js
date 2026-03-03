import path from "path";
import { createHashPortBlake2b256 } from "../../core/crypto/createHashPortBlake2b256.js";
import { hash32Blake2b256 } from "./hash/blake2b256.js";

function abortError() {
  const err = new Error("The operation was aborted");
  err.name = "AbortError";
  return err;
}

function sleep(ms, signal) {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(abortError());
      return;
    }

    const timer = setTimeout(() => {
      signal?.removeEventListener?.("abort", onAbort);
      resolve();
    }, ms);

    function onAbort() {
      clearTimeout(timer);
      signal?.removeEventListener?.("abort", onAbort);
      reject(abortError());
    }

    signal?.addEventListener?.("abort", onAbort, { once: true });
  });
}

function scheduleInterval(task, intervalMs) {
  const timer = setInterval(() => {
    void task();
  }, intervalMs);
  return () => {
    clearInterval(timer);
  };
}

async function loadMeshRuntime() {
  const [corestoreMod, discoveryMod, concernMod] = await Promise.all([
    import("../../../../../src/ensureCorestore.js"),
    import("../../../../../src/discovery.js"),
    import("../../../../../src/concern.js")
  ]);

  return {
    ensureCorestore: corestoreMod.ensureCorestore,
    ensureDiscoverySurface: discoveryMod.ensureDiscoverySurface,
    ensureConcernSurface: concernMod.ensureConcernSurface,
    getJobView: concernMod.getJobView,
    getPublishView: concernMod.getPublishView,
    getRatView: concernMod.getRatView,
    publishJobWork: concernMod.publishJobWork,
    publishJobRatification: concernMod.publishJobRatification,
    KIND: discoveryMod.KIND
  };
}

function createNodePlatform() {
  return {
    resolveStoreRoot(storeRoot) {
      return path.resolve(storeRoot);
    },
    loadMeshRuntime,
    sleep,
    nowMs() {
      return Date.now();
    },
    scheduleInterval,
    hashPort: createHashPortBlake2b256(hash32Blake2b256)
  };
}

export { createNodePlatform };
