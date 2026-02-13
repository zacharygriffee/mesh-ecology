import b4a from "b4a";

function createPublishPub({
  validatePubAction,
  concernHex,
  concernBase,
  acceptedByConcern,
  shouldCooldown,
  recordPublishError,
  publishJobWork
}) {
  // INTENT(phase-b3-style): Publish PUB proposals with the same dedupe and cooldown semantics as the runner-local wrapper.
  return async function publishPub(action) {
    const { cap, ref, meta } = validatePubAction(action);
    const attemptHex = b4a.toString(ref.a, "hex");
    const jobHex = b4a.toString(ref.k, "hex");
    const id = `${jobHex}:${attemptHex}`;
    const acceptedSet = acceptedByConcern.get(concernHex);
    if (acceptedSet && acceptedSet.has(id)) return { accepted: true, deduped: true };
    // Boundary: keep PUB cooldown namespace stable to preserve persisted status/debug shape.
    const cooldownId = `pub:${id}`;
    if (shouldCooldown(concernHex, cooldownId)) return { accepted: false, deduped: false, cooldown: true };

    try {
      await publishJobWork(concernBase, ref.k, cap, ref, meta);
      return { accepted: false, deduped: false };
    } catch (err) {
      recordPublishError(concernHex, cooldownId, err?.message || String(err));
      return { accepted: false, deduped: false, error: true, message: err?.message };
    }
  };
}

export { createPublishPub };
