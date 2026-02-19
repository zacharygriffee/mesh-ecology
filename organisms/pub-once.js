import idEncoding from "hypercore-id-encoding";

/**
 * Teaching example: publish exactly one PUB per concern, then stop.
 *
 * What this demonstrates:
 * - Persisting workflow state in `api.work` so restarts do not spam.
 * - Treating acceptance as derived-view observation (via `ctx.pubs()`), not append success.
 *
 * Change this first:
 * - `cap` / `meta` in the single `api.publish.pub(...)` call.
 *
 * Common mistakes:
 * - Marking work done immediately after publish (incorrect; wait for derived PUB leaf).
 * - Using in-memory flags instead of work journal persistence (breaks on restart).
 */

const WORK_ID = "pub-once";

function marker(jobKeyZ32, attemptZ32) {
  return `${jobKeyZ32}:${attemptZ32}`;
}

async function firstJob(ctx) {
  for await (const job of ctx.jobs()) {
    if (job?.key) return job;
  }
  return null;
}

async function hasAcceptedPub(ctx, jobKeyZ32, attemptZ32) {
  const target = marker(jobKeyZ32, attemptZ32);
  for await (const pub of ctx.pubs()) {
    if (!pub?.jobKey || !pub?.attempt) continue;
    const seen = marker(idEncoding.encode(pub.jobKey), idEncoding.encode(pub.attempt));
    if (seen === target) return true;
  }
  return false;
}

export default {
  name: "pub-once",
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
        data: { didPubOnce: false }
      });
    }

    if (work.data?.didPubOnce) return;
    if (nowMs < (work.nextRunAtMs || 0)) return;

    if (work.phase === "proposed") {
      const pub = await api.publish.pub({
        concernKey: ctx.concern.key,
        jobKey: job.key,
        cap: "cap/ecology/keep",
        meta: {
          tag: "keep",
          source: "pub-once",
          issuedAtMs: nowMs
        }
      });

      await api.work.markWaiting(
        {
          ...work,
          phase: "published",
          pubAttemptZ32: pub.attemptZ32,
          data: { ...(work.data || {}), didPubOnce: false, publishedAtMs: nowMs }
        },
        {
          nextRunAtMs: api.work.cooldown(300, 150),
          note: "wait-for-derived-pub"
        }
      );
      return;
    }

    if (work.phase === "published") {
      const accepted = work.pubAttemptZ32
        ? await hasAcceptedPub(ctx, work.jobKey, work.pubAttemptZ32)
        : false;

      if (!accepted) {
        await api.work.markWaiting(work, {
          nextRunAtMs: api.work.cooldown(600, 200),
          note: "still-waiting-derived-pub"
        });
        return;
      }

      await api.work.markDone(
        {
          ...work,
          phase: "done",
          data: { ...(work.data || {}), didPubOnce: true, acceptedAtMs: nowMs }
        },
        { outcome: "single-pub-derived-accepted" }
      );
      return;
    }

    await api.work.abandon(work, { reason: `unexpected-phase:${String(work.phase)}` });
  }
};
