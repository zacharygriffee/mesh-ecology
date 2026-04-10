import crypto from "crypto";
import path from "path";
import { mkdir } from "fs/promises";
import Corestore from "corestore";
import idEncoding from "hypercore-id-encoding";

/**
 * Teaching example: publish one ratifiable "core://..." result per concern/job.
 *
 * Posture warning:
 * - This demo writes to a repo-local demo Corestore under `ECO_STORE_ROOT`.
 * - That makes it a teaching artifact, not a canonical actor precedent.
 * - Do not copy this storage pattern into production actors for cross-runtime truth.
 * - Canonical actors obtain shared truth through discovery/concern participation.
 *
 * Pattern demonstrated:
 * - Keep workflow progress in `api.work` so restarts are safe.
 * - Treat `api.publish.pub(...)` as a proposal only; acceptance is observed via `ctx.pubs()`.
 * - Keep protocol payload canonical (`ref.t/ref.k/ref.a` is injected by DX `api.publish.pub`).
 *
 * Dependency note (Step 1 finding):
 * - This repo already has `corestore` dependency, but does not declare `hypercore` directly.
 * - Corestore returns Hypercore instances via `store.get(...)`, which is enough for this demo.
 * - NeonURI is not present in dependencies, so we emit/parse plain `core://<z32Key>` URIs.
 */

const SOURCE_SCHEMA = "mesh/demo/core-strings/v1";
const WORK_ID = "core-strings-producer";
const DEMO_LINES = [
  "alpha apple",
  "bravo berry",
  "charlie citrus",
  "delta date",
  "echo elderberry"
];

const GLOBAL_STORE_PROMISE_KEY = "__meshCoreStringsDemoStorePromise";

function marker(jobKeyZ32, attemptZ32) {
  return `${jobKeyZ32}:${attemptZ32}`;
}

async function collectAcceptedPubMarkers(ctx) {
  const accepted = new Set();
  for await (const pub of ctx.pubs()) {
    if (!pub?.jobKey || !pub?.attempt) continue;
    accepted.add(marker(idEncoding.encode(pub.jobKey), idEncoding.encode(pub.attempt)));
  }
  return accepted;
}

async function firstJob(ctx) {
  for await (const job of ctx.jobs()) {
    if (job?.key) return job;
  }
  return null;
}

async function getSharedDemoStore() {
  if (!globalThis[GLOBAL_STORE_PROMISE_KEY]) {
    globalThis[GLOBAL_STORE_PROMISE_KEY] = (async () => {
      // Demo-only local storage for the teaching flow. This is not canonical actor posture.
      const root = path.resolve(process.env.ECO_STORE_ROOT || "./store/ecology");
      const dir = path.join(root, "demo-core-strings");
      await mkdir(dir, { recursive: true });
      const store = new Corestore(dir);
      await store.ready?.();
      return store;
    })();
  }
  return globalThis[GLOBAL_STORE_PROMISE_KEY];
}

async function createCoreWithFiveStrings() {
  const store = await getSharedDemoStore();
  const name = `core-strings-${Date.now()}-${crypto.randomBytes(4).toString("hex")}`;
  const core = store.get({ name, valueEncoding: "utf-8" });
  await core.ready();

  for (const line of DEMO_LINES) {
    // Keep each source string as one newline-delimited UTF-8 block for simple consumer parsing.
    await core.append(`${line}\n`);
  }
  await core.update({ wait: true }).catch(() => {});

  return {
    outUri: `core://${idEncoding.encode(core.key)}`,
    count: DEMO_LINES.length
  };
}

export default {
  name: "core-strings-producer",
  async onTick(ctx, api) {
    const job = await firstJob(ctx);
    if (!job?.key) return;

    const nowMs = api.now();
    let work = await api.work.get({
      concernKey: ctx.concern.key,
      jobKey: job.key,
      id: WORK_ID
    });

    if (!work) {
      work = await api.work.create({
        concernKey: ctx.concern.key,
        jobKey: job.key,
        id: WORK_ID,
        phase: "proposed",
        nextRunAtMs: nowMs,
        data: {}
      });
    }
    if (nowMs < (work.nextRunAtMs || 0)) return;

    if (work.phase === "proposed") {
      const created = work.data?.outUri
        ? { outUri: work.data.outUri, count: Number(work.data.count || DEMO_LINES.length) }
        : await createCoreWithFiveStrings();

      const pub = await api.publish.pub({
        concernKey: ctx.concern.key,
        jobKey: job.key,
        cap: "cap/demo/core-strings",
        meta: {
          schema: SOURCE_SCHEMA,
          kind: "hypercore",
          outUri: created.outUri,
          count: created.count,
          tags: ["keep", "demo", "core-strings"]
        }
      });

      await api.work.markWaiting(
        {
          ...work,
          phase: "published",
          pubAttemptZ32: pub.attemptZ32,
          data: {
            ...(work.data || {}),
            outUri: created.outUri,
            count: created.count,
            publishedAtMs: nowMs
          }
        },
        {
          nextRunAtMs: api.work.cooldown(300, 200),
          note: "wait-for-derived-pub-acceptance"
        }
      );
      return;
    }

    if (work.phase === "published") {
      const accepted = await collectAcceptedPubMarkers(ctx);
      const acceptedHere = work.pubAttemptZ32
        ? accepted.has(marker(work.jobKey, work.pubAttemptZ32))
        : false;

      if (acceptedHere) {
        await api.work.markDone(
          {
            ...work,
            phase: "done",
            data: {
              ...(work.data || {}),
              acceptedAtMs: nowMs
            }
          },
          { outcome: "source-core-pub-accepted" }
        );
        return;
      }

      await api.work.markWaiting(work, {
        nextRunAtMs: api.work.cooldown(600, 300),
        note: "still-waiting-derived-acceptance"
      });
      return;
    }

    if (work.phase === "done") return;
    await api.work.abandon(work, { reason: `unknown-phase:${String(work.phase)}` });
  }
};
