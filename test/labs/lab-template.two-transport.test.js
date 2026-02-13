import test from "brittle";
import b4a from "b4a";
import {
  ensureConcernSurface,
  createJob,
  publishJobWork,
  getPublishView
} from "../../src/concern.js";
import { runLabTwoTransport } from "../_helpers/lab-two-transport.js";
import { getLabBudgets } from "../_helpers/lab-budgets.js";

const budgets = getLabBudgets();

test("template lab runs scenario on fakeswarm then hyperswarm", { timeout: budgets.outerTimeoutMs }, async (t) => {
  const fakeReadyMs = Math.max(500, Math.floor(budgets.readyMs / 15));
  const fakePeerMs = Math.max(750, Math.floor(budgets.readyMs / 10));
  const realFlushMs = Math.max(2000, Math.floor(budgets.readyMs * 0.4));

  const result = await runLabTwoTransport(t, {
    name: "template-pub-acceptance",
    opts: {
      strict: budgets.strict,
      realEnabled: budgets.realEnabled,
      labBudgets: budgets,
      budgets: {
        fakeswarm: {
          ready: {
            flushMs: Math.min(1500, fakeReadyMs),
            connectMs: Math.min(1500, fakeReadyMs),
            peerMs: Math.min(2000, fakePeerMs)
          },
          convergeMs: Math.max(3000, Math.floor(budgets.convergeMs / 8))
        },
        hyperswarm: {
          ready: {
            flushMs: Math.min(budgets.readyMs, realFlushMs),
            connectMs: budgets.readyMs,
            peerMs: budgets.readyMs
          },
          convergeMs: budgets.convergeMs
        }
      }
    },
    async scenario(ctx) {
      const hostStore = ctx.createRoleCorestore("host");
      const followerStore = ctx.createRoleCorestore("follower");
      const hostSwarm = ctx.createRoleSwarm("host");
      const followerSwarm = ctx.createRoleSwarm("follower");

      const topic = ctx.topicFor("template-concern-topic");
      const hostJoin = hostSwarm.join(topic, { server: true, client: true });
      const followerJoin = followerSwarm.join(topic, { server: true, client: true });

      ctx.resources.track("host-join", hostJoin, async (d) => {
        try {
          await d?.destroy?.();
        } catch {}
      });
      ctx.resources.track("follower-join", followerJoin, async (d) => {
        try {
          await d?.destroy?.();
        } catch {}
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
          const jobKey = await createJob(hostBase, "cap/template-job", { in: "ok" });
          const attemptToken = ctx.topicFor("template-attempt");

          await publishJobWork(followerBase, jobKey, "cap/template-pub", {
            t: "result",
            k: jobKey,
            a: attemptToken
          });

          const hostPublishView = getPublishView(hostBase);
          let tick = 0;
          while (true) {
            tick += 1;
            if (typeof hostSwarm.flush === "function" && tick % 4 === 0) {
              await hostSwarm.flush().catch(() => {});
            }
            if (typeof followerSwarm.flush === "function" && tick % 4 === 0) {
              await followerSwarm.flush().catch(() => {});
            }

            await hostBase.update({ wait: true }).catch(() => {});
            const leaf = await hostPublishView
              .sub(jobKey)
              .sub(followerBase.local.key)
              .get(attemptToken, { valueEncoding: hostPublishView.valueEncoding })
              .catch(() => null);

            if (leaf) {
              const value = leaf.value ?? leaf;
              const capOk = value.cap === "cap/template-pub";
              const attemptOk = b4a.equals(value.ref.a, attemptToken);
              if (!capOk || !attemptOk) {
                const err = new Error("accepted pub leaf shape mismatch");
                err.code = "ERR_LAB_SEMANTIC_ASSERT";
                throw err;
              }
              return [
                { name: "pub accepted", ok: true, observed: true, expected: true },
                { name: "cap preserved", ok: capOk, observed: value.cap, expected: "cap/template-pub" },
                { name: "attempt token preserved", ok: attemptOk, observed: b4a.toString(value.ref.a, "hex"), expected: b4a.toString(attemptToken, "hex") }
              ];
            }

            await sleep(50);
          }
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

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
