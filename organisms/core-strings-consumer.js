import crypto from "crypto";
import path from "path";
import { mkdir } from "fs/promises";
import Corestore from "corestore";
import idEncoding from "hypercore-id-encoding";

/**
 * Teaching example: subscribe to RAT-accepted source shape from any producer.
 *
 * Posture warning:
 * - This demo reads from a repo-local demo Corestore under `ECO_STORE_ROOT`.
 * - That makes it a teaching artifact, not a canonical actor precedent.
 * - Do not copy this storage pattern into production actors for cross-runtime truth.
 * - Canonical actors obtain shared truth through discovery/concern participation.
 *
 * Pattern demonstrated:
 * - `ctx.pubs()` and `ctx.rats()` are accepted-view iterators with dedupe behavior.
 * - To avoid ordering races, persist observed PUB/RAT markers in `api.work`.
 * - Join those persisted markers across ticks, then publish derived output.
 * - Mark work done only after derived PUB acceptance is observed.
 *
 * Dependency note (Step 1 finding):
 * - We open Hypercores via `corestore` (repo dependency).
 * - NeonURI is not installed, so `core://<z32Key>` parsing is manual.
 */

const SOURCE_SCHEMA = "mesh/demo/core-strings/v1";
const DERIVED_SCHEMA = "mesh/demo/core-strings/v1/derived";

const SOURCE_WORK_ID = "core-strings-consumer-source";
const PUB_MARKER_ID = "core-strings-consumer-pub-marker";
const RAT_MARKER_ID = "core-strings-consumer-rat-marker";
const URI_DONE_ID = "core-strings-consumer-uri-done";
const GLOBAL_STORE_PROMISE_KEY = "__meshCoreStringsDemoStorePromise";

function pubMarker(jobKeyZ32, orgKeyZ32, attemptZ32) {
  return `${jobKeyZ32}:${orgKeyZ32}:${attemptZ32}`;
}

function acceptedPubMarker(jobKeyZ32, attemptZ32) {
  return `${jobKeyZ32}:${attemptZ32}`;
}

function hash32(tag, value) {
  return crypto
    .createHash("sha256")
    .update(String(tag))
    .update("\0")
    .update(String(value))
    .digest()
    .subarray(0, 32);
}

function sourceWorkJobKey(marker) {
  return hash32("source-work", marker);
}

function ratMarkerJobKey(marker) {
  return hash32("rat-marker", marker);
}

function pubMarkerJobKey(marker) {
  return hash32("pub-marker", marker);
}

function uriDoneJobKey(uri) {
  return hash32("uri-done", uri);
}

function parseCoreUri(uri) {
  const raw = String(uri || "").trim();
  if (!raw.startsWith("core://")) return null;
  const keyZ32 = raw.slice("core://".length).trim();
  if (!keyZ32) return null;
  try {
    return { keyZ32, key: idEncoding.decode(keyZ32) };
  } catch {
    return null;
  }
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

async function readCoreStrings(outUri) {
  const parsed = parseCoreUri(outUri);
  if (!parsed) throw new Error(`invalid core URI: ${outUri}`);

  const store = await getSharedDemoStore();
  const core = store.get({ key: parsed.key, valueEncoding: "utf-8" });
  await core.ready();
  await core.update({ wait: true }).catch(() => {});

  const lines = [];
  const take = Math.min(core.length, 5);
  for (let i = 0; i < take; i++) {
    const raw = await core.get(i);
    lines.push(String(raw || "").replace(/\r?\n$/, ""));
  }
  return lines;
}

async function upsertDoneMarker(api, concernKey, jobKey, id, data, outcome) {
  const existing = await api.work.get({ concernKey, jobKey, id });
  if (existing?.status === "done") return existing;

  const seeded = existing || await api.work.create({
    concernKey,
    jobKey,
    id,
    phase: "seen",
    nextRunAtMs: api.now(),
    data: data || {}
  });

  return api.work.markDone(
    {
      ...seeded,
      phase: "done",
      data: {
        ...(seeded.data || {}),
        ...(data || {})
      }
    },
    { outcome }
  );
}

async function recordAcceptedPubs(ctx, api, nowMs) {
  for await (const pub of ctx.pubs()) {
    if (!pub?.jobKey || !pub?.attempt) continue;

    const jobZ32 = idEncoding.encode(pub.jobKey);
    const attemptZ32 = idEncoding.encode(pub.attempt);
    const accepted = acceptedPubMarker(jobZ32, attemptZ32);
    await upsertDoneMarker(
      api,
      ctx.concern.key,
      pubMarkerJobKey(accepted),
      PUB_MARKER_ID,
      { marker: accepted, seenAtMs: nowMs },
      "accepted-pub-seen"
    );

    if (!pub?.value?.oK) continue;
    const schema = pub?.value?.meta?.schema;
    const outUri = String(pub?.value?.meta?.outUri || "").trim();
    if (schema !== SOURCE_SCHEMA || !outUri) continue;

    const sourceMarker = pubMarker(jobZ32, idEncoding.encode(pub.value.oK), attemptZ32);
    const sourceKey = sourceWorkJobKey(sourceMarker);
    const existing = await api.work.get({
      concernKey: ctx.concern.key,
      jobKey: sourceKey,
      id: SOURCE_WORK_ID
    });
    if (existing) continue;

    await api.work.create({
      concernKey: ctx.concern.key,
      jobKey: sourceKey,
      id: SOURCE_WORK_ID,
      phase: "await-rat",
      nextRunAtMs: nowMs,
      data: {
        marker: sourceMarker,
        inputUri: outUri,
        sourceJobZ32: jobZ32,
        sourceOrgZ32: idEncoding.encode(pub.value.oK),
        sourceAttemptZ32: attemptZ32,
        seededAtMs: nowMs
      }
    });
  }
}

async function recordAcceptedRats(ctx, api, nowMs) {
  for await (const rat of ctx.rats()) {
    if (!rat?.jobKey || !rat?.organismKey || !rat?.attempt) continue;
    const marker = pubMarker(
      idEncoding.encode(rat.jobKey),
      idEncoding.encode(rat.organismKey),
      idEncoding.encode(rat.attempt)
    );
    await upsertDoneMarker(
      api,
      ctx.concern.key,
      ratMarkerJobKey(marker),
      RAT_MARKER_ID,
      { marker, seenAtMs: nowMs },
      "accepted-rat-seen"
    );
  }
}

async function isDoneMarkerPresent(api, concernKey, jobKey, id) {
  const marker = await api.work.get({ concernKey, jobKey, id });
  return marker?.status === "done";
}

export default {
  name: "core-strings-consumer",
  async onTick(ctx, api) {
    const nowMs = api.now();
    const concernZ32 = idEncoding.encode(ctx.concern.key);

    // Stage 1: persist all newly observed accepted PUB/RAT leaves.
    await recordAcceptedPubs(ctx, api, nowMs);
    await recordAcceptedRats(ctx, api, nowMs);

    // Stage 2: advance source-work items with restart-safe phases.
    const open = await api.work.listOpen({ nowMs, limit: 256 });
    for (const work of open) {
      if (work.concernKey !== concernZ32 || work.id !== SOURCE_WORK_ID) continue;

      const marker = String(work?.data?.marker || "").trim();
      const inputUri = String(work?.data?.inputUri || "").trim();
      if (!marker || !inputUri) {
        await api.work.abandon(work, { reason: "missing-source-marker-or-uri" });
        continue;
      }

      if (work.phase === "await-rat") {
        const waitAttempts = (work.attempts || 0) + 1;
        const ratSeen = await isDoneMarkerPresent(
          api,
          ctx.concern.key,
          ratMarkerJobKey(marker),
          RAT_MARKER_ID
        );
        if (!ratSeen) {
          // Demo fallback:
          // some role topologies may lag or omit RAT visibility on organism runners.
          // We still prefer RAT first, but after bounded retries we proceed so the
          // end-to-end producer/consumer teaching path remains observable.
          const fallbackReady = waitAttempts >= 8;
          if (!fallbackReady) {
            await api.work.markWaiting(
              {
                ...work,
                attempts: waitAttempts
              },
              {
                nextRunAtMs: api.work.cooldown(700, 300),
                note: "await-ratification"
              }
            );
            continue;
          }

          await api.work.markWaiting(work, {
            nextRunAtMs: nowMs,
            note: "rat-visibility-timeout-continue-demo"
          });
        }

        const alreadyDoneForUri = await isDoneMarkerPresent(
          api,
          ctx.concern.key,
          uriDoneJobKey(inputUri),
          URI_DONE_ID
        );
        if (alreadyDoneForUri) {
          await api.work.markDone(
            {
              ...work,
              phase: "done",
              data: { ...(work.data || {}), skippedAtMs: nowMs }
            },
            { outcome: "uri-already-processed" }
          );
          continue;
        }

        const sourceJobZ32 = String(work?.data?.sourceJobZ32 || "").trim();
        if (!sourceJobZ32) {
          await api.work.abandon(work, { reason: "missing-source-job" });
          continue;
        }

        try {
          const strings = await readCoreStrings(inputUri);
          const joined = strings.join("|");
          const len = Buffer.byteLength(joined, "utf8");
          const count = strings.length;

          const pub = await api.publish.pub({
            concernKey: ctx.concern.key,
            jobKey: idEncoding.decode(sourceJobZ32),
            cap: "cap/demo/core-strings/derived",
            meta: {
              schema: DERIVED_SCHEMA,
              kind: "derived-summary",
              inputUri,
              summary: { joined, len, count }
            }
          });

          api.log(`[consumer] processed ${inputUri} -> derived published`);

          await api.work.markWaiting(
            {
              ...work,
              phase: "verify-derived",
              pubAttemptZ32: pub.attemptZ32,
              data: {
                ...(work.data || {}),
                derivedAttemptZ32: pub.attemptZ32,
                derivedPublishedAtMs: nowMs,
                summary: { len, count }
              }
            },
            {
              nextRunAtMs: api.work.cooldown(250, 200),
              note: "await-derived-pub-acceptance"
            }
          );
        } catch (err) {
          await api.work.markWaiting(
            {
              ...work,
              attempts: (work.attempts || 0) + 1,
              data: {
                ...(work.data || {}),
                lastError: err?.message || String(err)
              }
            },
            {
              nextRunAtMs: api.work.cooldown(1_000, 500),
              note: "retry-read-or-publish-derived"
            }
          );
        }
        continue;
      }

      if (work.phase === "verify-derived") {
        const sourceJobZ32 = String(work?.data?.sourceJobZ32 || "").trim();
        const derivedAttemptZ32 = String(work?.data?.derivedAttemptZ32 || "").trim();
        if (!sourceJobZ32 || !derivedAttemptZ32) {
          await api.work.abandon(work, { reason: "missing-derived-tracking" });
          continue;
        }

        const accepted = await isDoneMarkerPresent(
          api,
          ctx.concern.key,
          pubMarkerJobKey(acceptedPubMarker(sourceJobZ32, derivedAttemptZ32)),
          PUB_MARKER_ID
        );
        if (!accepted) {
          await api.work.markWaiting(work, {
            nextRunAtMs: api.work.cooldown(700, 400),
            note: "still-waiting-derived-pub-acceptance"
          });
          continue;
        }

        await upsertDoneMarker(
          api,
          ctx.concern.key,
          uriDoneJobKey(inputUri),
          URI_DONE_ID,
          { inputUri, doneAtMs: nowMs },
          "uri-processed"
        );

        await api.work.markDone(
          {
            ...work,
            phase: "done",
            data: {
              ...(work.data || {}),
              doneAtMs: nowMs
            }
          },
          { outcome: "derived-pub-accepted" }
        );
        continue;
      }

      await api.work.abandon(work, { reason: `unknown-phase:${String(work.phase)}` });
    }
  }
};
