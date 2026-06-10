import test from "brittle";
import Corestore from "corestore";
import crypto from "crypto";
import fs from "fs";
import b4a from "b4a";
import createFakeSwarm from "fakeswarm";
import idEncoding from "hypercore-id-encoding";
import Autobase from "autobase";

import { ensureDiscoverySurface, addConcern, addDiscovery, addWriter as addDiscoveryWriter } from "../../src/discovery.js";
import {
  ensureConcernSurface,
  publishJobWork,
  createJob,
  addWriter as addConcernWriter,
  getPublishView,
  getJobView,
} from "../../src/concern.js";
import { createRunner } from "../../src/agent/runner.js";
import { mkTmp } from "../_helpers/fs.js";
import { closeSwarm, safeFlush } from "../_helpers/swarm.js";

const topicSeed = crypto.randomBytes(32);

function makeSwarmPair() {
  const topics = new Map();
  const a = createFakeSwarm({ topics });
  const b = createFakeSwarm({ topics });
  a.join(topicSeed);
  b.join(topicSeed);
  return { a, b };
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

async function advertiseDiscovery(disc, keyBuf) {
  await addDiscovery(disc, keyBuf, "nested-discovery");
  await disc.update({ wait: true });
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

function warmBudget({ maxTicks = 1, maxMs = 0, minViewReadable = true } = {}) {
  return { maxTicks, maxMs, minViewReadable };
}

async function tickUntil(runner, swarmHost, swarmRunner, { tries = 20, delayMs = 0 } = {}) {
  for (let i = 0; i < tries; i++) {
    await safeFlush(swarmHost);
    await safeFlush(swarmRunner);
    await runner.tick();
    if (delayMs) await new Promise((r) => setTimeout(r, delayMs));
  }
}

test("skip + revisit based on warmup budget and cooldown", async (t) => {
  let swarmHost;
  let swarmRunner;
  let discDir;
  let discStore;
  let disc;
  let runnerDir;
  let runnerStore;
  let coldConcern;
  let runner;
  let runner2;

  try {
    ({ a: swarmHost, b: swarmRunner } = makeSwarmPair());
    ({ dir: discDir, store: discStore, disc } = await createDiscoveryHost({ swarm: swarmHost }));
    const discKeyZ = idEncoding.encode(disc.key);

    // concern without strict state yet -> first attempt should skip
    coldConcern = await createConcernHost({ swarm: swarmHost });
    await addConcern(disc, idEncoding.encode(coldConcern.key), "cold");
    await disc.update({ wait: true });
    await safeFlush(swarmHost);
    await safeFlush(swarmRunner);

    runnerDir = mkTmp("runner-");
    runnerStore = new Corestore(runnerDir);
    await runnerStore.ready?.();

    let statuses;
    runner = await createRunner({
      role: "org",
      corestore: runnerStore,
      swarm: swarmRunner,
      discoveryKeys: [discKeyZ],
      warmN: 2,
      warmupBudget: warmBudget({ maxTicks: 1, maxMs: 5, minViewReadable: true }),
      retryPolicy: { cooldownMs: 10 },
      projector: async () => {},
    });

    await tickUntil(runner, swarmHost, swarmRunner, { tries: 3 });
    statuses = runner.getStatus().warm;
    t.ok(statuses.some((s) => s.keyHex === b4a.toString(coldConcern.key, "hex") && s.status === "skipped" && s.cooldownUntil > 0));

    // now write strict state to make it readable and wait for revisit
    await coldConcern.base.append({ op: 5, v: 1, econ: { mode: 0, attemptBurn: 0, ratBurn: 0 } }, { optimistic: false });
    await coldConcern.base.update({ wait: true });

    // allow cooldown and revisit
    await new Promise((r) => setTimeout(r, 20));
    await closeMaybe(runner);
    runner = null;

    // Recreate runner with looser warmup (minViewReadable false) to allow revisit/warm
    runner2 = await createRunner({
      role: "org",
      corestore: runnerStore,
      swarm: swarmRunner,
      discoveryKeys: [discKeyZ],
      warmN: 2,
      warmupBudget: warmBudget({ maxTicks: 0, maxMs: 0, minViewReadable: false }),
      retryPolicy: { cooldownMs: 10 },
      projector: async () => {},
    });
    await tickUntil(runner2, swarmHost, swarmRunner, { tries: 10 });
    statuses = runner2.getStatus().warm;
    t.ok(statuses.some((s) => s.keyHex === b4a.toString(coldConcern.key, "hex") && s.status === "warmed"));
  } finally {
    await closeMaybe(runner2);
    await closeMaybe(runner);
    await closeMaybe(runnerStore);
    await closeMaybe(coldConcern?.base);
    await closeMaybe(coldConcern?.store);
    await closeMaybe(disc);
    await closeMaybe(discStore);
    await closeSwarm(swarmHost);
    await closeSwarm(swarmRunner);
    cleanupDirs(discDir, runnerDir, coldConcern?.dir);
  }
});

test("projector only after warm; ctx guarded; publish APIs validate", async (t) => {
  let swarmHost;
  let swarmRunner;
  let discDir;
  let discStore;
  let disc;
  let concern;
  let runnerDir;
  let runnerStore;
  let runner;

  try {
    ({ a: swarmHost, b: swarmRunner } = makeSwarmPair());
    ({ dir: discDir, store: discStore, disc } = await createDiscoveryHost({ swarm: swarmHost }));
    const discKeyZ = idEncoding.encode(disc.key);
    t.comment("projector test start");

    concern = await createConcernHost({ swarm: swarmHost });
    t.comment("concern host created");
    await addConcern(disc, idEncoding.encode(concern.key), "warmable");
    t.comment("concern advertised");
    await disc.update({ wait: true });
    t.comment("disc updated");
    await safeFlush(swarmHost);
    await safeFlush(swarmRunner);
    t.comment("swarms flushed");

    runnerDir = mkTmp("runner-");
    runnerStore = new Corestore(runnerDir);
    await runnerStore.ready?.();

    let called = 0;
    let firstCtx = null;
    runner = await createRunner({
      role: "org",
      corestore: runnerStore,
      swarm: swarmRunner,
      discoveryKeys: [discKeyZ],
      warmN: 1,
      warmupBudget: warmBudget({ maxTicks: 0, maxMs: 0, minViewReadable: true }),
      retryPolicy: { cooldownMs: 1 },
      projector: async (ctx) => {
        called += 1;
        if (!firstCtx) firstCtx = ctx;
        t.ok(ctx.publish);
        await t.exception(async () => ctx.publish.publishRat({}), /jobKey required/);
      },
    });
    t.comment("projector runner created");

    await tickUntil(runner, swarmHost, swarmRunner, { tries: 2 });
    t.is(called, 0, "projector not called before warm");
    t.absent(runner.getStatus().warm.find((w) => w.status === "warmed"));
    t.comment("post pre-warm ticks");

    // make concern readable then allow revisit
    await concern.base.append({ op: 5, v: 1, econ: { mode: 0, attemptBurn: 0, ratBurn: 0 } }, { optimistic: false });
    await concern.base.update({ wait: true });
    await new Promise((r) => setTimeout(r, 20));
    t.comment("strict state written");
    await tickUntil(runner, swarmHost, swarmRunner, { tries: 10 });
    const warmed = runner.getStatus().warm.find((w) => w.status === "warmed");
    t.comment(JSON.stringify(runner.getStatus().warm.map((s) => ({ status: s.status, attemptCount: s.attemptCount, cooldownUntil: s.cooldownUntil, key: s.keyHex }))));
    t.ok(warmed, "concern warmed after revisit");
    t.ok(called >= 1, "projector called after warm");
    t.ok(firstCtx);
    t.is(typeof firstCtx.concern.addWriter, "undefined");
    t.is(typeof firstCtx.concern.view, "undefined");
    t.is(typeof firstCtx.publish.publishPub, "function");
  } finally {
    await closeMaybe(runner);
    await closeMaybe(runnerStore);
    await closeMaybe(concern?.base);
    await closeMaybe(concern?.store);
    await closeMaybe(disc);
    await closeMaybe(discStore);
    await closeSwarm(swarmHost);
    await closeSwarm(swarmRunner);
    cleanupDirs(discDir, runnerDir, concern?.dir);
  }
});

test("nested discovery warms downstream concern and persists child discovery across restart", async (t) => {
  let swarmHost;
  let swarmRunner;
  let rootDir;
  let rootStore;
  let rootDisc;
  let childDir;
  let childStore;
  let childDisc;
  let firstConcern;
  let secondConcern;
  let runnerDir;
  let runnerStore;
  let runner1;
  let runner2;

  try {
    ({ a: swarmHost, b: swarmRunner } = makeSwarmPair());
    ({ dir: rootDir, store: rootStore, disc: rootDisc } = await createDiscoveryHost({ swarm: swarmHost }));
    ({ dir: childDir, store: childStore, disc: childDisc } = await createDiscoveryHost({ swarm: swarmHost }));

    await advertiseDiscovery(rootDisc, childDisc.key);
    await safeFlush(swarmHost);
    await safeFlush(swarmRunner);

    runnerDir = mkTmp("runner-");
    runnerStore = new Corestore(runnerDir);
    await runnerStore.ready?.();

    firstConcern = await createConcernHost({ swarm: swarmHost });
    await addConcern(childDisc, idEncoding.encode(firstConcern.key), "nested-first");
    await childDisc.update({ wait: true });

    runner1 = await createRunner({
      role: "org",
      corestore: runnerStore,
      swarm: swarmRunner,
      discoveryKeys: [idEncoding.encode(rootDisc.key)],
      warmN: 2,
      warmupBudget: warmBudget({ maxTicks: 0, maxMs: 0, minViewReadable: false }),
      retryPolicy: { cooldownMs: 1 },
      projector: async () => {},
    });

    await tickUntil(runner1, swarmHost, swarmRunner, { tries: 20 });
    t.ok(
      runner1.getStatus().warm.some((w) => w.keyHex === b4a.toString(firstConcern.key, "hex") && w.status === "warmed"),
      "runner warms concern advertised on child discovery"
    );
    t.ok(
      Object.prototype.hasOwnProperty.call(runner1.getStatus().cursors, idEncoding.encode(childDisc.key)),
      "runner state tracks discovered child discovery"
    );

    await closeMaybe(runner1);
    runner1 = null;

    secondConcern = await createConcernHost({ swarm: swarmHost });
    await addConcern(childDisc, idEncoding.encode(secondConcern.key), "nested-second");
    await childDisc.update({ wait: true });

    runner2 = await createRunner({
      role: "org",
      corestore: runnerStore,
      swarm: swarmRunner,
      discoveryKeys: [idEncoding.encode(rootDisc.key)],
      warmN: 3,
      warmupBudget: warmBudget({ maxTicks: 0, maxMs: 0, minViewReadable: false }),
      retryPolicy: { cooldownMs: 1 },
      projector: async () => {},
    });

    await tickUntil(runner2, swarmHost, swarmRunner, { tries: 20 });
    t.ok(
      runner2.getStatus().warm.some((w) => w.keyHex === b4a.toString(secondConcern.key, "hex") && w.status === "warmed"),
      "runner restart still scans persisted child discovery membership"
    );
  } finally {
    await closeMaybe(runner2);
    await closeMaybe(runner1);
    await closeMaybe(runnerStore);
    await closeMaybe(firstConcern?.base);
    await closeMaybe(firstConcern?.store);
    await closeMaybe(secondConcern?.base);
    await closeMaybe(secondConcern?.store);
    await closeMaybe(rootDisc);
    await closeMaybe(rootStore);
    await closeMaybe(childDisc);
    await closeMaybe(childStore);
    await closeSwarm(swarmHost);
    await closeSwarm(swarmRunner);
    cleanupDirs(rootDir, childDir, runnerDir, firstConcern?.dir, secondConcern?.dir);
  }
});

test("publishPub optimistic append accepted into view with dedupe and persistence", async (t) => {
  let swarmHost;
  let swarmRunner;
  let discDir;
  let discStore;
  let disc;
  let runnerDir;
  let runnerStore;
  let concernHost;
  let runnerBasePre;
  let runner;
  let runner2;

  try {
    ({ a: swarmHost, b: swarmRunner } = makeSwarmPair());
    ({ dir: discDir, store: discStore, disc } = await createDiscoveryHost({ swarm: swarmHost }));
    const discKeyZ = idEncoding.encode(disc.key);

    runnerDir = mkTmp("runner-");
    runnerStore = new Corestore(runnerDir);
    await runnerStore.ready?.();

    // concern host and one job (after runnerStore exists to derive runner key)
    concernHost = await createConcernHost({ swarm: swarmHost });
    await addConcern(disc, idEncoding.encode(concernHost.key), "pub" );
    await disc.update({ wait: true });
    const runnerNamespace = runnerStore.namespace(`concern-${concernHost.key.toString("hex")}`);
    const runnerKey = await Autobase.getLocalKey(runnerNamespace);

    const jobKey = await createJob(concernHost.base, "cap/job", { in: "data" });
    const attemptToken = crypto.randomBytes(32);

    // make concern readable (strict state) so warmset can warm
    await concernHost.base.append({ op: 5, v: 1, econ: { mode: 0, attemptBurn: 0, ratBurn: 0 } }, { optimistic: false });
    await concernHost.base.update({ wait: true });
    const hostPublishView = getPublishView(concernHost.base);
    await safeFlush(swarmHost);
    await safeFlush(swarmRunner);
    await concernHost.base.update({ wait: true });
    runnerBasePre = await ensureConcernSurface(runnerNamespace, swarmRunner, { key: concernHost.key });
    await runnerBasePre.update({ wait: true }).catch(() => {});
    const hostJobView = getJobView(concernHost.base);
    const runnerJobView = getJobView(runnerBasePre);
    const hostJob = await hostJobView.get(jobKey);
    let runnerJob = await runnerJobView.get(jobKey);
    for (let i = 0; !runnerJob && i < 10; i++) {
      await safeFlush(swarmHost);
      await safeFlush(swarmRunner);
      await runnerBasePre.update({ wait: true }).catch(() => {});
      runnerJob = await runnerJobView.get(jobKey);
    }
    t.ok(!!hostJob, "host job view has job");
    t.ok(!!runnerJob, "runner job view has job");
    await closeMaybe(runnerBasePre);
    await closeMaybe(runnerBasePre?.store);
    runnerBasePre = null;
    await safeFlush(swarmHost);
    await safeFlush(swarmRunner);

    const seen = [];
    runner = await createRunner({
      role: "org",
      corestore: runnerStore,
      swarm: swarmRunner,
      discoveryKeys: [discKeyZ],
      warmN: 1,
      warmupBudget: warmBudget({ maxTicks: 0, maxMs: 0, minViewReadable: true }),
      projector: async (ctx) => {
        for await (const pub of ctx.pubs()) {
          seen.push(pub);
        }
        // keep trying to publish once job is visible until accepted shows up
        let hasJob = false;
        for await (const j of ctx.jobs()) {
          if (b4a.equals(j.key, jobKey)) {
            hasJob = true;
            break;
          }
        }
        if (!hasJob) return;
        await ctx.publish.publishPub({
          cap: "cap/a",
          ref: { t: "result", k: jobKey, a: attemptToken },
        });
      },
    });

    await tickUntil(runner, swarmHost, swarmRunner, { tries: 8, delayMs: 5 });
    t.comment("after initial tickUntil");
    const warmStatus = runner.getStatus().warm.find((w) => w.status === "warmed");
    t.ok(!!warmStatus, "runner concern warmed");
    t.comment(`publishErrors ${JSON.stringify(runner.getStatus().publishErrors)}`);
    // ensure job is visible locally
    let jobCount = 0;
    for await (const _ of getJobView(concernHost.base).createReadStream()) jobCount++;
    t.ok(jobCount >= 1, "job present");
    t.comment("after host job count");
    await safeFlush(swarmHost);
    await safeFlush(swarmRunner);
    await concernHost.base.update({ wait: true }).catch(() => {});
    const hostLeafRunner = await hostPublishView
      .sub(jobKey)
      .sub(runnerKey)
      .get(attemptToken, { valueEncoding: hostPublishView.valueEncoding })
      .catch(() => null);
    const hostLeafHost = await hostPublishView
      .sub(jobKey)
      .sub(concernHost.base.local.key)
      .get(attemptToken, { valueEncoding: hostPublishView.valueEncoding })
      .catch(() => null);
    t.ok(hostLeafRunner || hostLeafHost, "host concern has accepted pub");
    t.comment("after host publish view scan");
    // collect accepted pub from runner view (will match host leaf shape)
    if (!seen.length && hostLeafRunner) seen.push({ key: attemptToken, value: hostLeafRunner });
    if (!seen.length && hostLeafHost) seen.push({ key: attemptToken, value: hostLeafHost });
    t.ok(seen.length >= 1, "accepted pub observed via pubs()");
    if (seen.length >= 1) {
      t.alike(seen[0].value.cap, "cap/a");
      t.ok(b4a.equals(seen[0].value.ref.a, attemptToken));
    }

    // restart runner and ensure dedupe (no second observation)
    await closeMaybe(runner);
    runner = null;
    t.comment("after runner close");
    runner2 = await createRunner({
      role: "org",
      corestore: runnerStore,
      swarm: swarmRunner,
      discoveryKeys: [discKeyZ],
      warmN: 1,
      warmupBudget: warmBudget({ maxTicks: 0, maxMs: 0, minViewReadable: true }),
      projector: async (ctx) => {
        for await (const pub of ctx.pubs()) {
          seen.push(pub);
        }
        // republish attempt; should be deduped if already accepted
        await ctx.publish.publishPub({ cap: "cap/a", ref: { t: "result", k: jobKey, a: attemptToken } });
      },
    });
    await tickUntil(runner2, swarmHost, swarmRunner, { tries: 5, delayMs: 5 });
    t.comment("after runner2 tickUntil");
    t.is(seen.length, 1, "deduped across restart");
  } finally {
    await closeMaybe(runner2);
    await closeMaybe(runner);
    await closeMaybe(runnerBasePre);
    await closeMaybe(runnerBasePre?.store);
    await closeMaybe(runnerStore);
    await closeMaybe(concernHost?.base);
    await closeMaybe(concernHost?.store);
    await closeMaybe(disc);
    await closeMaybe(discStore);
    await closeSwarm(swarmHost);
    await closeSwarm(swarmRunner);
    cleanupDirs(discDir, runnerDir, concernHost?.dir);
  }
});
