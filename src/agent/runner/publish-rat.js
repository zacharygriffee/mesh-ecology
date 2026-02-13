import b4a from "b4a";
import idEncoding from "hypercore-id-encoding";

function asBuf32(key) {
  return b4a.isBuffer(key) ? key : idEncoding.decode(key);
}

function createPublishRat({
  validateRatAction,
  concernHex,
  concernBase,
  concernKey,
  acceptedByConcern,
  ratifiedByConcern,
  makeRatifiedMarker,
  forgetAccepted,
  shouldCooldown,
  recordPublishError,
  publishJobRatification
}) {
  // INTENT(phase-b3-style): Publish RAT proposals with unchanged marker dedupe and cooldown behavior.
  return async function publishRat(action) {
    const { jobKey, orgKey, attemptToken, determination, tier, cap, ref, note } = validateRatAction(action);
    const jobHex = b4a.toString(asBuf32(jobKey), "hex");
    const attemptHex = b4a.toString(asBuf32(attemptToken), "hex");
    const acceptedPubId = `${jobHex}:${attemptHex}`;
    const marker = makeRatifiedMarker(concernKey, concernBase.local.key, jobKey, orgKey, attemptToken);
    const ratifiedSet = ratifiedByConcern.get(concernHex);
    if (ratifiedSet && ratifiedSet.has(marker)) return { accepted: true, deduped: true };
    // Boundary: keep RAT cooldown namespace stable to preserve persisted status/debug shape.
    const cooldownId = `rat:${marker}`;
    if (shouldCooldown(concernHex, cooldownId)) {
      if (acceptedByConcern.get(concernHex)?.has(acceptedPubId)) forgetAccepted(concernHex, acceptedPubId);
      return { accepted: false, deduped: false, cooldown: true };
    }

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
      // Re-arm PUB iteration until a derived RAT leaf exists and hydrateRatified marks dedupe.
      if (acceptedByConcern.get(concernHex)?.has(acceptedPubId)) forgetAccepted(concernHex, acceptedPubId);
      return { accepted: false, deduped: false };
    } catch (err) {
      if (acceptedByConcern.get(concernHex)?.has(acceptedPubId)) forgetAccepted(concernHex, acceptedPubId);
      recordPublishError(concernHex, cooldownId, err?.message || String(err));
      return { accepted: false, deduped: false, error: true, message: err?.message };
    }
  };
}

export { createPublishRat };
