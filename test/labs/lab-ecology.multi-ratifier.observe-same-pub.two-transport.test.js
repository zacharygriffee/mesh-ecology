import test from "brittle";

import {
  ensureConcernSurface,
  createJob,
  publishJobWork,
  publishJobRatification,
  getPublishView,
  getRatView,
  OP
} from "../../src/concern.js";
import { safeFlush } from "../_helpers/swarm.js";
import { runLabTwoTransport } from "../_helpers/lab-two-transport.js";
import { getLabBudgets } from "../_helpers/lab-budgets.js";

const budgets = getLabBudgets();

test("lab-ecology.multi-ratifier.observe-same-pub.two-transport", { timeout: budgets.outerTimeoutMs }, async (t) => {
  const result = await runLabTwoTransport(t, {
    name: "lab-ecology.multi-ratifier.observe-same-pub",
    opts: {
      strict: budgets.strict,
      realEnabled: budgets.realEnabled,
      labBudgets: budgets
    },
    async scenario(ctx) {
      const hostStore = ctx.createRoleCorestore("host");
      const followerStore = ctx.createRoleCorestore("follower");
      const orgAStore = ctx.createRoleCorestore("organism-a");
      const ratAStore = ctx.createRoleCorestore("ratifier-a");
      const ratBStore = ctx.createRoleCorestore("ratifier-b");

      const hostSwarm = ctx.createRoleSwarm("host");
      const followerSwarm = ctx.createRoleSwarm("follower");
      const orgASwarm = ctx.createRoleSwarm("organism-a");
      const ratASwarm = ctx.createRoleSwarm("ratifier-a");
      const ratBSwarm = ctx.createRoleSwarm("ratifier-b");

      const topic = ctx.topicFor("lab-ecology-multi-ratifier-topic");
      const hostJoin = hostSwarm.join(topic, { server: true, client: true });
      const followerJoin = followerSwarm.join(topic, { server: true, client: true });
      const orgAJoin = orgASwarm.join(topic, { server: true, client: true });
      const ratAJoin = ratASwarm.join(topic, { server: true, client: true });
      const ratBJoin = ratBSwarm.join(topic, { server: true, client: true });

      ctx.resources.track("host-join", hostJoin, async (d) => {
        await d?.destroy?.().catch(() => {});
      });
      ctx.resources.track("follower-join", followerJoin, async (d) => {
        await d?.destroy?.().catch(() => {});
      });
      ctx.resources.track("org-a-join", orgAJoin, async (d) => {
        await d?.destroy?.().catch(() => {});
      });
      ctx.resources.track("rat-a-join", ratAJoin, async (d) => {
        await d?.destroy?.().catch(() => {});
      });
      ctx.resources.track("rat-b-join", ratBJoin, async (d) => {
        await d?.destroy?.().catch(() => {});
      });

      const hostBase = ctx.resources.trackAutobase(
        await ensureConcernSurface(hostStore.namespace("concern-host"), hostSwarm)
      );
      const followerBase = ctx.resources.trackAutobase(
        await ensureConcernSurface(
          followerStore.namespace("concern-follower"),
          followerSwarm,
          { key: hostBase.key }
        )
      );
      const orgABase = ctx.resources.trackAutobase(
        await ensureConcernSurface(
          orgAStore.namespace("concern-org-a"),
          orgASwarm,
          { key: hostBase.key }
        )
      );
      const ratABase = ctx.resources.trackAutobase(
        await ensureConcernSurface(
          ratAStore.namespace("concern-rat-a"),
          ratASwarm,
          { key: hostBase.key }
        )
      );
      const ratBBase = ctx.resources.trackAutobase(
        await ensureConcernSurface(
          ratBStore.namespace("concern-rat-b"),
          ratBSwarm,
          { key: hostBase.key }
        )
      );

      await hostBase.append(
        { op: OP.STATE, v: 1, econ: { mode: 0, attemptBurn: 0, ratBurn: 0 } },
        { optimistic: false }
      );
      await hostBase.update({ wait: true });

      const hostPublishView = getPublishView(hostBase);
      const hostRatView = getRatView(hostBase);
      const orgAKey = orgABase.local.key;
      const ratAKey = ratABase.local.key;
      const ratBKey = ratBBase.local.key;

      return {
        discoveries: [
          { label: "host-join", target: hostJoin },
          { label: "follower-join", target: followerJoin },
          { label: "org-a-join", target: orgAJoin },
          { label: "rat-a-join", target: ratAJoin },
          { label: "rat-b-join", target: ratBJoin }
        ],
        swarms: [
          { label: "host", swarm: hostSwarm, minConnections: 1 },
          { label: "follower", swarm: followerSwarm, minConnections: 1 },
          { label: "organism-a", swarm: orgASwarm, minConnections: 1 },
          { label: "ratifier-a", swarm: ratASwarm, minConnections: 1 },
          { label: "ratifier-b", swarm: ratBSwarm, minConnections: 1 }
        ],
        bases: [],
        assert: async () => {
          const isReal = ctx.transportKind === "hyperswarm";
          const acceptWindowMs = isReal
            ? Math.max(12_000, Math.floor(budgets.convergeMs * 0.3))
            : 2_500;
          const settlePauseMs = isReal ? 20 : 0;
          const ratRepublishEveryMs = isReal ? 700 : 200;

          const jobKey = await createJob(hostBase, "cap/lab-ecology-multi-ratifier", { in: "job" });
          const attemptTokenA = ctx.topicFor("lab-ecology-rat-attempt-org-a");

          await publishJobWork(orgABase, jobKey, "cap/lab-ecology-pub", {
            t: "result",
            k: jobKey,
            a: attemptTokenA
          });

          let acceptedPub = null;
          const pubDeadline = Date.now() + acceptWindowMs;
          while (Date.now() < pubDeadline) {
            await settleRound({
              swarms: [hostSwarm, followerSwarm, orgASwarm, ratASwarm, ratBSwarm],
              bases: [hostBase, followerBase, orgABase, ratABase, ratBBase],
              rounds: 1
            });
            acceptedPub = await getPubLeaf(hostPublishView, jobKey, orgAKey, attemptTokenA);
            if (acceptedPub) break;
            if (settlePauseMs) await delayMs(settlePauseMs);
          }
          if (!acceptedPub) {
            throw semanticError("orgA pub was not accepted", {
              transport: ctx.transportKind,
              windowMs: acceptWindowMs
            });
          }

          let acceptedRatA = null;
          let acceptedRatB = null;
          let lastRatPublishAt = 0;
          const ratDeadline = Date.now() + acceptWindowMs;
          while (Date.now() < ratDeadline) {
            const now = Date.now();
            if (lastRatPublishAt === 0 || (now - lastRatPublishAt) >= ratRepublishEveryMs) {
              await publishJobRatification(
                ratABase,
                jobKey,
                orgAKey,
                attemptTokenA,
                1,
                1,
                "cap/lab-ecology-rat-a",
                { t: "result", k: jobKey, a: attemptTokenA },
                "ratifier-a"
              );
              await publishJobRatification(
                ratBBase,
                jobKey,
                orgAKey,
                attemptTokenA,
                1,
                1,
                "cap/lab-ecology-rat-b",
                { t: "result", k: jobKey, a: attemptTokenA },
                "ratifier-b"
              );
              lastRatPublishAt = now;
            }
            await settleRound({
              swarms: [hostSwarm, followerSwarm, orgASwarm, ratASwarm, ratBSwarm],
              bases: [hostBase, followerBase, orgABase, ratABase, ratBBase],
              rounds: 1
            });
            acceptedRatA = await getRatLeaf(hostRatView, jobKey, ratAKey, orgAKey, attemptTokenA);
            acceptedRatB = await getRatLeaf(hostRatView, jobKey, ratBKey, orgAKey, attemptTokenA);
            if (acceptedRatA && acceptedRatB) break;
            if (settlePauseMs) await delayMs(settlePauseMs);
          }

          if (!acceptedRatA) {
            throw semanticError("ratifierA rat was not accepted", {
              transport: ctx.transportKind,
              windowMs: acceptWindowMs
            });
          }

          if (!acceptedRatB) {
            throw semanticError("ratifierB rat was not accepted", {
              transport: ctx.transportKind,
              windowMs: acceptWindowMs
            });
          }

          const ratifierCount = await countRatifierKeys(hostRatView, jobKey);
          if (ratifierCount < 2) {
            throw semanticError("expected at least two ratifier branches for same pub", { ratifierCount });
          }

          return [
            { name: "pub accepted at pub/<job>/<orgA>/<attemptA>", ok: !!acceptedPub, observed: !!acceptedPub, expected: true },
            { name: "ratA accepted at rat/<job>/<ratA>/<orgA>/<attemptA>", ok: !!acceptedRatA, observed: !!acceptedRatA, expected: true },
            { name: "ratB accepted at rat/<job>/<ratB>/<orgA>/<attemptA>", ok: !!acceptedRatB, observed: !!acceptedRatB, expected: true },
            { name: "ratifier subtree contains plural ratifiers", ok: ratifierCount >= 2, observed: ratifierCount, expected: ">=2" }
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

async function settleRound({ swarms, bases, rounds }) {
  for (let i = 0; i < rounds; i++) {
    for (const swarm of swarms) await safeFlush(swarm);
    for (const base of bases) await base.update({ wait: true }).catch(() => {});
  }
}

async function getPubLeaf(publishView, jobKey, fromKey, attemptToken) {
  return publishView
    .sub(jobKey)
    .sub(fromKey)
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

async function countRatifierKeys(ratView, jobKey) {
  let count = 0;
  for await (const entry of ratView.sub(jobKey).createReadStream()) {
    if (entry?.key) count += 1;
  }
  return count;
}

function semanticError(message, detail = null) {
  const err = new Error(message);
  err.code = "ERR_LAB_SEMANTIC_ASSERT";
  err.detail = detail;
  return err;
}

function delayMs(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
