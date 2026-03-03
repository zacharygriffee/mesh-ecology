import Corestore from "corestore";
import idEncoding from "hypercore-id-encoding";

import { ensureConcernSurface, createJob } from "../../../../src/concern.js";
import { makeRunDirs, cleanupDir } from "./bare-fs.js";
import { pumpSteps } from "./bare-pump.js";

async function createBareSdkHarness({ createMeshClient }) {
  if (typeof createMeshClient !== "function") throw new Error("createMeshClient is required");

  const NULL_SWARM = {
    connections: new Set(),
    on() {},
    off() {},
    join() {
      return {
        flushed: async () => {},
        destroy() {}
      };
    }
  };

  const dirs = await makeRunDirs("mesh-sdk-bare-e2e");
  const hostStore = new Corestore(dirs.hostStoreDir);
  await hostStore.ready?.();

  const hostBase = await ensureConcernSurface(hostStore.namespace("concern-host"), NULL_SWARM);
  await hostBase.update({ wait: true });

  const concernKey = idEncoding.encode(hostBase.key);
  const jobKey = await createJob(hostBase, "cap/sdk-bare-e2e", { in: "bare-e2e" });
  await hostBase.update({ wait: true });
  await hostBase.close().catch(() => {});
  await hostStore.close().catch(() => {});

  const client = createMeshClient({
    storeRoot: dirs.hostStoreDir,
    concernKeys: [concernKey],
    swarm: NULL_SWARM,
    noDoctor: true
  });

  async function pump({ steps = 1, stepDelayMs = 12 } = {}) {
    await pumpSteps({
      steps,
      stepDelayMs,
      onStep: async () => {
        await client.state().catch(() => {});
      }
    });
  }

  async function close() {
    await client.close().catch(() => {});
    await cleanupDir(dirs.baseDir);
  }

  return {
    client,
    concernKey,
    jobKey,
    pump,
    close,
    dirs
  };
}

export { createBareSdkHarness };
