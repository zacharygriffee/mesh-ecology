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
  getPublishView,
  getRatView,
  OP
} from "../../src/concern.js";
import { createRunner } from "../../src/agent/runner.js";
import { safeFlush } from "../_helpers/swarm.js";
import { runLabTwoTransport } from "../_helpers/lab-two-transport.js";
import { getLabBudgets } from "../_helpers/lab-budgets.js";

const budgets = getLabBudgets();

test("lab-ratifier.restart-dedupe.two-transport", { timeout: budgets.outerTimeoutMs }, async (t) => {
  const result = await runLabTwoTransport(t, {
    name: "lab-ratifier.restart-dedupe",
    opts: {
      strict: budgets.strict,
      realEnabled: budgets.realEnabled,
      labBudgets: budgets
    },
    async scenario(ctx) {
      const discoveryStore = ctx.createRoleCorestore("discovery-host");
      const concernHostStore = ctx.createRoleCorestore("concern-host");
      const orgStore = ctx.createRoleCorestore("organism");
      const ratStore = ctx.createRoleCorestore("ratifier");

      const hostSwarm = ctx.createRoleSwarm("host");
      const orgSwarm = ctx.createRoleSwarm("organism");
      const ratSwarm = ctx.createRoleSwarm("ratifier");

      const topic = ctx.topicFor("lab-ratifier-restart-topic");
      const hostJoin = hostSwarm.join(topic, { server: true, client: true });
      const orgJoin = orgSwarm.join(topic, { server: true, client: true });
      const ratJoin = ratSwarm.join(topic, { server: true, client: true });

      ctx.resources.track("host-join", hostJoin, async (d) => {
        await d?.destroy?.().catch(() => {});
      });
      ctx.resources.track("org-join", orgJoin, async (d) => {
        await d?.destroy?.().catch(() => {});
      });
      ctx.resources.track("rat-join", ratJoin, async (d) => {
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
      await concernHost.append(
        { op: OP.STATE, v: 1, econ: { mode: 0, attemptBurn: 0, ratBurn: 0 } },
        { optimistic: false }
      );
      await concernHost.update({ wait: true });

      await addConcern(discovery, idEncoding.encode(concernHost.key), "lab-ratifier-restart");
      await discovery.update({ wait: true });

      const jobKey = await createJob(concernHost, "cap/lab-ratifier-restart", { in: "job" });
      const attemptToken = ctx.topicFor("lab-ratifier-restart-attempt");
      const concernHex = b4a.toString(concernHost.key, "hex");

      const orgKey = await Autobase.getLocalKey(orgStore.namespace(`concern-${concernHex}`));
      const ratifierKey = await Autobase.getLocalKey(ratStore.namespace(`concern-${concernHex}`));
      const discoveryKey = idEncoding.encode(discovery.key);

      let pubSent = false;
      let orgRunner = ctx.resources.track(
        "org-runner",
        await createRunner({
          role: "org",
          corestore: orgStore,
          swarm: orgSwarm,
          discoveryKeys: [discoveryKey],
          warmN: 1,
          warmupBudget: { maxTicks: 0, maxMs: 0, minViewReadable: true },
          projector: async (runnerCtx) => {
            if (pubSent) return;
            let hasJob = false;
            for await (const job of runnerCtx.jobs()) {
              if (b4a.equals(job.key, jobKey)) {
                hasJob = true;
                break;
              }
            }
            if (!hasJob) return;
            pubSent = true;
            await runnerCtx.publish.publishPub({
              cap: "cap/lab-pub",
              ref: { t: "result", k: jobKey, a: attemptToken }
            });
          }
        }),
        async (runner) => {
          await runner?.close?.().catch(() => {});
        }
      );

      let ratRunner = ctx.resources.track(
        "rat-runner-1",
        await createRunner({
          role: "ratifier",
          corestore: ratStore,
          swarm: ratSwarm,
          discoveryKeys: [discoveryKey],
          warmN: 1,
          warmupBudget: { maxTicks: 0, maxMs: 0, minViewReadable: false }
        }),
        async (runner) => {
          await runner?.close?.().catch(() => {});
        }
      );

      let ratRunner2 = null;
      const hostPublishView = getPublishView(concernHost);
      const hostRatView = getRatView(concernHost);

      return {
        discoveries: [
          { label: "host-join", target: hostJoin },
          { label: "org-join", target: orgJoin },
          { label: "rat-join", target: ratJoin }
        ],
        swarms: [
          { label: "host", swarm: hostSwarm, minConnections: 1 },
          { label: "organism", swarm: orgSwarm, minConnections: 1 },
          { label: "ratifier", swarm: ratSwarm, minConnections: 1 }
        ],
        bases: [],
        assert: async () => {
          let acceptedPub = null;
          let acceptedRat = null;

          for (let i = 0; i < 120; i++) {
            await tickRound({ hostSwarm, orgSwarm, ratSwarm, orgRunner, ratRunner, concernHost });
            acceptedPub = await getPubLeaf(hostPublishView, jobKey, orgKey, attemptToken);
            acceptedRat = await getRatLeaf(hostRatView, jobKey, ratifierKey, orgKey, attemptToken);
            if (acceptedPub && acceptedRat) break;
          }

          if (!acceptedPub) throw semanticError("pub was not accepted via derived view");
          if (!acceptedRat) throw semanticError("rat was not accepted via derived view");

          const ratCountBefore = await countRatAttempts(hostRatView, jobKey, ratifierKey, orgKey);
          if (ratCountBefore !== 1) {
            throw semanticError("expected exactly one accepted rat before restart", { ratCountBefore });
          }

          await ratRunner?.close?.().catch(() => {});
          ratRunner = null;

          let publishResult = null;
          let attempted = false;

          ratRunner2 = ctx.resources.track(
            "rat-runner-2",
            await createRunner({
              role: "ratifier",
              corestore: ratStore,
              swarm: ratSwarm,
              discoveryKeys: [discoveryKey],
              warmN: 1,
              warmupBudget: { maxTicks: 0, maxMs: 0, minViewReadable: false },
              projector: async (runnerCtx) => {
                if (attempted) return;
                attempted = true;
                publishResult = await runnerCtx.publish.publishRat({
                  jobKey,
                  orgKey,
                  attemptToken,
                  determination: 1,
                  tier: 1,
                  cap: "cap/lab-pub",
                  ref: { t: "result", k: jobKey, a: attemptToken },
                  note: "restart-dedupe-check"
                });
              }
            }),
            async (runner) => {
              await runner?.close?.().catch(() => {});
            }
          );

          for (let i = 0; i < 80 && !publishResult; i++) {
            await tickRound({ hostSwarm, orgSwarm, ratSwarm, orgRunner, ratRunner: ratRunner2, concernHost });
          }

          if (!publishResult) throw semanticError("ratifier restart did not attempt publishRat");

          const dedupeOk = publishResult.accepted === true && publishResult.deduped === true;
          if (!dedupeOk) {
            throw semanticError("publishRat was not deduped after restart", { publishResult });
          }

          const ratCountAfter = await countRatAttempts(hostRatView, jobKey, ratifierKey, orgKey);
          if (ratCountAfter !== ratCountBefore) {
            throw semanticError("rat entry count changed after restart", { ratCountBefore, ratCountAfter });
          }

          const ratLeafAfter = await getRatLeaf(hostRatView, jobKey, ratifierKey, orgKey, attemptToken);
          if (!ratLeafAfter) throw semanticError("accepted rat leaf missing after restart");

          const afterValue = ratLeafAfter.value ?? ratLeafAfter;
          const sameAttempt = b4a.equals(afterValue.ref.a, attemptToken);
          if (!sameAttempt) throw semanticError("rat leaf attempt token changed after restart");

          return [
            { name: "pub accepted in view", ok: true, observed: true, expected: true },
            { name: "rat accepted in view", ok: true, observed: true, expected: true },
            { name: "rat restart deduped", ok: dedupeOk, observed: publishResult, expected: { accepted: true, deduped: true } },
            { name: "rat count unchanged", ok: ratCountAfter === ratCountBefore, observed: ratCountAfter, expected: ratCountBefore }
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

async function tickRound({ hostSwarm, orgSwarm, ratSwarm, orgRunner, ratRunner, concernHost }) {
  await safeFlush(hostSwarm);
  await safeFlush(orgSwarm);
  await safeFlush(ratSwarm);
  if (orgRunner?.tick) await orgRunner.tick();
  if (ratRunner?.tick) await ratRunner.tick();
  await concernHost.update({ wait: true }).catch(() => {});
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
