import test from "brittle";
import Corestore from "corestore";
import crypto from "crypto";
import b4a from "b4a";
import createFakeSwarm from "fakeswarm";

import {
  ensureDiscoverySurface,
  addConcern,
  addWriter as addDiscoveryWriter,
  KIND
} from "../../src/discovery.js";
import { waitForSwarmConnections } from "../../src/util/waiters/swarm.js";
import { waitForCorePeers } from "../../src/util/waiters/core.js";
import { getWait } from "../../src/getWait.js";
import { getLabBudgets } from "../_helpers/lab-budgets.js";
import { mkTemp } from "../_helpers/fs.js";
import { closeSwarm, safeFlush } from "../_helpers/swarm.js";
import { findByKey } from "../_helpers/view.js";

const budgets = getLabBudgets();

test("lab-stateless-authority-cli-durability.single-transport", { timeout: budgets.outerTimeoutMs }, async (t) => {
  const topics = new Map();
  const topic = crypto.randomBytes(32);
  let authoritySwarm = createFakeSwarm({ topics });
  let remoteSwarm = createFakeSwarm({ topics });
  authoritySwarm.join(topic);
  remoteSwarm.join(topic);

  const authorityDir = mkTemp("lab-stateless-cli-authority-");
  const remoteDir = mkTemp("lab-stateless-cli-remote-");

  let authorityStore = null;
  let remoteStore = null;
  let discoveryAuthority = null;
  let discoveryRemote = null;

  try {
    authorityStore = new Corestore(authorityDir.dir);
    remoteStore = new Corestore(remoteDir.dir);
    await Promise.all([authorityStore.ready?.(), remoteStore.ready?.()]);

    discoveryAuthority = await ensureDiscoverySurface(
      authorityStore.namespace("discovery"),
      {},
      authoritySwarm
    );
    await addDiscoveryWriter(discoveryAuthority, discoveryAuthority.local.key);
    await discoveryAuthority.update({ wait: true });

    discoveryRemote = await ensureDiscoverySurface(
      remoteStore.namespace("discovery"),
      { key: discoveryAuthority.key },
      remoteSwarm
    );

    await Promise.all([
      waitForSwarmConnections(authoritySwarm, { min: 1, timeoutMs: budgets.readyMs }),
      waitForSwarmConnections(remoteSwarm, { min: 1, timeoutMs: budgets.readyMs })
    ]);

    const peerRes = await waitForCorePeers(discoveryAuthority.local, {
      min: 1,
      timeoutMs: budgets.readyMs
    });
    t.ok(peerRes.reached, "authority writer core has at least one peer");

    const concernKey = crypto.randomBytes(32);
    const label = "lab-stateless-cli-durability";

    await addConcern(discoveryAuthority, concernKey, label);
    await discoveryAuthority.update({ wait: true });
    const targetLength = discoveryAuthority.local.length;
    t.ok(targetLength > 0, "authority local feed has appended entries");

    const barrier = await waitForPeerRemoteLengthAtLeast({
      core: discoveryAuthority.local,
      targetLength,
      authoritySwarm,
      remoteSwarm,
      timeoutMs: budgets.convergeMs
    });
    t.ok(
      barrier.reached,
      `durability barrier reached: peer remoteLength=${barrier.remoteLength} target=${targetLength}`
    );

    // Simulate stateless CLI exit after durability barrier.
    await discoveryAuthority.close?.().catch(() => {});
    discoveryAuthority = null;
    await authorityStore.close?.().catch(() => {});
    authorityStore = null;
    await closeSwarm(authoritySwarm);
    authoritySwarm = null;

    await safeFlush(remoteSwarm);
    await discoveryRemote.update({ wait: true });
    const rec = await findByKey(discoveryRemote.view, concernKey);

    t.ok(rec, "remote replica can read advertised concern after authority exits");
    t.is(rec.t, KIND.CONCERN, "remote record type is concern");
    t.ok(b4a.equals(rec.k32, concernKey), "remote record key matches concern key");
    t.is(rec.v, label, "remote record label matches appended label");
  } finally {
    await discoveryRemote?.close?.().catch(() => {});
    await remoteStore?.close?.().catch(() => {});
    await closeSwarm(remoteSwarm);

    await discoveryAuthority?.close?.().catch(() => {});
    await authorityStore?.close?.().catch(() => {});
    await closeSwarm(authoritySwarm);

    authorityDir.cleanup();
    remoteDir.cleanup();
  }
});

async function waitForPeerRemoteLengthAtLeast({
  core,
  targetLength,
  authoritySwarm,
  remoteSwarm,
  timeoutMs
}) {
  const pollMs = 25;
  const tries = Math.max(1, Math.ceil(timeoutMs / pollMs));
  const reached = await getWait(null, "durability-barrier", {
    tries,
    interval: pollMs,
    getter: async () => {
      await safeFlush(authoritySwarm, pollMs).catch(() => {});
      await safeFlush(remoteSwarm, pollMs).catch(() => {});

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
  return reached;
}

