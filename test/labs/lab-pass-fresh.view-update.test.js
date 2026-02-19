import test from "brittle";
import fs from "fs";
import Corestore from "corestore";
import crypto from "crypto";
import createFakeSwarm from "fakeswarm";
import idEncoding from "hypercore-id-encoding";
import b4a from "b4a";
import { ensureDiscoverySurface, addConcern, addWriter as addDiscoveryWriter } from "../../src/discovery.js";
import { ensureConcernSurface, createJob, getPublishView, publishJobWork, OP } from "../../src/concern.js";
import { createRunner } from "../../src/agent/runner.js";
import { mkTmp } from "../_helpers/fs.js";
import { closeSwarm, safeFlush } from "../_helpers/swarm.js";

// Proves pass-fresh projector reads: same runner sees ctx.pubs() move 0 -> 1 across two ticks.
// Uses fakeswarm for deterministic, low-noise replication in a single-transport harness.
// Gates tick-2 expectation on derived PUB leaf materialization (acceptance), not append success.
test("lab-pass-fresh.view-update", async (t) => {
  const topic = crypto.randomBytes(32), topics = new Map();
  const hostSwarm = createFakeSwarm({ topics }); hostSwarm.join(topic);
  const orgSwarm = createFakeSwarm({ topics }), publisherSwarm = createFakeSwarm({ topics }); orgSwarm.join(topic); publisherSwarm.join(topic);
  const dirs = [];
  let disc, concernHost, publisherBase, publisherStore, runnerStore, runner;
  try {
    const discDir = mkTmp("lab-pass-fresh-disc-");
    const hostDir = mkTmp("lab-pass-fresh-host-");
    const pubDir = mkTmp("lab-pass-fresh-pub-");
    const runnerDir = mkTmp("lab-pass-fresh-runner-");
    dirs.push(discDir, hostDir, pubDir, runnerDir);
    const discStore = new Corestore(discDir);
    const concernStore = new Corestore(hostDir);
    publisherStore = new Corestore(pubDir);
    runnerStore = new Corestore(runnerDir);
    await Promise.all([discStore.ready?.(), concernStore.ready?.(), publisherStore.ready?.(), runnerStore.ready?.()]);
    disc = await ensureDiscoverySurface(discStore.namespace("discovery"), {}, hostSwarm);
    await addDiscoveryWriter(disc, disc.local.key);
    await disc.update({ wait: true });
    concernHost = await ensureConcernSurface(concernStore.namespace("concern-host"), hostSwarm);
    await concernHost.append({ op: OP.STATE, v: 1, econ: { mode: 0, attemptBurn: 0, ratBurn: 0 } }, { optimistic: false });
    await concernHost.update({ wait: true });
    const concernHex = b4a.toString(concernHost.key, "hex");
    publisherBase = await ensureConcernSurface(publisherStore.namespace(`concern-${concernHex}`), publisherSwarm, { key: concernHost.key });
    const jobKey = await createJob(concernHost, "cap/lab-pass-fresh", { in: "job" });
    const attemptToken = crypto.randomBytes(32);
    await addConcern(disc, idEncoding.encode(concernHost.key), "lab-pass-fresh.view-update");
    await disc.update({ wait: true });
    const observations = [], discKey = idEncoding.encode(disc.key);
    runner = await createRunner({
      role: "org",
      corestore: runnerStore,
      swarm: orgSwarm,
      discoveryKeys: [discKey],
      warmN: 1,
      warmupBudget: { maxTicks: 0, maxMs: 0, minViewReadable: true },
      projector: async (ctx) => observations.push(await observePubs(ctx, jobKey, attemptToken, 2000))
    });
    const sameRunner = runner;
    await tickOnce({ hostSwarm, orgSwarm, publisherSwarm, concernHost, publisherBase, runner, label: "tick1" });
    t.is(observations.length, 1);
    t.is(observations[0].count, 0);
    await publishJobWork(publisherBase, jobKey, "cap/lab-pass-fresh-pub", { t: "result", k: jobKey, a: attemptToken });
    const hostLeaf = await waitForAcceptedPub({
      deadlineMs: 8000,
      hostSwarm,
      orgSwarm,
      publisherSwarm,
      concernHost,
      publisherBase,
      jobKey,
      attemptToken
    });
    t.ok(!!hostLeaf);
    await tickOnce({ hostSwarm, orgSwarm, publisherSwarm, concernHost, publisherBase, runner, label: "tick2" });
    t.is(observations.length, 2); t.is(observations[1].count, 1);
    t.ok(observations[1].sawAttempt);
    t.is(runner, sameRunner);
  } finally {
    await runner?.close?.().catch(() => {});
    await runnerStore?.close?.().catch(() => {});
    await concernHost?.close?.().catch(() => {});
    await Promise.all([publisherBase?.close?.().catch(() => {}), publisherStore?.close?.().catch(() => {})]);
    await disc?.close?.().catch(() => {});
    await Promise.all([closeSwarm(publisherSwarm), closeSwarm(orgSwarm), closeSwarm(hostSwarm)]);
    for (const dir of dirs) fs.rmSync(dir, { recursive: true, force: true });
  }
});
async function tickOnce({ hostSwarm, orgSwarm, publisherSwarm, concernHost, publisherBase, runner, label }) {
  await safeFlush(hostSwarm);
  await safeFlush(orgSwarm);
  await safeFlush(publisherSwarm);
  await concernHost.update().catch(() => {});
  await publisherBase.update().catch(() => {});
  await withTimeout(runner.tick(), 8000, label);
}
async function observePubs(ctx, jobKey, attemptToken, maxMs) {
  const iter = ctx.pubs()[Symbol.asyncIterator]();
  try {
    const stopAt = Date.now() + maxMs;
    let count = 0;
    while (Date.now() < stopAt) {
      const next = await Promise.race([iter.next(), new Promise((r) => setTimeout(() => r(null), Math.max(1, stopAt - Date.now())))]);
      if (!next || next.done) break;
      if (!b4a.equals(next.value.jobKey, jobKey)) continue;
      count += 1;
      if (b4a.equals(next.value.attempt, attemptToken)) return { count, sawAttempt: true };
    }
    return { count, sawAttempt: false };
  } finally {
    await iter.return?.().catch(() => {});
  }
}
async function withTimeout(promise, timeoutMs, label) {
  let timer = null;
  const timeout = new Promise((_, reject) => { timer = setTimeout(() => reject(new Error(`${label} timed out`)), timeoutMs); });
  try { return await Promise.race([promise, timeout]); } finally { clearTimeout(timer); }
}
async function probeAcceptedPub(concernHost, jobKey, publisherKey, attemptToken) {
  const publishView = getPublishView(concernHost);
  return publishView
    .sub(jobKey)
    .sub(publisherKey)
    .get(attemptToken, { valueEncoding: publishView.valueEncoding })
    .catch(() => null);
}
async function waitForAcceptedPub({ deadlineMs, hostSwarm, orgSwarm, publisherSwarm, concernHost, publisherBase, jobKey, attemptToken }) {
  const stopAt = Date.now() + deadlineMs;
  const publisherKey = publisherBase.local.key;
  while (Date.now() < stopAt) {
    await safeFlush(hostSwarm);
    await safeFlush(orgSwarm);
    await safeFlush(publisherSwarm);
    await concernHost.update({ wait: true }).catch(() => {});
    await publisherBase.update({ wait: true }).catch(() => {});
    const leaf = await probeAcceptedPub(concernHost, jobKey, publisherKey, attemptToken);
    if (leaf) return leaf;
  }
  throw new Error(`assertion failed: accepted PUB leaf not observed within ${deadlineMs}ms before tick2`);
}
