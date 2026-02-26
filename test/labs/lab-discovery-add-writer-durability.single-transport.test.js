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

test("lab-discovery-add-writer-durability.single-transport", { timeout: budgets.outerTimeoutMs }, async (t) => {
  const topics = new Map();
  const topic = crypto.randomBytes(32);
  let authoritySwarm = createFakeSwarm({ topics });
  let remoteSwarm = createFakeSwarm({ topics });
  let writerSwarm = createFakeSwarm({ topics });
  authoritySwarm.join(topic);
  remoteSwarm.join(topic);
  writerSwarm.join(topic);

  const authorityDir = mkTemp("lab-discovery-add-writer-authority-");
  const remoteDir = mkTemp("lab-discovery-add-writer-remote-");
  const writerDir = mkTemp("lab-discovery-add-writer-new-writer-");

  let authorityStore = null;
  let remoteStore = null;
  let writerStore = null;
  let discoveryAuthority = null;
  let discoveryRemote = null;
  let discoveryWriter = null;

  try {
    authorityStore = new Corestore(authorityDir.dir);
    remoteStore = new Corestore(remoteDir.dir);
    writerStore = new Corestore(writerDir.dir);
    await Promise.all([
      authorityStore.ready?.(),
      remoteStore.ready?.(),
      writerStore.ready?.()
    ]);

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

    discoveryWriter = await ensureDiscoverySurface(
      writerStore.namespace("discovery"),
      { key: discoveryAuthority.key },
      writerSwarm
    );

    await Promise.all([
      waitForSwarmConnections(authoritySwarm, { min: 1, timeoutMs: budgets.readyMs }),
      waitForSwarmConnections(remoteSwarm, { min: 1, timeoutMs: budgets.readyMs }),
      waitForSwarmConnections(writerSwarm, { min: 1, timeoutMs: budgets.readyMs })
    ]);

    const peerRes = await waitForCorePeers(discoveryAuthority.local, {
      min: 1,
      timeoutMs: budgets.readyMs
    });
    t.ok(peerRes.reached, "authority discovery writer core has at least one peer");

    const newWriterKey = discoveryWriter.local.key;
    t.absent(
      b4a.equals(newWriterKey, discoveryAuthority.local.key),
      "new writer key differs from authority writer key"
    );

    await addDiscoveryWriter(discoveryAuthority, newWriterKey);
    await discoveryAuthority.update({ wait: true });

    const targetLength = discoveryAuthority.local.length;
    t.ok(targetLength > 0, "authority discovery writer core length advanced after add-writer");

    const barrier = await waitForPeerRemoteLengthAtLeast({
      core: discoveryAuthority.local,
      targetLength,
      swarms: [authoritySwarm, remoteSwarm, writerSwarm],
      timeoutMs: budgets.convergeMs
    });
    t.ok(
      barrier.reached,
      `durability barrier reached: peer remoteLength=${barrier.remoteLength} target=${targetLength}`
    );

    const writerWritable = await waitForWritableBase({
      base: discoveryWriter,
      swarms: [authoritySwarm, writerSwarm],
      timeoutMs: budgets.convergeMs
    });
    t.ok(writerWritable, "newly admitted writer becomes writable before authority exit");

    await discoveryAuthority.close?.().catch(() => {});
    discoveryAuthority = null;
    await authorityStore.close?.().catch(() => {});
    authorityStore = null;
    await closeSwarm(authoritySwarm);
    authoritySwarm = null;

    const concernKey = crypto.randomBytes(32);
    const label = "lab-discovery-add-writer-durability";

    await addConcern(discoveryWriter, concernKey, label);
    await discoveryWriter.update({ wait: true });

    const rec = await waitForDiscoveryRecord({
      discovery: discoveryRemote,
      key: concernKey,
      swarms: [writerSwarm, remoteSwarm],
      timeoutMs: budgets.convergeMs
    });

    t.ok(rec, "remote replica can read concern advertisement appended by newly admitted writer");
    t.is(rec.t, KIND.CONCERN, "remote record type is concern");
    t.ok(b4a.equals(rec.k32, concernKey), "remote record key matches concern key from new writer");
    t.is(rec.v, label, "remote record label matches writer append");
  } finally {
    await discoveryWriter?.close?.().catch(() => {});
    await writerStore?.close?.().catch(() => {});
    await closeSwarm(writerSwarm);

    await discoveryRemote?.close?.().catch(() => {});
    await remoteStore?.close?.().catch(() => {});
    await closeSwarm(remoteSwarm);

    await discoveryAuthority?.close?.().catch(() => {});
    await authorityStore?.close?.().catch(() => {});
    await closeSwarm(authoritySwarm);

    authorityDir.cleanup();
    remoteDir.cleanup();
    writerDir.cleanup();
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

async function waitForWritableBase({ base, swarms, timeoutMs }) {
  const pollMs = 25;
  const tries = Math.max(1, Math.ceil(timeoutMs / pollMs));
  const res = await getWait(null, "writer-writable", {
    tries,
    interval: pollMs,
    getter: async () => {
      for (const swarm of swarms) {
        await safeFlush(swarm, pollMs).catch(() => {});
      }
      await base.update({ wait: false }).catch(() => {});
      return base.writable ? true : null;
    },
    predicate: (val) => val === true
  });
  return res === true;
}

async function waitForDiscoveryRecord({ discovery, key, swarms, timeoutMs }) {
  const pollMs = 25;
  const tries = Math.max(1, Math.ceil(timeoutMs / pollMs));
  return getWait(null, "remote-discovery-record", {
    tries,
    interval: pollMs,
    getter: async () => {
      for (const swarm of swarms) {
        await safeFlush(swarm, pollMs).catch(() => {});
      }
      await discovery.update({ wait: true }).catch(() => {});
      return findByKey(discovery.view, key);
    },
    predicate: (val) => val != null
  });
}
