import test from "brittle";
import fs from "fs";
import path from "path";
import Corestore from "corestore";
import crypto from "crypto";
import Autobase from "autobase";
import createFakeSwarm from "fakeswarm";
import idEncoding from "hypercore-id-encoding";
import b4a from "b4a";

import { ensureDiscoverySurface, addConcern, addWriter as addDiscoveryWriter } from "../../src/discovery.js";
import { ensureConcernSurface, createJob, getPublishView, getRatView, publishJobWork, OP } from "../../src/concern.js";
import { createRunner } from "../../src/agent/runner.js";
import { createRatifierActor } from "../../src/dx/index.js";
import fnRatDefinition from "../../ratifiers/fn-rat.js";
import { mkTmp } from "../_helpers/fs.js";
import { closeSwarm, safeFlush } from "../_helpers/swarm.js";

test("lab-fn-rat.single-transport", async (t) => {
  const topics = new Map();
  const topic = crypto.randomBytes(32);
  const hostSwarm = createFakeSwarm({ topics });
  const publisherSwarm = createFakeSwarm({ topics });
  const ratSwarm = createFakeSwarm({ topics });
  hostSwarm.join(topic);
  publisherSwarm.join(topic);
  ratSwarm.join(topic);

  const dirs = [];
  let discovery;
  let concernHost;
  let publisherBase;
  let discoveryStore;
  let concernStore;
  let publisherStore;
  let ratStore;
  let runner;

  const prevModuleEnv = process.env.FN_RAT_MODULE;
  try {
    const discDir = mkTmp("lab-fn-rat-disc-");
    const concernDir = mkTmp("lab-fn-rat-concern-");
    const pubDir = mkTmp("lab-fn-rat-pub-");
    const ratDir = mkTmp("lab-fn-rat-runner-");
    dirs.push(discDir, concernDir, pubDir, ratDir);

    discoveryStore = new Corestore(discDir);
    concernStore = new Corestore(concernDir);
    publisherStore = new Corestore(pubDir);
    ratStore = new Corestore(ratDir);
    await Promise.all([discoveryStore.ready?.(), concernStore.ready?.(), publisherStore.ready?.(), ratStore.ready?.()]);

    discovery = await ensureDiscoverySurface(discoveryStore.namespace("discovery"), {}, hostSwarm);
    await addDiscoveryWriter(discovery, discovery.local.key);
    await discovery.update({ wait: true });

    concernHost = await ensureConcernSurface(concernStore.namespace("concern-host"), hostSwarm);
    await concernHost.append(
      { op: OP.STATE, v: 1, econ: { mode: 0, attemptBurn: 0, ratBurn: 0 } },
      { optimistic: false }
    );
    await concernHost.update({ wait: true });

    const concernHex = b4a.toString(concernHost.key, "hex");
    publisherBase = await ensureConcernSurface(
      publisherStore.namespace(`concern-${concernHex}`),
      publisherSwarm,
      { key: concernHost.key }
    );

    const jobKey = await createJob(concernHost, "cap/lab-fn-rat/job", { in: "job" });
    const attemptToken = crypto
      .createHash("sha256")
      .update(jobKey)
      .update("lab-fn-rat")
      .digest()
      .subarray(0, 32);

    await addConcern(discovery, idEncoding.encode(concernHost.key), "lab-fn-rat");
    await discovery.update({ wait: true });

    await publishJobWork(
      publisherBase,
      jobKey,
      "cap/lab-fn-rat/pub",
      { t: "result", k: jobKey, a: attemptToken },
      {
        schema: "mesh/example/fn-pub/v1",
        tags: ["priority:high"],
        outUri: `file://lab-fn-rat/${attemptToken.toString("hex")}`
      }
    );

    const hostPublishView = getPublishView(concernHost);
    let acceptedPub = null;
    for (let i = 0; i < 80; i++) {
      await safeFlush(hostSwarm);
      await safeFlush(publisherSwarm);
      await safeFlush(ratSwarm);
      await concernHost.update({ wait: true }).catch(() => {});
      await publisherBase.update({ wait: true }).catch(() => {});
      acceptedPub = await hostPublishView
        .sub(jobKey)
        .sub(publisherBase.local.key)
        .get(attemptToken, { valueEncoding: hostPublishView.valueEncoding })
        .catch(() => null);
      if (acceptedPub) break;
    }
    t.ok(!!acceptedPub, "accepted pub leaf exists before ratifier tick");

    process.env.FN_RAT_MODULE = path.resolve("docs/examples/fn-rat/example.js");
    const actor = createRatifierActor({
      name: "fn-rat",
      definition: fnRatDefinition,
      logger: console
    });

    runner = await createRunner({
      role: "ratifier",
      corestore: ratStore,
      swarm: ratSwarm,
      discoveryKeys: [idEncoding.encode(discovery.key)],
      warmN: 1,
      warmupBudget: { maxTicks: 0, maxMs: 0, minViewReadable: true },
      projector: async (ctx) => actor.projector(ctx)
    });
    actor.bind({ runner, stateBee: runner.stateBee });

    const ratifierKey = await Autobase.getLocalKey(ratStore.namespace(`concern-${concernHex}`));
    const hostRatView = getRatView(concernHost);
    let acceptedRat = null;
    for (let i = 0; i < 120; i++) {
      await safeFlush(hostSwarm);
      await safeFlush(publisherSwarm);
      await safeFlush(ratSwarm);
      await concernHost.update({ wait: true }).catch(() => {});
      await publisherBase.update({ wait: true }).catch(() => {});
      await runner.tick();
      acceptedRat = await hostRatView
        .sub(jobKey)
        .sub(ratifierKey)
        .sub(publisherBase.local.key)
        .get(attemptToken, { valueEncoding: hostRatView.valueEncoding })
        .catch(() => null);
      if (acceptedRat) break;
    }

    t.ok(!!acceptedRat, "accepted rat leaf exists");
    t.ok(typeof acceptedRat?.value?.n === "string", "accepted rat note is present");
  } finally {
    if (prevModuleEnv == null) delete process.env.FN_RAT_MODULE;
    else process.env.FN_RAT_MODULE = prevModuleEnv;

    await runner?.close?.().catch(() => {});
    await ratStore?.close?.().catch(() => {});
    await publisherBase?.close?.().catch(() => {});
    await publisherStore?.close?.().catch(() => {});
    await concernHost?.close?.().catch(() => {});
    await concernStore?.close?.().catch(() => {});
    await discovery?.close?.().catch(() => {});
    await discoveryStore?.close?.().catch(() => {});
    await closeSwarm(ratSwarm);
    await closeSwarm(publisherSwarm);
    await closeSwarm(hostSwarm);
    for (const dir of dirs) fs.rmSync(dir, { recursive: true, force: true });
  }
});
