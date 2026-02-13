import test from "brittle";
import Corestore from "corestore";
import crypto from "crypto";
import fs from "fs";
import b4a from "b4a";
import createFakeSwarm from "fakeswarm";
import idEncoding from "hypercore-id-encoding";
import Autobase from "autobase";

import { ensureDiscoverySurface, addConcern, addWriter as addDiscoveryWriter } from "../../src/discovery.js";
import { ensureConcernSurface, createJob, getPublishView, getRatView } from "../../src/concern.js";
import { createRunner } from "../../src/agent/runner.js";
import { ensureAgentStateSurface, readAgentState } from "../../src/agent/state.js";
import { mkTmp } from "../_helpers/fs.js";
import { closeSwarm, safeFlush } from "../_helpers/swarm.js";

const topicSeed = crypto.randomBytes(32);

function makeSwarmTriple() {
  const topics = new Map();
  const host = createFakeSwarm({ topics });
  const org = createFakeSwarm({ topics });
  const rat = createFakeSwarm({ topics });
  host.join(topicSeed);
  org.join(topicSeed);
  rat.join(topicSeed);
  return { host, org, rat };
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

async function tickBoth(orgRunner, ratRunner, swarmHost, swarmOrg, swarmRat, tries = 1) {
  for (let i = 0; i < tries; i++) {
    await safeFlush(swarmHost);
    await safeFlush(swarmOrg);
    await safeFlush(swarmRat);
    await orgRunner?.tick?.();
    await ratRunner?.tick?.();
  }
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

async function findRatLeaf(hostRatView, jobKey, orgKey, attemptToken) {
  const jobSub = hostRatView.sub(jobKey);
  for await (const ratifierEntry of jobSub.createReadStream()) {
    const ratifierKey = ratifierEntry.key;
    if (!ratifierKey) continue;
    const rat = await jobSub
      .sub(ratifierKey)
      .sub(orgKey)
      .get(attemptToken, { valueEncoding: hostRatView.valueEncoding })
      .catch(() => null);
    if (rat) return rat;
  }
  return null;
}

async function setupPhase4Topology() {
  const { host: swarmHost, org: swarmOrg, rat: swarmRat } = makeSwarmTriple();
  const { dir: discDir, store: discStore, disc } = await createDiscoveryHost({ swarm: swarmHost });
  const concernHost = await createConcernHost({ swarm: swarmHost });
  const discKeyZ = idEncoding.encode(disc.key);

  await addConcern(disc, idEncoding.encode(concernHost.key), "phase4");
  await disc.update({ wait: true });

  await concernHost.base.append({ op: 5, v: 1, econ: { mode: 0, attemptBurn: 0, ratBurn: 0 } }, { optimistic: false });
  await concernHost.base.update({ wait: true });

  const jobKey = await createJob(concernHost.base, "cap/job", { payload: "x" });
  const attemptToken = crypto.randomBytes(32);

  const orgDir = mkTmp("org-runner-");
  const orgStore = new Corestore(orgDir);
  await orgStore.ready?.();

  const ratDir = mkTmp("rat-runner-");
  const ratStore = new Corestore(ratDir);
  await ratStore.ready?.();

  const concernHex = concernHost.key.toString("hex");
  const orgKey = await Autobase.getLocalKey(orgStore.namespace(`concern-${concernHex}`));
  const ratifierRunnerKey = await Autobase.getLocalKey(ratStore.namespace(`concern-${concernHex}`));

  return {
    swarmHost,
    swarmOrg,
    swarmRat,
    discDir,
    discStore,
    disc,
    discKeyZ,
    concernHost,
    jobKey,
    attemptToken,
    orgDir,
    orgStore,
    ratDir,
    ratStore,
    orgKey,
    ratifierRunnerKey
  };
}

test("phase4 accept path: accepted PUB leads to accepted RAT without writer admission", async (t) => {
  let env;
  let orgRunner;
  let ratRunner;

  try {
    env = await setupPhase4Topology();
    const {
      swarmHost,
      swarmOrg,
      swarmRat,
      discKeyZ,
      concernHost,
      jobKey,
      attemptToken,
      orgStore,
      ratStore,
      orgKey,
      ratifierRunnerKey
    } = env;

    let pubSent = false;
    orgRunner = await createRunner({
      role: "org",
      corestore: orgStore,
      swarm: swarmOrg,
      discoveryKeys: [discKeyZ],
      warmN: 1,
      warmupBudget: { maxTicks: 0, maxMs: 0, minViewReadable: true },
      projector: async (ctx) => {
        if (pubSent) return;
        let hasJob = false;
        for await (const j of ctx.jobs()) {
          if (b4a.equals(j.key, jobKey)) {
            hasJob = true;
            break;
          }
        }
        if (!hasJob) return;
        pubSent = true;
        await ctx.publish.publishPub({
          cap: "cap/pub",
          ref: { t: "result", k: jobKey, a: attemptToken }
        });
      }
    });

    ratRunner = await createRunner({
      role: "ratifier",
      corestore: ratStore,
      swarm: swarmRat,
      discoveryKeys: [discKeyZ],
      warmN: 1,
      warmupBudget: { maxTicks: 0, maxMs: 0, minViewReadable: false }
    });

    const hostPublishView = getPublishView(concernHost.base);
    const hostRatView = getRatView(concernHost.base);
    let acceptedPub = null;
    let acceptedRat = null;
    for (let i = 0; i < 40; i++) {
      await tickBoth(orgRunner, ratRunner, swarmHost, swarmOrg, swarmRat, 1);
      await concernHost.base.update({ wait: true }).catch(() => {});
      acceptedPub = await hostPublishView
        .sub(jobKey)
        .sub(orgKey)
        .get(attemptToken, { valueEncoding: hostPublishView.valueEncoding })
        .catch(() => null);
      acceptedRat = await hostRatView
        .sub(jobKey)
        .sub(ratifierRunnerKey)
        .sub(orgKey)
        .get(attemptToken, { valueEncoding: hostRatView.valueEncoding })
        .catch(() => null);
      if (acceptedPub && acceptedRat) break;
    }

    t.ok(ratRunner.getStatus().warm.some((w) => w.status === "warmed"), "ratifier warmed");
    t.ok(acceptedPub, "pub accepted in derived view");
    t.ok(acceptedRat, "rat accepted in derived view");
  } finally {
    await closeMaybe(ratRunner);
    await closeMaybe(orgRunner);
    await closeMaybe(env?.ratStore);
    await closeMaybe(env?.orgStore);
    await closeMaybe(env?.concernHost?.base);
    await closeMaybe(env?.concernHost?.store);
    await closeMaybe(env?.disc);
    await closeMaybe(env?.discStore);
    await closeSwarm(env?.swarmOrg);
    await closeSwarm(env?.swarmRat);
    await closeSwarm(env?.swarmHost);
    cleanupDirs(env?.discDir, env?.orgDir, env?.ratDir, env?.concernHost?.dir);
  }
});

test("phase4 reject path: invalid RAT proposal is dropped by concern apply", async (t) => {
  let env;
  let orgRunner;
  let ratRunner;

  try {
    env = await setupPhase4Topology();
    const {
      swarmHost,
      swarmOrg,
      swarmRat,
      discKeyZ,
      concernHost,
      jobKey,
      attemptToken,
      orgStore,
      ratStore,
      orgKey
    } = env;

    let pubSent = false;
    orgRunner = await createRunner({
      role: "org",
      corestore: orgStore,
      swarm: swarmOrg,
      discoveryKeys: [discKeyZ],
      warmN: 1,
      warmupBudget: { maxTicks: 0, maxMs: 0, minViewReadable: false },
      projector: async (ctx) => {
        if (pubSent) return;
        let hasJob = false;
        for await (const j of ctx.jobs()) {
          if (b4a.equals(j.key, jobKey)) {
            hasJob = true;
            break;
          }
        }
        if (!hasJob) return;
        pubSent = true;
        await ctx.publish.publishPub({
          cap: "cap/pub",
          ref: { t: "result", k: jobKey, a: attemptToken }
        });
      }
    });

    const invalidOrgKey = crypto.randomBytes(32);
    ratRunner = await createRunner({
      role: "ratifier",
      corestore: ratStore,
      swarm: swarmRat,
      discoveryKeys: [discKeyZ],
      warmN: 1,
      warmupBudget: { maxTicks: 0, maxMs: 0, minViewReadable: true },
      projector: async (ctx) => {
        for await (const pub of ctx.pubs()) {
          await ctx.publish.publishRat({
            jobKey: pub.jobKey,
            orgKey: invalidOrgKey,
            attemptToken: pub.attempt,
            determination: 1,
            tier: 1,
            cap: "cap/rat",
            ref: pub.value.ref,
            note: "invalid-org"
          });
        }
      }
    });

    const hostPublishView = getPublishView(concernHost.base);
    const hostRatView = getRatView(concernHost.base);
    let acceptedPub = null;
    let rejectedRat = null;
    for (let i = 0; i < 40; i++) {
      await tickBoth(orgRunner, ratRunner, swarmHost, swarmOrg, swarmRat, 1);
      await concernHost.base.update({ wait: true }).catch(() => {});
      acceptedPub = await hostPublishView
        .sub(jobKey)
        .sub(orgKey)
        .get(attemptToken, { valueEncoding: hostPublishView.valueEncoding })
        .catch(() => null);
      rejectedRat = await findRatLeaf(hostRatView, jobKey, invalidOrgKey, attemptToken);
      if (acceptedPub && rejectedRat) break;
    }

    t.ok(acceptedPub, "pub accepted in derived view");
    t.absent(rejectedRat, "invalid rat was dropped");
  } finally {
    await closeMaybe(ratRunner);
    await closeMaybe(orgRunner);
    await closeMaybe(env?.ratStore);
    await closeMaybe(env?.orgStore);
    await closeMaybe(env?.concernHost?.base);
    await closeMaybe(env?.concernHost?.store);
    await closeMaybe(env?.disc);
    await closeMaybe(env?.discStore);
    await closeSwarm(env?.swarmOrg);
    await closeSwarm(env?.swarmRat);
    await closeSwarm(env?.swarmHost);
    cleanupDirs(env?.discDir, env?.orgDir, env?.ratDir, env?.concernHost?.dir);
  }
});

test("phase4 restart dedupe: no re-ratify after restart", async (t) => {
  let env;
  let orgRunner;
  let ratRunner;
  let ratRunner2;
  let agentState;

  try {
    env = await setupPhase4Topology();
    const {
      swarmHost,
      swarmOrg,
      swarmRat,
      discKeyZ,
      concernHost,
      jobKey,
      attemptToken,
      orgStore,
      ratStore,
      orgKey
    } = env;

    let pubSent = false;
    orgRunner = await createRunner({
      role: "org",
      corestore: orgStore,
      swarm: swarmOrg,
      discoveryKeys: [discKeyZ],
      warmN: 1,
      warmupBudget: { maxTicks: 0, maxMs: 0, minViewReadable: true },
      projector: async (ctx) => {
        if (pubSent) return;
        let hasJob = false;
        for await (const j of ctx.jobs()) {
          if (b4a.equals(j.key, jobKey)) {
            hasJob = true;
            break;
          }
        }
        if (!hasJob) return;
        pubSent = true;
        await ctx.publish.publishPub({
          cap: "cap/pub",
          ref: { t: "result", k: jobKey, a: attemptToken }
        });
      }
    });

    ratRunner = await createRunner({
      role: "ratifier",
      corestore: ratStore,
      swarm: swarmRat,
      discoveryKeys: [discKeyZ],
      warmN: 1,
      warmupBudget: { maxTicks: 0, maxMs: 0, minViewReadable: false }
    });

    const hostRatView = getRatView(concernHost.base);
    let acceptedRat = null;
    for (let i = 0; i < 40; i++) {
      await tickBoth(orgRunner, ratRunner, swarmHost, swarmOrg, swarmRat, 1);
      await concernHost.base.update({ wait: true }).catch(() => {});
      acceptedRat = await findRatLeaf(hostRatView, jobKey, orgKey, attemptToken);
      if (acceptedRat) break;
    }
    t.ok(ratRunner.getStatus().warm.some((w) => w.status === "warmed"), "ratifier warmed");
    t.ok(acceptedRat, "initial rat accepted");
    await closeMaybe(ratRunner);
    ratRunner = null;

    const concernHex = concernHost.key.toString("hex");
    const expectedMarker = `rat/${idEncoding.encode(b4a.from(concernHex, "hex"))}/${idEncoding.encode(jobKey)}/${idEncoding.encode(orgKey)}/${idEncoding.encode(attemptToken)}`;
    agentState = await ensureAgentStateSurface(ratStore.namespace("ratifier-state"));
    const snapshot = await readAgentState(agentState);
    await closeMaybe(agentState);
    agentState = null;
    const ratifiedArr = snapshot?.ratified?.[concernHex] || [];
    t.ok(Array.isArray(ratifiedArr), "ratified state persisted");
    t.ok(ratifiedArr.includes(expectedMarker), "ratified marker persisted");

    let publishResult = null;
    let attempted = false;
    ratRunner2 = await createRunner({
      role: "ratifier",
      corestore: ratStore,
      swarm: swarmRat,
      discoveryKeys: [discKeyZ],
      warmN: 1,
      warmupBudget: { maxTicks: 0, maxMs: 0, minViewReadable: false },
      projector: async (ctx) => {
        if (attempted) return;
        attempted = true;
        publishResult = await ctx.publish.publishRat({
          jobKey,
          orgKey,
          attemptToken,
          determination: 1,
          tier: 1,
          cap: "cap/pub",
          ref: { t: "result", k: jobKey, a: attemptToken },
          note: "restart-check"
        });
      }
    });

    for (let i = 0; i < 20 && !publishResult; i++) {
      await tickBoth(orgRunner, ratRunner2, swarmHost, swarmOrg, swarmRat, 1);
    }
    t.alike(publishResult, { accepted: true, deduped: true }, "publishRat deduped after restart");
  } finally {
    await closeMaybe(agentState);
    await closeMaybe(ratRunner2);
    await closeMaybe(ratRunner);
    await closeMaybe(orgRunner);
    await closeMaybe(env?.ratStore);
    await closeMaybe(env?.orgStore);
    await closeMaybe(env?.concernHost?.base);
    await closeMaybe(env?.concernHost?.store);
    await closeMaybe(env?.disc);
    await closeMaybe(env?.discStore);
    await closeSwarm(env?.swarmOrg);
    await closeSwarm(env?.swarmRat);
    await closeSwarm(env?.swarmHost);
    cleanupDirs(env?.discDir, env?.orgDir, env?.ratDir, env?.concernHost?.dir);
  }
});
