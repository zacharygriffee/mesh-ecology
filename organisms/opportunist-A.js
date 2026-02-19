import b4a from "b4a";

const nextTickAtByConcern = new Map();

export default {
  name: "opportunist-A",
  async onTick(ctx, api) {
    const concernHex = b4a.toString(ctx.concern.key, "hex");
    const nowMs = api.now();
    const nextAt = nextTickAtByConcern.get(concernHex) || 0;
    if (nowMs < nextAt) return;

    const jobs = [];
    for await (const job of ctx.jobs()) {
      if (!job?.key) continue;
      jobs.push(job);
    }
    if (!jobs.length) {
      nextTickAtByConcern.set(concernHex, api.work.cooldown(500, 1200));
      return;
    }

    const chosen = jobs[Math.floor(Math.random() * jobs.length)];
    const keep = Math.random() < 0.5;
    const tag = keep ? "keep" : "skip";
    const cap = keep ? "cap/ecology/keep" : "cap/ecology/skip";

    await api.publish.pub({
      concernKey: ctx.concern.key,
      jobKey: chosen.key,
      cap,
      meta: {
        tag,
        source: "opportunist-A",
        issuedAt: nowMs
      }
    });

    nextTickAtByConcern.set(concernHex, api.work.cooldown(500, 1200));
  }
};
