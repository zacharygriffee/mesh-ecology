/**
 * Teaching example: publish on a recurring cooldown.
 *
 * What this demonstrates:
 * - Simple periodic behavior without timers/sleeps.
 * - Work-journal scheduling via `nextRunAtMs` + `api.work.cooldown(...)`.
 *
 * Change this first:
 * - The cooldown range in the final `markWaiting(...)`.
 *
 * Common mistakes:
 * - Calling sleep in `onTick` (blocks progression and fights runner cadence).
 * - Assuming every publish is accepted (acceptance is concern derived-view state).
 */

const WORK_ID = "pub-periodic";

async function firstJob(ctx) {
  for await (const job of ctx.jobs()) {
    if (job?.key) return job;
  }
  return null;
}

export default {
  name: "pub-periodic",
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
        phase: "active",
        nextRunAtMs: nowMs,
        data: { publishedCount: 0 }
      });
    }

    if (nowMs < (work.nextRunAtMs || 0)) return;

    const keep = ((work.data?.publishedCount || 0) % 2) === 0;
    const cap = keep ? "cap/ecology/keep" : "cap/ecology/skip";
    const tag = keep ? "keep" : "skip";
    const publishedCount = (work.data?.publishedCount || 0) + 1;

    const pub = await api.publish.pub({
      concernKey: ctx.concern.key,
      jobKey: job.key,
      cap,
      meta: {
        tag,
        source: "pub-periodic",
        publishedCount,
        issuedAtMs: nowMs
      }
    });

    await api.work.markWaiting(
      {
        ...work,
        phase: "active",
        attempts: (work.attempts || 0) + 1,
        data: {
          ...(work.data || {}),
          publishedCount,
          lastAttemptZ32: pub.attemptZ32,
          lastPublishedAtMs: nowMs
        }
      },
      {
        nextRunAtMs: api.work.cooldown(1_500, 1_000),
        note: "periodic-cooldown"
      }
    );
  }
};
