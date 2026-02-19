import idEncoding from "hypercore-id-encoding";

/**
 * Teaching example: minimal Structure B worker.
 *
 * What this demonstrates:
 * - Per-job work items with explicit phases:
 *   `proposed -> published -> verify -> done`
 * - Backoff using `nextRunAtMs` (no sleeps).
 * - Marking done only after derived PUB leaf verification.
 *
 * Change this first:
 * - The publish `cap`/`meta`.
 * - Backoff values in `verify` miss path.
 *
 * Common mistakes:
 * - Skipping `verify` and treating publish call as acceptance.
 * - Keeping long-lived in-memory phase state (restart-unsafe).
 */

const WORK_ID = "worker-basic";

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

export default {
  name: "worker-basic",
  async onTick(ctx, api) {
    const nowMs = api.now();
    const concernZ32 = idEncoding.encode(ctx.concern.key);

    // Propose: ensure each visible job has one tracked work item.
    for await (const job of ctx.jobs()) {
      if (!job?.key) continue;
      const exists = await api.work.existsForJob({ concernKey: ctx.concern.key, jobKey: job.key });
      if (exists) continue;
      await api.work.create({
        concernKey: ctx.concern.key,
        jobKey: job.key,
        id: WORK_ID,
        phase: "proposed",
        nextRunAtMs: nowMs,
        data: { seededAtMs: nowMs }
      });
    }

    const accepted = await collectAcceptedPubMarkers(ctx);
    const open = await api.work.listOpen({ nowMs, limit: 256 });

    for (const work of open) {
      if (work.concernKey !== concernZ32) continue;

      if (work.phase === "proposed") {
        const pub = await api.publish.pub({
          concernKey: ctx.concern.key,
          jobKey: work.jobKey,
          cap: "cap/ecology/keep",
          meta: {
            tag: "keep",
            source: "worker-basic",
            workId: work.id,
            issuedAtMs: nowMs
          }
        });

        await api.work.markWaiting(
          {
            ...work,
            phase: "published",
            attempts: (work.attempts || 0) + 1,
            pubAttemptZ32: pub.attemptZ32,
            data: {
              ...(work.data || {}),
              publishedAtMs: nowMs
            }
          },
          {
            nextRunAtMs: nowMs + 200,
            note: "move-to-verify"
          }
        );
        continue;
      }

      if (work.phase === "published") {
        await api.work.markWaiting(
          {
            ...work,
            phase: "verify"
          },
          {
            nextRunAtMs: nowMs + 200,
            note: "verify-derived-pub"
          }
        );
        continue;
      }

      if (work.phase === "verify") {
        const hasAccepted = work.pubAttemptZ32 && accepted.has(marker(work.jobKey, work.pubAttemptZ32));
        if (hasAccepted) {
          await api.work.markDone(
            {
              ...work,
              phase: "done",
              data: {
                ...(work.data || {}),
                acceptedAtMs: nowMs
              }
            },
            { outcome: "derived-pub-seen" }
          );
          continue;
        }

        const backoffMs = Math.min(10_000, 500 * Math.max(1, work.attempts || 1));
        await api.work.markWaiting(
          {
            ...work,
            phase: "proposed",
            data: {
              ...(work.data || {}),
              verifyMissAtMs: nowMs,
              backoffMs
            }
          },
          {
            nextRunAtMs: nowMs + backoffMs,
            note: "retry-propose-after-verify-miss"
          }
        );
        continue;
      }

      await api.work.abandon(work, { reason: `unknown-phase:${String(work.phase)}` });
    }
  }
};
