// INTENT(phase-b4-style): Hold default runner projector policies with the same deterministic ratifier proposal behavior and role fallback semantics.

const RATIFIER_DETERMINATION_ACCEPT = 1;
const RATIFIER_TIER_DEFAULT = 1;
const RATIFIER_NOTE = "auto-ratified";
const RATIFIER_CAP_FALLBACK = "cap/ratifier/v1";

async function defaultRatifierProjector(ctx) {
  for await (const pub of ctx.pubs()) {
    const organismKey = pub?.value?.oK;
    const ref = pub?.value?.ref;
    if (!organismKey || !ref) continue;

    await ctx.publish.publishRat({
      jobKey: pub.jobKey,
      orgKey: organismKey,
      attemptToken: pub.attempt,
      determination: RATIFIER_DETERMINATION_ACCEPT,
      tier: RATIFIER_TIER_DEFAULT,
      cap: typeof pub?.value?.cap === "string" && pub.value.cap.length ? pub.value.cap : RATIFIER_CAP_FALLBACK,
      ref,
      note: RATIFIER_NOTE
    });
  }
}

async function noopProjector() {}

function getDefaultProjector(role) {
  return role === "ratifier" ? defaultRatifierProjector : noopProjector;
}

export {
  RATIFIER_DETERMINATION_ACCEPT,
  RATIFIER_TIER_DEFAULT,
  defaultRatifierProjector,
  getDefaultProjector
};
