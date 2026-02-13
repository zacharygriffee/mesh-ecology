import test from "brittle";
import b4a from "b4a";
import Autobase from "autobase";
import idEncoding from "hypercore-id-encoding";

import {
  ensureDiscoverySurface,
  addConcern,
  addWriter as addDiscoveryWriter
} from "../../src/discovery.js";
import {
  ensureConcernSurface,
  createJob,
  publishJobWork,
  getJobView,
  getPublishView,
  getRatView,
  OP
} from "../../src/concern.js";
import { createRunner } from "../../src/agent/runner.js";
import { safeFlush } from "../_helpers/swarm.js";
import { runLabTwoTransport } from "../_helpers/lab-two-transport.js";
import { getLabBudgets } from "../_helpers/lab-budgets.js";

const budgets = getLabBudgets();

test("lab-ecology.ratifier-selectivity.projector.two-transport", { timeout: budgets.outerTimeoutMs }, async (t) => {
  const result = await runLabTwoTransport(t, {
    name: "lab-ecology.ratifier-selectivity.projector",
    opts: {
      strict: budgets.strict,
      realEnabled: budgets.realEnabled,
      labBudgets: budgets
    },
    async scenario(ctx) {
      const discoveryStore = ctx.createRoleCorestore("discovery-host");
      const concernHostStore = ctx.createRoleCorestore("concern-host");
      const orgStore = ctx.createRoleCorestore("organism-a");
      const ratAStore = ctx.createRoleCorestore("ratifier-a");
      const ratBStore = ctx.createRoleCorestore("ratifier-b");

      const hostSwarm = ctx.createRoleSwarm("host");
      const orgSwarm = ctx.createRoleSwarm("organism-a");
      const ratASwarm = ctx.createRoleSwarm("ratifier-a");
      const ratBSwarm = ctx.createRoleSwarm("ratifier-b");

      const topicOrg = ctx.topicFor("lab-ecology-ratifier-selectivity-topic-org");
      const topicRatA = ctx.topicFor("lab-ecology-ratifier-selectivity-topic-rat-a");
      const topicRatB = ctx.topicFor("lab-ecology-ratifier-selectivity-topic-rat-b");
      const hostJoinOrg = hostSwarm.join(topicOrg, { server: true, client: true });
      const hostJoinRatA = hostSwarm.join(topicRatA, { server: true, client: true });
      const hostJoinRatB = hostSwarm.join(topicRatB, { server: true, client: true });
      const orgJoin = orgSwarm.join(topicOrg, { server: true, client: true });
      const ratAJoin = ratASwarm.join(topicRatA, { server: true, client: true });
      const ratBJoin = ratBSwarm.join(topicRatB, { server: true, client: true });

      ctx.resources.track("host-join-org", hostJoinOrg, async (d) => {
        await d?.destroy?.().catch(() => {});
      });
      ctx.resources.track("host-join-rat-a", hostJoinRatA, async (d) => {
        await d?.destroy?.().catch(() => {});
      });
      ctx.resources.track("host-join-rat-b", hostJoinRatB, async (d) => {
        await d?.destroy?.().catch(() => {});
      });
      ctx.resources.track("org-join", orgJoin, async (d) => {
        await d?.destroy?.().catch(() => {});
      });
      ctx.resources.track("rat-a-join", ratAJoin, async (d) => {
        await d?.destroy?.().catch(() => {});
      });
      ctx.resources.track("rat-b-join", ratBJoin, async (d) => {
        await d?.destroy?.().catch(() => {});
      });

      const discovery = ctx.resources.trackBase(
        await ensureDiscoverySurface(discoveryStore.namespace("discovery"), {}, hostSwarm)
      );
      await addDiscoveryWriter(discovery, discovery.local.key);
      await discovery.update({ wait: true });

      const concernHost = ctx.resources.trackAutobase(
        await ensureConcernSurface(concernHostStore.namespace("concern-host"), hostSwarm)
      );
      const orgABase = ctx.resources.trackAutobase(
        await ensureConcernSurface(
          orgStore.namespace("concern-org-a"),
          orgSwarm,
          { key: concernHost.key }
        )
      );
      await concernHost.append(
        { op: OP.STATE, v: 1, econ: { mode: 0, attemptBurn: 0, ratBurn: 0 } },
        { optimistic: false }
      );
      await concernHost.update({ wait: true });

      await addConcern(discovery, idEncoding.encode(concernHost.key), "lab-ecology-ratifier-selectivity");
      await discovery.update({ wait: true });

      const jobKey = await createJob(concernHost, "cap/lab-ecology-ratifier-selectivity", { in: "job" });
      const attemptTokenKeep = ctx.topicFor("lab-ecology-selectivity-attempt-keep");
      const attemptTokenSkip = ctx.topicFor("lab-ecology-selectivity-attempt-skip");
      const keepCap = "cap/lab-ecology-selectivity-keep";
      const skipCap = "cap/lab-ecology-selectivity-skip";
      if (b4a.equals(attemptTokenKeep, attemptTokenSkip)) {
        throw semanticError("attempt tokens must be distinct");
      }

      const concernHex = b4a.toString(concernHost.key, "hex");
      const orgKey = orgABase.local.key;
      const ratAKey = await Autobase.getLocalKey(ratAStore.namespace(`concern-${concernHex}`));
      const ratBKey = await Autobase.getLocalKey(ratBStore.namespace(`concern-${concernHex}`));
      const discoveryKey = idEncoding.encode(discovery.key);

      const ratARunner = ctx.resources.track(
        "rat-a-runner",
        await createRunner({
          role: "ratifier",
          corestore: ratAStore,
          swarm: ratASwarm,
          discoveryKeys: [discoveryKey],
          warmN: 1,
          warmupBudget: { maxTicks: 0, maxMs: 0, minViewReadable: false }
        }),
        async (runner) => {
          await runner?.close?.().catch(() => {});
        }
      );

      const ratBRunner = ctx.resources.track(
        "rat-b-runner",
        await createRunner({
          role: "ratifier",
          corestore: ratBStore,
          swarm: ratBSwarm,
          discoveryKeys: [discoveryKey],
          warmN: 1,
          warmupBudget: { maxTicks: 0, maxMs: 0, minViewReadable: false },
          projector: async (runnerCtx) => {
            for await (const pub of runnerCtx.pubs()) {
              if (pub?.value?.cap !== keepCap) continue;
              await runnerCtx.publish.publishRat({
                jobKey: pub.jobKey,
                orgKey: pub.value.oK,
                attemptToken: pub.attempt,
                determination: 1,
                tier: 1,
                cap: typeof pub?.value?.cap === "string" && pub.value.cap.length ? pub.value.cap : "cap/lab-ecology-rat",
                ref: pub.value.ref,
                note: "selective-keep"
              });
            }
          }
        }),
        async (runner) => {
          await runner?.close?.().catch(() => {});
        }
      );

      const hostPublishView = getPublishView(concernHost);
      const hostRatView = getRatView(concernHost);

      return {
        discoveries: [
          { label: "host-join-org", target: hostJoinOrg },
          { label: "host-join-rat-a", target: hostJoinRatA },
          { label: "host-join-rat-b", target: hostJoinRatB },
          { label: "org-join", target: orgJoin },
          { label: "rat-a-join", target: ratAJoin },
          { label: "rat-b-join", target: ratBJoin }
        ],
        swarms: [
          { label: "host", swarm: hostSwarm, minConnections: 1 },
          { label: "organism-a", swarm: orgSwarm, minConnections: 1 },
          { label: "ratifier-a", swarm: ratASwarm, minConnections: 1 },
          { label: "ratifier-b", swarm: ratBSwarm, minConnections: 1 }
        ],
        bases: [],
        assert: async () => {
          const isReal = ctx.transportKind === "hyperswarm";
          const flushEvery = isReal ? 1 : 4;
          const warmRounds = isReal ? 200 : 80;
          const publishRounds = isReal ? 200 : 80;
          const settleAfterRounds = isReal ? 40 : 24;

          const orgJobView = getJobView(orgABase);
          let pubKeepLeaf = null;
          let pubSkipLeaf = null;
          let ratAKeepLeaf = null;
          let ratASkipLeaf = null;
          let ratBKeepLeaf = null;
          let orgHasJob = null;
          let ratAReady = false;
          let ratBReady = false;

          for (let i = 0; i < warmRounds; i++) {
            await tickRound({
              hostSwarm,
              orgSwarm,
              ratASwarm,
              ratBSwarm,
              concernHost,
              orgABase,
              ratARunner,
              ratBRunner,
              flush: i % flushEvery === 0
            });
            orgHasJob = await orgJobView.get(jobKey).catch(() => null);
            ratAReady = isRunnerWarmed(ratARunner);
            ratBReady = isRunnerWarmed(ratBRunner);
            if (orgHasJob && ratAReady && ratBReady) break;
          }
          if (!orgHasJob || !ratAReady || !ratBReady) {
            throw semanticError("organism/ratifiers not ready before publishing", {
              orgHasJob: !!orgHasJob,
              ratAReady,
              ratBReady
            });
          }

          await publishJobWork(orgABase, jobKey, keepCap, {
            t: "result",
            k: jobKey,
            a: attemptTokenKeep
          });
          await publishJobWork(orgABase, jobKey, skipCap, {
            t: "result",
            k: jobKey,
            a: attemptTokenSkip
          });

          for (let i = 0; i < publishRounds; i++) {
            await tickRound({
              hostSwarm,
              orgSwarm,
              ratASwarm,
              ratBSwarm,
              concernHost,
              orgABase,
              ratARunner,
              ratBRunner,
              flush: i % flushEvery === 0
            });
            pubKeepLeaf = await getPubLeaf(hostPublishView, jobKey, orgKey, attemptTokenKeep);
            pubSkipLeaf = await getPubLeaf(hostPublishView, jobKey, orgKey, attemptTokenSkip);
            ratAKeepLeaf = await getRatLeaf(hostRatView, jobKey, ratAKey, orgKey, attemptTokenKeep);
            ratASkipLeaf = await getRatLeaf(hostRatView, jobKey, ratAKey, orgKey, attemptTokenSkip);
            ratBKeepLeaf = await getRatLeaf(hostRatView, jobKey, ratBKey, orgKey, attemptTokenKeep);

            if (pubKeepLeaf && pubSkipLeaf && ratAKeepLeaf && ratASkipLeaf && ratBKeepLeaf) break;
          }

          if (!pubKeepLeaf || !pubSkipLeaf || !ratAKeepLeaf || !ratASkipLeaf || !ratBKeepLeaf) {
            const missing = {
              pubKeep: !!pubKeepLeaf,
              pubSkip: !!pubSkipLeaf,
              ratAKeep: !!ratAKeepLeaf,
              ratASkip: !!ratASkipLeaf,
              ratBKeep: !!ratBKeepLeaf
            };
            throw semanticError(`expected accepted pub/rat leaves were not all materialized ${JSON.stringify(missing)}`, missing);
          }

          await settleRounds({
            rounds: settleAfterRounds,
            hostSwarm,
            orgSwarm,
            ratASwarm,
            ratBSwarm,
            concernHost,
            orgABase,
            ratARunner,
            ratBRunner
          });

          const ratBSkipLeaf = await getRatLeaf(hostRatView, jobKey, ratBKey, orgKey, attemptTokenSkip);
          if (ratBSkipLeaf) {
            throw semanticError("selective ratifier unexpectedly ratified skip-tag pub");
          }

          const ratBCount = await countRatAttempts(hostRatView, jobKey, ratBKey, orgKey);
          if (ratBCount !== 1) {
            throw semanticError("selective ratifier attempt count mismatch", { ratBCount });
          }

          return [
            { name: "pub keep accepted at pub/<job>/<orgA>/<attempt1>", ok: !!pubKeepLeaf, observed: !!pubKeepLeaf, expected: true },
            { name: "pub skip accepted at pub/<job>/<orgA>/<attempt2>", ok: !!pubSkipLeaf, observed: !!pubSkipLeaf, expected: true },
            { name: "ratA accepted keep attempt", ok: !!ratAKeepLeaf, observed: !!ratAKeepLeaf, expected: true },
            { name: "ratA accepted skip attempt", ok: !!ratASkipLeaf, observed: !!ratASkipLeaf, expected: true },
            { name: "ratB accepted keep attempt", ok: !!ratBKeepLeaf, observed: !!ratBKeepLeaf, expected: true },
            { name: "ratB did not accept skip attempt", ok: !ratBSkipLeaf, observed: !!ratBSkipLeaf, expected: false },
            { name: "ratB has exactly one rat leaf", ok: ratBCount === 1, observed: ratBCount, expected: 1 }
          ];
        }
      };
    }
  });

  if (!budgets.realEnabled) {
    t.ok(result.skippedReal === true);
    return;
  }
  if (budgets.strict) {
    t.is(result.verdict, "PASS");
    return;
  }
  t.ok(result.verdict === "PASS" || result.verdict === "FLAKE_TRANSPORT");
});

async function tickRound({ hostSwarm, orgSwarm, ratASwarm, ratBSwarm, concernHost, orgABase, ratARunner, ratBRunner, flush = true }) {
  if (flush) {
    await safeFlush(hostSwarm);
    await safeFlush(orgSwarm);
    await safeFlush(ratASwarm);
    await safeFlush(ratBSwarm);
  }
  const ticks = [];
  if (ratARunner?.tick) ticks.push(ratARunner.tick());
  if (ratBRunner?.tick) ticks.push(ratBRunner.tick());
  if (ticks.length) await Promise.all(ticks);
  await orgABase?.update?.({ wait: true }).catch(() => {});
  await concernHost.update({ wait: true }).catch(() => {});
}

async function settleRounds(ctx) {
  for (let i = 0; i < ctx.rounds; i++) {
    await tickRound({ ...ctx, flush: i % 4 === 0 });
  }
}

function isRunnerWarmed(runner) {
  return !!runner?.getStatus?.().warm?.some((w) => w.status === "warmed");
}

async function getPubLeaf(publishView, jobKey, orgKey, attemptToken) {
  return publishView
    .sub(jobKey)
    .sub(orgKey)
    .get(attemptToken, { valueEncoding: publishView.valueEncoding })
    .catch(() => null);
}

async function getRatLeaf(ratView, jobKey, ratifierKey, orgKey, attemptToken) {
  return ratView
    .sub(jobKey)
    .sub(ratifierKey)
    .sub(orgKey)
    .get(attemptToken, { valueEncoding: ratView.valueEncoding })
    .catch(() => null);
}

async function countRatAttempts(ratView, jobKey, ratifierKey, orgKey) {
  let count = 0;
  const stream = ratView
    .sub(jobKey)
    .sub(ratifierKey)
    .sub(orgKey)
    .createReadStream({ valueEncoding: ratView.valueEncoding });

  for await (const _entry of stream) count += 1;
  return count;
}

function semanticError(message, detail = null) {
  const err = new Error(message);
  err.code = "ERR_LAB_SEMANTIC_ASSERT";
  err.detail = detail;
  return err;
}
