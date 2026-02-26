import test from "brittle";
import Corestore from "corestore";
import crypto from "crypto";
import b4a from "b4a";
import createFakeSwarm from "fakeswarm";

import {
  ensureConcernSurface,
  createJob,
  getJobView
} from "../../src/concern.js";
import { waitForSwarmConnections } from "../../src/util/waiters/swarm.js";
import { waitForCorePeers } from "../../src/util/waiters/core.js";
import { getWait } from "../../src/getWait.js";
import { getLabBudgets } from "../_helpers/lab-budgets.js";
import { mkTemp } from "../_helpers/fs.js";
import { closeSwarm, safeFlush } from "../_helpers/swarm.js";

const budgets = getLabBudgets();

test("lab-concern-job-submit-durability.single-transport", { timeout: budgets.outerTimeoutMs }, async (t) => {
  const topics = new Map();
  const topic = crypto.randomBytes(32);
  let authoritySwarm = createFakeSwarm({ topics });
  let remoteSwarm = createFakeSwarm({ topics });
  authoritySwarm.join(topic);
  remoteSwarm.join(topic);

  const authorityDir = mkTemp("lab-concern-job-submit-authority-");
  const remoteDir = mkTemp("lab-concern-job-submit-remote-");

  let authorityStore = null;
  let remoteStore = null;
  let concernAuthority = null;
  let concernRemote = null;

  try {
    authorityStore = new Corestore(authorityDir.dir);
    remoteStore = new Corestore(remoteDir.dir);
    await Promise.all([authorityStore.ready?.(), remoteStore.ready?.()]);

    concernAuthority = await ensureConcernSurface(
      authorityStore.namespace("concern"),
      authoritySwarm
    );

    concernRemote = await ensureConcernSurface(
      remoteStore.namespace("concern"),
      remoteSwarm,
      { key: concernAuthority.key }
    );

    await Promise.all([
      waitForSwarmConnections(authoritySwarm, { min: 1, timeoutMs: budgets.readyMs }),
      waitForSwarmConnections(remoteSwarm, { min: 1, timeoutMs: budgets.readyMs })
    ]);

    const peerRes = await waitForCorePeers(concernAuthority.local, {
      min: 1,
      timeoutMs: budgets.readyMs
    });
    t.ok(peerRes.reached, "authority concern writer core has at least one peer");

    const cap = "cap/lab-concern-job-submit-durability";
    const jobInput = { in: "job-durable" };

    const jobKey = await createJob(concernAuthority, cap, jobInput);
    await concernAuthority.update({ wait: true });

    const targetLength = concernAuthority.local.length;
    t.ok(targetLength > 0, "authority concern writer core length advanced after createJob");

    const barrier = await waitForPeerRemoteLengthAtLeast({
      core: concernAuthority.local,
      targetLength,
      swarms: [authoritySwarm, remoteSwarm],
      timeoutMs: budgets.convergeMs
    });
    t.ok(
      barrier.reached,
      `durability barrier reached: peer remoteLength=${barrier.remoteLength} target=${targetLength}`
    );

    await concernAuthority.close?.().catch(() => {});
    concernAuthority = null;
    await authorityStore.close?.().catch(() => {});
    authorityStore = null;
    await closeSwarm(authoritySwarm);
    authoritySwarm = null;

    const rec = await waitForJobRecord({
      concern: concernRemote,
      jobKey,
      swarms: [remoteSwarm],
      timeoutMs: budgets.convergeMs
    });

    t.ok(rec, "remote concern view materializes job after authority exits");
    t.ok(b4a.equals(rec.key, jobKey), "remote job key matches submitted job key");
    t.is(rec.value.cap, cap, "remote job cap matches submitted cap");
    t.alike(rec.value.in, jobInput, "remote job input matches submitted input");
  } finally {
    await concernRemote?.close?.().catch(() => {});
    await remoteStore?.close?.().catch(() => {});
    await closeSwarm(remoteSwarm);

    await concernAuthority?.close?.().catch(() => {});
    await authorityStore?.close?.().catch(() => {});
    await closeSwarm(authoritySwarm);

    authorityDir.cleanup();
    remoteDir.cleanup();
  }
});

async function waitForPeerRemoteLengthAtLeast({
  core,
  targetLength,
  swarms,
  timeoutMs
}) {
  const pollMs = 25;
  const tries = Math.max(1, Math.ceil(timeoutMs / pollMs));
  return getWait(null, "durability-barrier", {
    tries,
    interval: pollMs,
    getter: async () => {
      for (const swarm of swarms) {
        await safeFlush(swarm, pollMs).catch(() => {});
      }

      const peers = Array.isArray(core?.peers) ? core.peers : [];
      for (const peer of peers) {
        const remoteLength = Number.isInteger(peer?.remoteLength) ? peer.remoteLength : 0;
        if (remoteLength >= targetLength) {
          return {
            reached: true,
            remoteLength,
            peerCount: peers.length
          };
        }
      }
      return null;
    },
    predicate: (val) => val != null
  });
}

async function waitForJobRecord({ concern, jobKey, swarms, timeoutMs }) {
  const pollMs = 25;
  const tries = Math.max(1, Math.ceil(timeoutMs / pollMs));
  const jobView = getJobView(concern);

  return getWait(null, "remote-job-record", {
    tries,
    interval: pollMs,
    getter: async () => {
      for (const swarm of swarms) {
        await safeFlush(swarm, pollMs).catch(() => {});
      }
      await concern.update({ wait: true }).catch(() => {});
      return findJobByKey(jobView, jobKey);
    },
    predicate: (val) => val != null
  });
}

async function findJobByKey(jobView, jobKey) {
  const keyBuf = b4a.isBuffer(jobKey) ? jobKey : Buffer.from(jobKey);
  for await (const entry of jobView.createReadStream()) {
    if (b4a.equals(entry.key, keyBuf)) return entry;
  }
  return null;
}
