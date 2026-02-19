import b4a from "b4a";

// INTENT(phase-b5-style): Isolate runner tick orchestration while preserving discovery cursor updates, warm/revisit ordering, projector invocation order, and persistence timing.

function createTick({
  discoveries,
  scanDiscovery,
  warmset,
  warmupBudget,
  retryPolicy,
  getStrictState,
  getPublishView,
  getRatView,
  getJobView,
  buildProjectorContext,
  projector,
  dedupeState,
  hydrateRatified,
  persistState
}) {
  return async function tick() {
    // scan discovery
    for (const d of discoveries) {
      await d.disc.update({ wait: true }).catch(() => {});
      let latest = d.cursor;
      for await (const entry of scanDiscovery(d.disc, { since: d.cursor })) {
        latest = entry.seq;
        if (entry.t === 2 /* concern */) {
          await warmset.warm(entry.k32, { warmupBudget, retryPolicy });
        }
      }
      d.cursor = latest;
    }

    // revisit any non-warmed items (skipped cooldown handled inside warm)
    for (const status of warmset.getStatuses()) {
      if (status.status !== "warmed") {
        await warmset.warm(status.keyBuf, { warmupBudget, retryPolicy });
      }
    }

    // run projector on warmed concerns only
    for (const w of warmset.getWarm()) {
      const concernHex = b4a.toString(w.keyBuf, "hex");

      const concernBase = w.base;
      // refresh local view so pubs/jobs reflect latest optimistic/state updates
      await concernBase.update().catch(() => {});
      const strictState = await getStrictState(concernBase, 1n).catch(() => null);
      const jobView = getJobView(concernBase);
      const publishView = getPublishView(concernBase);
      const ratView = getRatView(concernBase);
      await hydrateRatified(concernBase, concernHex, w.keyBuf);
      const ctx = buildProjectorContext({
        concernBase,
        concernKey: w.keyBuf,
        concernHex,
        strictState,
        dedupeState,
        jobView,
        publishView,
        ratView
      });

      await projector(ctx);
    }

    await persistState();
  };
}

export { createTick };
