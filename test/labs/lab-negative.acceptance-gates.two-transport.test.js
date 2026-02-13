import test from "brittle";
import b4a from "b4a";

import {
  ensureConcernSurface,
  createJob,
  getPublishView,
  publishJobWork,
  OP
} from "../../src/concern.js";
import { safeFlush } from "../_helpers/swarm.js";
import { appendRawPubInvalidRef } from "../_helpers/raw-append.js";
import { runLabTwoTransport } from "../_helpers/lab-two-transport.js";
import { getLabBudgets } from "../_helpers/lab-budgets.js";

const budgets = getLabBudgets();

test("lab-negative.acceptance-gates.two-transport", { timeout: budgets.outerTimeoutMs }, async (t) => {
  const result = await runLabTwoTransport(t, {
    name: "lab-negative.acceptance-gates",
    opts: {
      strict: budgets.strict,
      realEnabled: budgets.realEnabled,
      labBudgets: budgets
    },
    async scenario(ctx) {
      const hostStore = ctx.createRoleCorestore("host");
      const followerStore = ctx.createRoleCorestore("follower");
      const hostSwarm = ctx.createRoleSwarm("host");
      const followerSwarm = ctx.createRoleSwarm("follower");

      const topic = ctx.topicFor("lab-negative-acceptance-topic");
      const hostJoin = hostSwarm.join(topic, { server: true, client: true });
      const followerJoin = followerSwarm.join(topic, { server: true, client: true });

      ctx.resources.track("host-join", hostJoin, async (d) => {
        await d?.destroy?.().catch(() => {});
      });
      ctx.resources.track("follower-join", followerJoin, async (d) => {
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

      await hostBase.append(
        { op: OP.STATE, v: 1, econ: { mode: 0, attemptBurn: 0, ratBurn: 0 } },
        { optimistic: false }
      );
      await hostBase.update({ wait: true });

      const jobKey = await createJob(hostBase, "cap/lab-negative", { in: "job" });
      const hostPublishView = getPublishView(hostBase);
      const followerKey = followerBase.local.key;

      return {
        discoveries: [
          { label: "host-join", target: hostJoin },
          { label: "follower-join", target: followerJoin }
        ],
        swarms: [
          { label: "host", swarm: hostSwarm, minConnections: 1 },
          { label: "follower", swarm: followerSwarm, minConnections: 1 }
        ],
        bases: [
          { label: "host-base", base: hostBase, minPeers: 1, required: true },
          { label: "follower-base", base: followerBase, minPeers: 1, required: true }
        ],
        assert: async () => {
          const invalidAttempt = ctx.topicFor("invalid-ref-attempt");
          const wrongJobKey = ctx.topicFor("wrong-job-key");

          // Subcase A: invalid ref alignment (value.key !== ref.k) must not materialize in view.
          await appendRawPubInvalidRef({
            base: followerBase,
            fromKey: followerKey,
            jobKey,
            attemptToken: invalidAttempt,
            refK: wrongJobKey,
            cap: "cap/invalid-ref",
            meta: { case: "invalid-ref-k" }
          });
          await settle({ hostBase, followerBase, hostSwarm, followerSwarm, rounds: 24 });

          const invalidLeaf = await hostPublishView
            .sub(jobKey)
            .sub(followerKey)
            .get(invalidAttempt, { valueEncoding: hostPublishView.valueEncoding })
            .catch(() => null);

          if (invalidLeaf) {
            throw semanticError("invalid ref alignment unexpectedly accepted", {
              jobKey: b4a.toString(jobKey, "hex"),
              attempt: b4a.toString(invalidAttempt, "hex")
            });
          }

          // Subcase B: duplicate attempt token must not create second acceptance.
          const validAttempt = ctx.topicFor("valid-attempt");
          await publishJobWork(followerBase, jobKey, "cap/valid", {
            t: "result",
            k: jobKey,
            a: validAttempt
          });

          let acceptedLeaf = null;
          for (let i = 0; i < 80; i++) {
            await settle({ hostBase, followerBase, hostSwarm, followerSwarm, rounds: 1 });
            acceptedLeaf = await hostPublishView
              .sub(jobKey)
              .sub(followerKey)
              .get(validAttempt, { valueEncoding: hostPublishView.valueEncoding })
              .catch(() => null);
            if (acceptedLeaf) break;
          }

          if (!acceptedLeaf) throw semanticError("valid pub was not accepted in derived view");

          const attemptsBefore = await countPubAttempts(hostPublishView, jobKey, followerKey);
          await publishJobWork(followerBase, jobKey, "cap/valid", {
            t: "result",
            k: jobKey,
            a: validAttempt
          });

          await settle({ hostBase, followerBase, hostSwarm, followerSwarm, rounds: 24 });
          const attemptsAfter = await countPubAttempts(hostPublishView, jobKey, followerKey);
          const acceptedLeafAfter = await hostPublishView
            .sub(jobKey)
            .sub(followerKey)
            .get(validAttempt, { valueEncoding: hostPublishView.valueEncoding })
            .catch(() => null);

          if (!acceptedLeafAfter) throw semanticError("accepted pub missing after duplicate submit");
          if (attemptsBefore !== 1 || attemptsAfter !== 1) {
            throw semanticError("duplicate attempt changed accepted entry count", {
              attemptsBefore,
              attemptsAfter
            });
          }

          return [
            { name: "invalid ref.k rejected", ok: !invalidLeaf, observed: !!invalidLeaf, expected: false },
            { name: "valid pub accepted", ok: !!acceptedLeaf, observed: !!acceptedLeaf, expected: true },
            { name: "duplicate attempt not accepted twice", ok: attemptsAfter === attemptsBefore && attemptsAfter === 1, observed: attemptsAfter, expected: 1 }
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

async function settle({ hostBase, followerBase, hostSwarm, followerSwarm, rounds }) {
  for (let i = 0; i < rounds; i++) {
    await safeFlush(hostSwarm);
    await safeFlush(followerSwarm);
    await hostBase.update({ wait: true }).catch(() => {});
    await followerBase.update({ wait: true }).catch(() => {});
  }
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
