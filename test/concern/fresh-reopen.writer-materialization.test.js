import test from "brittle";
import fs from "fs";
import Corestore from "corestore";
import crypto from "crypto";
import createFakeSwarm from "fakeswarm";

import {
  ensureConcernSurface,
  addWriter,
  createJob
} from "../../src/concern.js";
import { mkTmp } from "../_helpers/fs.js";
import { closeSwarm, safeFlush } from "../_helpers/swarm.js";

async function waitForWritableBase({ base, hostSwarm, replicaSwarm, timeoutMs = 8000 }) {
  const stopAt = Date.now() + timeoutMs;
  while (Date.now() < stopAt) {
    await safeFlush(hostSwarm, 25).catch(() => {});
    await safeFlush(replicaSwarm, 25).catch(() => {});
    await base.update({ wait: false }).catch(() => {});
    if (base.writable) return true;
  }
  return false;
}

test("fresh reopened concern materializes admitted replica writer after barrier append", async (t) => {
  const topics = new Map();
  const topic = crypto.randomBytes(32);
  const hostSwarm = createFakeSwarm({ topics });
  const replicaSwarm = createFakeSwarm({ topics });
  hostSwarm.join(topic);
  replicaSwarm.join(topic);

  const dirs = [];
  let authorityStore = null;
  let authorityBase = null;
  let replicaStore = null;
  let replicaBase = null;
  let seedStore = null;
  let seedBase = null;

  try {
    const authorityDir = mkTmp("fresh-reopen-authority-");
    const replicaDir = mkTmp("fresh-reopen-replica-");
    dirs.push(authorityDir, replicaDir);

    // Cold-start shape: create the concern once, close it, then reopen by key.
    seedStore = new Corestore(authorityDir);
    await seedStore.ready?.();
    seedBase = await ensureConcernSurface(seedStore.namespace("concern-host"), hostSwarm);
    await seedBase.update({ wait: true });
    const concernKey = seedBase.key;
    await seedBase.close().catch(() => {});
    await seedStore.close().catch(() => {});
    seedBase = null;
    seedStore = null;

    authorityStore = new Corestore(authorityDir);
    replicaStore = new Corestore(replicaDir);
    await Promise.all([authorityStore.ready?.(), replicaStore.ready?.()]);

    authorityBase = await ensureConcernSurface(
      authorityStore.namespace("concern-host"),
      hostSwarm,
      { key: concernKey }
    );
    await authorityBase.update({ wait: false }).catch(() => {});
    t.is(authorityBase.writable, true, "authority concern reopened writable");

    replicaBase = await ensureConcernSurface(
      replicaStore.namespace("concern-host"),
      replicaSwarm,
      { key: concernKey }
    );
    await replicaBase.update({ wait: false }).catch(() => {});
    t.is(replicaBase.writable, false, "replica starts non-writable before admission");

    await addWriter(authorityBase, replicaBase.local.key);
    await authorityBase.update({ wait: true }).catch(() => {});

    const barrierKey = await createJob(authorityBase, "cap/test/fresh-reopen-barrier", {
      kind: "fresh-reopen-barrier",
      at: new Date().toISOString()
    });
    await authorityBase.update({ wait: true }).catch(() => {});
    t.ok(barrierKey, "barrier append succeeded after writer admission");

    const materialized = await waitForWritableBase({
      base: replicaBase,
      hostSwarm,
      replicaSwarm,
      timeoutMs: 8000
    });

    t.is(materialized, true, "replica writer became writable after admission");
    t.is(replicaBase.writable, true, "replica concern is writable after materialization");
  } finally {
    await replicaBase?.close?.().catch(() => {});
    await replicaStore?.close?.().catch(() => {});
    await authorityBase?.close?.().catch(() => {});
    await authorityStore?.close?.().catch(() => {});
    await seedBase?.close?.().catch(() => {});
    await seedStore?.close?.().catch(() => {});
    await closeSwarm(replicaSwarm);
    await closeSwarm(hostSwarm);
    for (const dir of dirs) fs.rmSync(dir, { recursive: true, force: true });
  }
});
