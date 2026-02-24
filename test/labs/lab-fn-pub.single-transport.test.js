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
import { ensureConcernSurface, createJob, getPublishView, OP } from "../../src/concern.js";
import { createRunner } from "../../src/agent/runner.js";
import { createOrganismActor } from "../../src/dx/index.js";
import fnPubDefinition from "../../organisms/fn-pub.js";
import { mkTmp } from "../_helpers/fs.js";
import { closeSwarm, safeFlush } from "../_helpers/swarm.js";

test("lab-fn-pub.single-transport", async (t) => {
  const topics = new Map();
  const topic = crypto.randomBytes(32);
  const hostSwarm = createFakeSwarm({ topics });
  const orgSwarm = createFakeSwarm({ topics });
  hostSwarm.join(topic);
  orgSwarm.join(topic);

  const dirs = [];
  let discovery;
  let concernHost;
  let discoveryStore;
  let concernStore;
  let orgStore;
  let runner;

  const prevModuleEnv = process.env.FN_PUB_MODULE;
  try {
    const discDir = mkTmp("lab-fn-pub-disc-");
    const concernDir = mkTmp("lab-fn-pub-concern-");
    const orgDir = mkTmp("lab-fn-pub-org-");
    const moduleDir = mkTmp("lab-fn-pub-module-");
    const modulePath = path.join(moduleDir, "module.js");
    dirs.push(discDir, concernDir, orgDir, moduleDir);

    fs.writeFileSync(
      modulePath,
      [
        "import crypto from 'crypto';",
        "export async function run(ctx) {",
        "  let first = null;",
        "  for await (const job of ctx.jobs()) {",
        "    if (job?.key) { first = job; break; }",
        "  }",
        "  if (!first) return null;",
        "  const attempt = crypto.createHash('sha256').update(first.key).update('lab-fn-pub').digest().subarray(0, 32);",
        "  return {",
        "    jobKey: first.key,",
        "    cap: 'cap/lab-fn-pub/v1',",
        "    ref: { t: 'result', k: first.key, a: attempt },",
        "    meta: { schema: 'mesh/example/fn-pub/v1', outUri: `file://lab-fn-pub/${attempt.toString('hex')}` }",
        "  };",
        "}",
        ""
      ].join("\n"),
      "utf8"
    );

    process.env.FN_PUB_MODULE = modulePath;

    discoveryStore = new Corestore(discDir);
    concernStore = new Corestore(concernDir);
    orgStore = new Corestore(orgDir);
    await Promise.all([discoveryStore.ready?.(), concernStore.ready?.(), orgStore.ready?.()]);

    discovery = await ensureDiscoverySurface(discoveryStore.namespace("discovery"), {}, hostSwarm);
    await addDiscoveryWriter(discovery, discovery.local.key);
    await discovery.update({ wait: true });

    concernHost = await ensureConcernSurface(concernStore.namespace("concern-host"), hostSwarm);
    await concernHost.append(
      { op: OP.STATE, v: 1, econ: { mode: 0, attemptBurn: 0, ratBurn: 0 } },
      { optimistic: false }
    );
    await concernHost.update({ wait: true });

    const jobKey = await createJob(concernHost, "cap/lab-fn-pub/job", { in: "job" });
    const publishView = getPublishView(concernHost);

    await addConcern(discovery, idEncoding.encode(concernHost.key), "lab-fn-pub");
    await discovery.update({ wait: true });

    const actor = createOrganismActor({
      name: "fn-pub",
      definition: fnPubDefinition,
      logger: console
    });

    runner = await createRunner({
      role: "org",
      corestore: orgStore,
      swarm: orgSwarm,
      discoveryKeys: [idEncoding.encode(discovery.key)],
      warmN: 1,
      warmupBudget: { maxTicks: 0, maxMs: 0, minViewReadable: true },
      projector: async (ctx) => actor.projector(ctx)
    });
    actor.bind({ runner, stateBee: runner.stateBee });

    const concernHex = b4a.toString(concernHost.key, "hex");
    const orgKey = await Autobase.getLocalKey(orgStore.namespace(`concern-${concernHex}`));

    let accepted = null;
    for (let i = 0; i < 50; i++) {
      await safeFlush(hostSwarm);
      await safeFlush(orgSwarm);
      await concernHost.update({ wait: true }).catch(() => {});
      await runner.tick();

      accepted = null;
      const stream = publishView
        .sub(jobKey)
        .sub(orgKey)
        .createReadStream({ valueEncoding: publishView.valueEncoding });
      for await (const entry of stream) {
        accepted = entry;
        break;
      }
      if (accepted) break;
    }

    t.ok(!!accepted, "derived pub leaf exists");
    t.is(accepted?.value?.meta?.schema, "mesh/example/fn-pub/v1");
  } finally {
    if (prevModuleEnv == null) delete process.env.FN_PUB_MODULE;
    else process.env.FN_PUB_MODULE = prevModuleEnv;

    await runner?.close?.().catch(() => {});
    await orgStore?.close?.().catch(() => {});
    await concernHost?.close?.().catch(() => {});
    await concernStore?.close?.().catch(() => {});
    await discovery?.close?.().catch(() => {});
    await discoveryStore?.close?.().catch(() => {});
    await closeSwarm(orgSwarm);
    await closeSwarm(hostSwarm);
    for (const dir of dirs) fs.rmSync(dir, { recursive: true, force: true });
  }
});
