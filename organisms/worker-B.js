import idEncoding from "hypercore-id-encoding";

const MAX_ATTEMPTS = 25;

function marker(jobZ32, attemptZ32) {
  return `${jobZ32}:${attemptZ32}`;
}

function capAndTagForWork(work) {
  const keep = work.id.charCodeAt(0) % 2 === 0;
  return {
    tag: keep ? "keep" : "skip",
    cap: keep ? "cap/ecology/keep" : "cap/ecology/skip"
  };
}

export default {
  name: "worker-B",
  async onTick(ctx, api) {
    const nowMs = api.now();
    const concernKey = ctx.concern.key;
    const concernZ32 = idEncoding.encode(concernKey);

    // Phase 1: seed a work item for each job (best-effort, idempotent via existsForJob).
    for await (const job of ctx.jobs()) {
      if (!job?.key) continue;
      const jobZ32 = idEncoding.encode(job.key);
      const tracked = await api.work.existsForJob({ concernKey, jobKey: job.key });
      if (tracked) continue;
      await api.work.create({
        concernKey,
        jobKey: job.key,
        phase: "proposed",
        nextRunAtMs: nowMs,
        data: {
          seededAtMs: nowMs,
          concernZ32,
          jobZ32
        }
      });
    }

    // Phase 2: collect newly observed accepted PUB attempts from the derived view iterator.
    const accepted = new Set();
    for await (const pub of ctx.pubs()) {
      if (!pub?.jobKey || !pub?.attempt) continue;
      accepted.add(marker(idEncoding.encode(pub.jobKey), idEncoding.encode(pub.attempt)));
    }

    // Phase 3: advance eligible work. This persists across restarts via runner state bee.
    const open = await api.work.listOpen({ nowMs, limit: 256 });
    for (const work of open) {
      if (work.concernKey !== concernZ32) continue;

      if (work.phase === "proposed") {
        const { cap, tag } = capAndTagForWork(work);
        const pub = await api.publish.pub({
          concernKey: work.concernKey,
          jobKey: work.jobKey,
          cap,
          meta: {
            tag,
            worker: "worker-B",
            workId: work.id,
            issuedAt: nowMs
          }
        });

        await api.work.markWaiting(
          {
            ...work,
            phase: "published",
            pubAttemptZ32: pub.attemptZ32,
            attempts: (work.attempts || 0) + 1,
            data: {
              ...work.data,
              cap,
              tag,
              lastPublishAtMs: nowMs
            }
          },
          {
            nextRunAtMs: api.work.cooldown(300, 300),
            note: "awaiting-acceptance"
          }
        );
        continue;
      }

      if (work.phase === "published") {
        const seenAccepted = work.pubAttemptZ32 && accepted.has(marker(work.jobKey, work.pubAttemptZ32));
        if (seenAccepted) {
          await api.work.markDone(
            {
              ...work,
              phase: "done",
              data: {
                ...work.data,
                acceptedAtMs: nowMs
              }
            },
            { outcome: "derived-pub-seen" }
          );
          continue;
        }

        // Re-propose the same attempt token; deduped=true means acceptance was already observed by runner dedupe state.
        const retry = await api.publish.pub({
          concernKey: work.concernKey,
          jobKey: work.jobKey,
          cap: work.data?.cap || "cap/ecology/keep",
          meta: {
            ...(work.data || {}),
            worker: "worker-B",
            retryAtMs: nowMs
          },
          attemptZ32: work.pubAttemptZ32
        });

        if (retry?.result?.deduped) {
          await api.work.markDone(
            {
              ...work,
              phase: "done",
              data: {
                ...work.data,
                acceptedAtMs: nowMs
              }
            },
            { outcome: "dedupe-indicates-accepted" }
          );
          continue;
        }

        const attempts = (work.attempts || 0) + 1;
        if (attempts >= MAX_ATTEMPTS) {
          await api.work.abandon(
            {
              ...work,
              attempts,
              data: {
                ...work.data,
                abandonedAtMs: nowMs
              }
            },
            { reason: `max-attempts-${MAX_ATTEMPTS}` }
          );
          continue;
        }

        const backoffMs = Math.min(30_000, 500 * attempts);
        await api.work.markWaiting(
          {
            ...work,
            attempts,
            data: {
              ...work.data,
              lastRetryAtMs: nowMs,
              backoffMs
            }
          },
          {
            nextRunAtMs: nowMs + backoffMs,
            note: "retry-publish"
          }
        );
        continue;
      }

      await api.work.abandon(work, { reason: `unknown-phase:${String(work.phase)}` });
    }
  }
};
