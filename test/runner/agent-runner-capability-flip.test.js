import test from "brittle";
import Corestore from "corestore";
import crypto from "crypto";
import fs from "fs";
import createFakeSwarm from "fakeswarm";
import idEncoding from "hypercore-id-encoding";
import Autobase from "autobase";

import { ensureDiscoverySurface, addConcern, addWriter as addDiscoveryWriter } from "../../src/discovery.js";
import { ensureConcernSurface, addWriter as addConcernWriter } from "../../src/concern.js";
import { createRunner } from "../../src/agent/runner.js";
import { mkTmp } from "../_helpers/fs.js";
import { closeSwarm } from "../_helpers/swarm.js";

const topicSeed = crypto.randomBytes(32);

function makeSwarmPair() {
  const topics = new Map();
  const a = createFakeSwarm({ topics });
  const b = createFakeSwarm({ topics });
  a.join(topicSeed);
  b.join(topicSeed);
  return { a, b };
}

async function tickUntil(runner, swarmHost, swarmRunner, { tries = 20 } = {}) {
  for (let i = 0; i < tries; i++) {
    await swarmHost.flush();
    await swarmRunner.flush();
    await runner.tick();
  }
}

async function createDiscoveryHost({ swarm }) {
  const dir = mkTmp("disc-host-");
  const store = new Corestore(dir);
  await store.ready?.();
  const disc = await ensureDiscoverySurface(store, {}, swarm);
  await addDiscoveryWriter(disc, disc.local.key);
  await disc.update({ wait: true });
  return { dir, store, disc };
}

async function createConcernHost({ swarm }) {
  const dir = mkTmp("concern-host-");
  const store = new Corestore(dir);
  await store.ready?.();
  const base = await ensureConcernSurface(store.namespace("concern"), swarm);
  await base.ready();
  await base.update();
  return { dir, store, base, key: base.key };
}

function cleanupDirs(...dirs) {
  dirs.forEach((d) => {
    if (!d) return;
    fs.rmSync(d, { recursive: true, force: true });
  });
}

async function closeMaybe(obj) {
  await obj?.close?.().catch(() => {});
}

test("late elevation does not change proposer-only behavior", async (t) => {
  let swarmHost;
  let swarmRunner;
  let discDir;
  let discStore;
  let disc;
  let concernHost;
  let runnerDir;
  let runnerStore;
  let runner;
  let orig = null;

  try {
    ({ a: swarmHost, b: swarmRunner } = makeSwarmPair());
    t.comment("swarms ready");

    ({ dir: discDir, store: discStore, disc } = await createDiscoveryHost({ swarm: swarmHost }));
    const discKeyZ = idEncoding.encode(disc.key);
    t.comment("discovery host ready");

    concernHost = await createConcernHost({ swarm: swarmHost });
    await addConcern(disc, idEncoding.encode(concernHost.key), "c");
    await disc.update({ wait: true });
    t.comment("concern advertised");

    runnerDir = mkTmp("runner-");
    runnerStore = new Corestore(runnerDir);
    await runnerStore.ready?.();
    t.comment("runner store ready");

    runner = await createRunner({
      role: "org",
      corestore: runnerStore,
      swarm: swarmRunner,
      discoveryKeys: [discKeyZ],
      warmN: 1,
      warmupBudget: { maxTicks: 0, maxMs: 0, minViewReadable: false },
      projector: async () => {},
    });

    let addWriterDuringRunner = false;
    orig = Autobase.prototype.addWriter;
    Autobase.prototype.addWriter = function (...args) {
      addWriterDuringRunner = true;
      return orig.apply(this, args);
    };

    // initial warm as non-writable
    await tickUntil(runner, swarmHost, swarmRunner, { tries: 5 });
    const status1 = runner.getStatus();
    t.ok(status1.warm.some((w) => w.status === "warmed" && w.isWritable === false));
    t.comment("runner warmed read-only");

    // host admits runner key
    const runnerNamespace = runnerStore.namespace(`concern-${concernHost.key.toString("hex")}`);
    const runnerKey = await Autobase.getLocalKey(runnerNamespace);
    t.comment("runner key derived");
    await addConcernWriter(concernHost.base, runnerKey);
    await concernHost.base.update({ wait: true });
    t.comment("writer admitted");

    await tickUntil(runner, swarmHost, swarmRunner, { tries: 10 });
    const status2 = runner.getStatus();
    t.ok(status2.warm.some((w) => w.status === "warmed" && w.isWritable === true));
    t.is(addWriterDuringRunner, false);
  } finally {
    if (orig) Autobase.prototype.addWriter = orig;
    await closeMaybe(runner);
    await closeMaybe(runnerStore);
    await closeMaybe(concernHost?.base);
    await closeMaybe(concernHost?.store);
    await closeMaybe(disc);
    await closeMaybe(discStore);
    await closeSwarm(swarmRunner);
    await closeSwarm(swarmHost);
    cleanupDirs(discDir, runnerDir, concernHost?.dir);
  }
});

test("revocation/reopen degrades gracefully without authority actions", async (t) => {
  let swarmHost;
  let swarmRunner;
  let discDir;
  let discStore;
  let disc;
  let discKeyZ;
  let concernHost;
  let runnerDir1;
  let runnerStore1;
  let runner1;
  let runnerDir2;
  let runnerStore2;
  let runner2;
  let orig = null;

  try {
    ({ a: swarmHost, b: swarmRunner } = makeSwarmPair());
    t.comment("swarm ready");

    ({ dir: discDir, store: discStore, disc } = await createDiscoveryHost({ swarm: swarmHost }));
    discKeyZ = idEncoding.encode(disc.key);
    t.comment("discovery host ready");

    concernHost = await createConcernHost({ swarm: swarmHost });
    await addConcern(disc, idEncoding.encode(concernHost.key), "c2");
    await disc.update({ wait: true });
    t.comment("concern advertised");

    // First runner (admitted)
    runnerDir1 = mkTmp("runner1-");
    runnerStore1 = new Corestore(runnerDir1);
    await runnerStore1.ready?.();
    t.comment("runner1 store ready");

    runner1 = await createRunner({
      role: "org",
      corestore: runnerStore1,
      swarm: swarmRunner,
      discoveryKeys: [discKeyZ],
      warmN: 1,
      warmupBudget: { maxTicks: 0, maxMs: 0, minViewReadable: false },
      projector: async () => {},
    });
    t.comment("runner1 created");

    // admit runner1
    const runner1Key = await Autobase.getLocalKey(runnerStore1.namespace(`concern-${concernHost.key.toString("hex")}`));
    await addConcernWriter(concernHost.base, runner1Key);
    await concernHost.base.update({ wait: true });
    await tickUntil(runner1, swarmHost, swarmRunner, { tries: 6 });
    t.comment("runner1 ticked");
    t.ok(runner1.getStatus().warm.some((w) => w.isWritable));

    await closeMaybe(runner1);
    runner1 = null;
    await closeMaybe(runnerStore1);
    runnerStore1 = null;
    if (runnerDir1) fs.rmSync(runnerDir1, { recursive: true, force: true });
    runnerDir1 = null;
    t.comment("runner1 closed");

    // New runner (revoked/not admitted) should still warm without authority actions
    runnerDir2 = mkTmp("runner2-");
    runnerStore2 = new Corestore(runnerDir2);
    await runnerStore2.ready?.();

    let addWriterDuringRunner = false;
    orig = Autobase.prototype.addWriter;
    Autobase.prototype.addWriter = function (...args) {
      addWriterDuringRunner = true;
      return orig.apply(this, args);
    };

    runner2 = await createRunner({
      role: "org",
      corestore: runnerStore2,
      swarm: swarmRunner,
      discoveryKeys: [discKeyZ],
      warmN: 1,
      warmupBudget: { maxTicks: 0, maxMs: 0, minViewReadable: false },
      projector: async () => {},
    });

    await tickUntil(runner2, swarmHost, swarmRunner, { tries: 8 });
    const status = runner2.getStatus();
    t.ok(status.warm.some((w) => w.status === "warmed"));
    t.is(addWriterDuringRunner, false);
    t.comment("runner2 warmed");
  } finally {
    if (orig) Autobase.prototype.addWriter = orig;
    await closeMaybe(runner2);
    await closeMaybe(runnerStore2);
    await closeMaybe(runner1);
    await closeMaybe(runnerStore1);
    await closeMaybe(concernHost?.base);
    await closeMaybe(concernHost?.store);
    await closeMaybe(disc);
    await closeMaybe(discStore);
    await closeSwarm(swarmRunner);
    await closeSwarm(swarmHost);
    cleanupDirs(discDir, runnerDir1, runnerDir2, concernHost?.dir);
  }
});
