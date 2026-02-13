import b4a from "b4a";
import idEncoding from "hypercore-id-encoding";

// INTENT(phase-b4-style): Build the projector ctx with unchanged iterator, publish-wrapper, and dedupe/cooldown boundaries while keeping the ctx API shape stable.

function asBuf32(key) {
  const buf = b4a.isBuffer(key) ? key : idEncoding.decode(key);
  if (!b4a.isBuffer(buf) || buf.length !== 32) throw new Error("key must be 32 bytes");
  return buf;
}

function makeRatifiedMarker(concernKey, jobKey, orgKey, attemptToken) {
  return `rat/${idEncoding.encode(asBuf32(concernKey))}/${idEncoding.encode(asBuf32(jobKey))}/${idEncoding.encode(asBuf32(orgKey))}/${idEncoding.encode(asBuf32(attemptToken))}`;
}

function wrapProjectorCtx({ role, concernKey, strictState, projectorFns }) {
  return {
    role,
    concern: {
      key: concernKey,
      strictState,
      refresh: async () => {}
    },
    jobs: projectorFns.jobs,
    pubs: projectorFns.pubs,
    rats: projectorFns.rats,
    publish: {
      publishPub: projectorFns.publishPub,
      publishRat: projectorFns.publishRat
    }
  };
}

function createProjectorContextFactory({
  role,
  getPublishView,
  getRatView,
  getJobView,
  viewPubEncoding,
  viewRatEncoding,
  createPubsIterator,
  createRatsIterator,
  createPublishPub,
  createPublishRat,
  validatePubAction,
  validateRatAction,
  publishJobWork,
  publishJobRatification,
  rememberAccepted,
  shouldCooldown,
  recordPublishError
}) {
  return function buildProjectorContext({
    concernBase,
    concernKey,
    concernHex,
    strictState,
    dedupeState,
    jobView
  }) {
    const resolvedJobView = jobView ?? getJobView(concernBase);

    function pubs() {
      // Boundary: accepted PUB traversal and marker recording stay delegated to createPubsIterator.
      return createPubsIterator({
        concernBase,
        concernHex,
        acceptedByConcern: dedupeState.acceptedByConcern,
        rememberAccepted: (concernHexInner, id) => rememberAccepted(dedupeState, concernHexInner, id),
        getPublishView,
        viewPubEncoding
      });
    }

    function rats() {
      // Boundary: accepted RAT traversal and decode path stay delegated to createRatsIterator.
      return createRatsIterator({
        concernBase,
        getRatView,
        viewRatEncoding
      });
    }

    async function* jobs() {
      const stream = resolvedJobView.createReadStream();
      for await (const { key, value } of stream) yield { key, value };
    }

    const publishPub = createPublishPub({
      validatePubAction,
      concernHex,
      concernBase,
      acceptedByConcern: dedupeState.acceptedByConcern,
      shouldCooldown: (concernHexInner, cooldownId) => shouldCooldown(dedupeState, concernHexInner, cooldownId),
      recordPublishError: (concernHexInner, cooldownId, message) => {
        recordPublishError(dedupeState, concernHexInner, cooldownId, message);
      },
      publishJobWork
    });

    const publishRat = createPublishRat({
      validateRatAction,
      concernHex,
      concernBase,
      concernKey,
      ratifiedByConcern: dedupeState.ratifiedByConcern,
      makeRatifiedMarker,
      shouldCooldown: (concernHexInner, cooldownId) => shouldCooldown(dedupeState, concernHexInner, cooldownId),
      recordPublishError: (concernHexInner, cooldownId, message) => {
        recordPublishError(dedupeState, concernHexInner, cooldownId, message);
      },
      publishJobRatification
    });

    return wrapProjectorCtx({
      role,
      concernKey,
      strictState,
      projectorFns: { jobs, pubs, rats, publishPub, publishRat }
    });
  };
}

export {
  createProjectorContextFactory,
  makeRatifiedMarker
};
