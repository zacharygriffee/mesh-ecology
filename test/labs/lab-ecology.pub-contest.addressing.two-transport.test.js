import test from "brittle";
import b4a from "b4a";

import {
  ensureConcernSurface,
  createJob,
  publishJobWork,
  getPublishView,
  OP
} from "../../src/concern.js";
import { safeFlush } from "../_helpers/swarm.js";
import { runLabTwoTransport } from "../_helpers/lab-two-transport.js";
import { getLabBudgets } from "../_helpers/lab-budgets.js";

const budgets = getLabBudgets();

test("lab-ecology.pub-contest.addressing.two-transport", { timeout: budgets.outerTimeoutMs }, async (t) => {
  const result = await runLabTwoTransport(t, {
    name: "lab-ecology.pub-contest.addressing",
    opts: {
      strict: budgets.strict,
      realEnabled: budgets.realEnabled,
      labBudgets: budgets
    },
    async scenario(ctx) {
      const hostStore = ctx.createRoleCorestore("host");
      const followerStore = ctx.createRoleCorestore("follower");
      const orgAStore = ctx.createRoleCorestore("organism-a");
      const orgBStore = ctx.createRoleCorestore("organism-b");

      const hostSwarm = ctx.createRoleSwarm("host");
      const followerSwarm = ctx.createRoleSwarm("follower");
      const orgASwarm = ctx.createRoleSwarm("organism-a");
      const orgBSwarm = ctx.createRoleSwarm("organism-b");

      const topic = ctx.topicFor("lab-ecology-pub-contest-topic");
      const hostJoin = hostSwarm.join(topic, { server: true, client: true });
      const followerJoin = followerSwarm.join(topic, { server: true, client: true });
      const orgAJoin = orgASwarm.join(topic, { server: true, client: true });
      const orgBJoin = orgBSwarm.join(topic, { server: true, client: true });

      ctx.resources.track("host-join", hostJoin, async (d) => {
        await d?.destroy?.().catch(() => {});
      });
      ctx.resources.track("follower-join", followerJoin, async (d) => {
        await d?.destroy?.().catch(() => {});
      });
      ctx.resources.track("org-a-join", orgAJoin, async (d) => {
        await d?.destroy?.().catch(() => {});
      });
      ctx.resources.track("org-b-join", orgBJoin, async (d) => {
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
      const orgBBase = ctx.resources.trackAutobase(
        await ensureConcernSurface(
          orgBStore.namespace("concern-org-b"),
          orgBSwarm,
          { key: hostBase.key }
        )
      );

      await hostBase.append(
        { op: OP.STATE, v: 1, econ: { mode: 0, attemptBurn: 0, ratBurn: 0 } },
        { optimistic: false }
      );
      await hostBase.update({ wait: true });

      const hostPublishView = getPublishView(hostBase);
      const orgAKey = orgABase.local.key;
      const orgBKey = orgBBase.local.key;

      return {
        discoveries: [
          { label: "host-join", target: hostJoin },
          { label: "follower-join", target: followerJoin },
          { label: "org-a-join", target: orgAJoin },
          { label: "org-b-join", target: orgBJoin }
        ],
        swarms: [
          { label: "host", swarm: hostSwarm, minConnections: 1 },
          { label: "follower", swarm: followerSwarm, minConnections: 1 },
          { label: "organism-a", swarm: orgASwarm, minConnections: 1 },
          { label: "organism-b", swarm: orgBSwarm, minConnections: 1 }
        ],
        bases: [],
        assert: async () => {
          const jobKey = await createJob(hostBase, "cap/lab-ecology-pub-contest", { in: "job" });

          const attemptTokenA = ctx.topicFor("lab-ecology-attempt-org-a");
          const attemptTokenB = ctx.topicFor("lab-ecology-attempt-org-b");
          if (b4a.equals(attemptTokenA, attemptTokenB)) {
            throw semanticError("attempt tokens must be distinct across organisms");
          }

          await publishJobWork(orgABase, jobKey, "cap/lab-ecology-pub-a", {
            t: "result",
            k: jobKey,
            a: attemptTokenA
          });
          await publishJobWork(orgBBase, jobKey, "cap/lab-ecology-pub-b", {
            t: "result",
            k: jobKey,
            a: attemptTokenB
          });

          let acceptedA = null;
          let acceptedB = null;
          for (let i = 0; i < 120; i++) {
            await settleRound({
              swarms: [hostSwarm, followerSwarm, orgASwarm, orgBSwarm],
              bases: [hostBase, followerBase, orgABase, orgBBase],
              rounds: 1
            });
            acceptedA = await getPubLeaf(hostPublishView, jobKey, orgAKey, attemptTokenA);
            acceptedB = await getPubLeaf(hostPublishView, jobKey, orgBKey, attemptTokenB);
            if (acceptedA && acceptedB) break;
          }

          if (!acceptedA) throw semanticError("orgA pub was not accepted");
          if (!acceptedB) throw semanticError("orgB pub was not accepted");

          const orgACountBefore = await countPubAttempts(hostPublishView, jobKey, orgAKey);
          const orgBCountBefore = await countPubAttempts(hostPublishView, jobKey, orgBKey);

          await publishJobWork(orgABase, jobKey, "cap/lab-ecology-pub-a", {
            t: "result",
            k: jobKey,
            a: attemptTokenA
          });

          await settleRound({
            swarms: [hostSwarm, followerSwarm, orgASwarm, orgBSwarm],
            bases: [hostBase, followerBase, orgABase, orgBBase],
            rounds: 40
          });

          const acceptedAAfter = await getPubLeaf(hostPublishView, jobKey, orgAKey, attemptTokenA);
          const acceptedBAfter = await getPubLeaf(hostPublishView, jobKey, orgBKey, attemptTokenB);
          const orgACountAfter = await countPubAttempts(hostPublishView, jobKey, orgAKey);
          const orgBCountAfter = await countPubAttempts(hostPublishView, jobKey, orgBKey);

          if (!acceptedAAfter || !acceptedBAfter) {
            throw semanticError("accepted leaves missing after duplicate publish attempt");
          }
          if (orgACountBefore !== 1 || orgACountAfter !== 1) {
            throw semanticError("duplicate pub changed orgA accepted attempt count", { orgACountBefore, orgACountAfter });
          }
          if (orgBCountBefore !== 1 || orgBCountAfter !== 1) {
            throw semanticError("orgB accepted attempt count mismatch", { orgBCountBefore, orgBCountAfter });
          }

          return [
            { name: "orgA pub accepted at pub/<job>/<orgA>/<attemptA>", ok: !!acceptedA, observed: !!acceptedA, expected: true },
            { name: "orgB pub accepted at pub/<job>/<orgB>/<attemptB>", ok: !!acceptedB, observed: !!acceptedB, expected: true },
            { name: "distinct attempts across organisms", ok: !b4a.equals(attemptTokenA, attemptTokenB), observed: b4a.toString(attemptTokenA, "hex") !== b4a.toString(attemptTokenB, "hex"), expected: true },
            { name: "duplicate within orgA does not create second leaf", ok: orgACountAfter === 1, observed: orgACountAfter, expected: 1 },
            { name: "orgB leaf unaffected", ok: orgBCountAfter === 1, observed: orgBCountAfter, expected: 1 }
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

async function countPubAttempts(publishView, jobKey, fromKey) {
  let count = 0;
  const stream = publishView
    .sub(jobKey)
    .sub(fromKey)
    .createReadStream({ valueEncoding: publishView.valueEncoding });

  for await (const _entry of stream) count += 1;
  return count;
}

function semanticError(message, detail = null) {
  const err = new Error(message);
  err.code = "ERR_LAB_SEMANTIC_ASSERT";
  err.detail = detail;
  return err;
}
