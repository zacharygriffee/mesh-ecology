function createPublishRat({
  validateRatAction,
  concernHex,
  concernBase,
  concernKey,
  ratifiedByConcern,
  makeRatifiedMarker,
  shouldCooldown,
  recordPublishError,
  publishJobRatification
}) {
  // INTENT(phase-b3-style): Publish RAT proposals with unchanged marker dedupe and cooldown behavior.
  return async function publishRat(action) {
    const { jobKey, orgKey, attemptToken, determination, tier, cap, ref, note } = validateRatAction(action);
    const marker = makeRatifiedMarker(concernKey, jobKey, orgKey, attemptToken);
    const ratifiedSet = ratifiedByConcern.get(concernHex);
    if (ratifiedSet && ratifiedSet.has(marker)) return { accepted: true, deduped: true };
    // Boundary: keep RAT cooldown namespace stable to preserve persisted status/debug shape.
    const cooldownId = `rat:${marker}`;
    if (shouldCooldown(concernHex, cooldownId)) return { accepted: false, deduped: false, cooldown: true };

    try {
      await publishJobRatification(
        concernBase,
        jobKey,
        orgKey,
        attemptToken,
        determination,
        tier,
        cap,
        ref,
        note
      );
      return { accepted: false, deduped: false };
    } catch (err) {
      recordPublishError(concernHex, cooldownId, err?.message || String(err));
      return { accepted: false, deduped: false, error: true, message: err?.message };
    }
  };
}

export { createPublishRat };
