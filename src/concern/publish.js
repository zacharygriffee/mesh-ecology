import Krypto from "hypercore-crypto";

function createConcernPublishHelpers({
  OP,
  normalizeKeyToBuffer,
  normalizeStrictConfigV1,
  getStrictState
}) {
  // INTENT(phase-c4-style): Provide concern append-side helpers with unchanged writable/optimistic gating and canonicalization behavior.

  function random32() {
    return Krypto.randomBytes(32);
  }

  function normalizeRef({ t, k, p, h, a }) {
    k = normalizeKeyToBuffer(k);
    if (h) h = normalizeKeyToBuffer(h);
    a = normalizeKeyToBuffer(a);
    return { t, k, p, h, a };
  }

  async function addWriter(concern, key) {
    if (!concern.writable) throw new Error("concern is not writable");
    const keyBuff = normalizeKeyToBuffer(key);
    await concern.append({ op: OP.ADD, key: keyBuff });
    await concern.update();
  }

  async function createJob(concern, cap, job) {
    if (!concern.writable) throw new Error("concern is not writable");
    const key = random32();
    await concern.append({ key, op: OP.JOB, data: { in: job, cap } });
    await concern.update();
    return key;
  }

  async function genesisConcernSurface(concern, state) {
    if (!concern.writable) throw new Error("concern is not writable");
    const normalized = normalizeStrictConfigV1(state);
    const { v, econ: { mode, attemptBurn, ratBurn } } = normalized;
    const strictState = await getStrictState(concern, v).catch(() => null);
    if (strictState) throw new Error("cannot overwrite state of version that exists");

    await concern.append({
      op: OP.STATE,
      v,
      econ: {
        mode, attemptBurn, ratBurn
      }
    });
    await concern.update({ wait: true });
  }

  async function publishJobWork(concern, jobKey, cap, ref, meta) {
    if (typeof cap !== "string") throw new Error("Cap must be a string");
    if (!ref || typeof ref !== "object") throw new Error("Ref object must be provided");
    const keyBuff = normalizeKeyToBuffer(jobKey);
    let {
      t, // Work result type
      k, // Job Key
      p, // Optional Path
      h, // Hash
      a // Attempt ID
    } = normalizeRef(ref);

    // Boundary: canonicalize ref.k to append job key.
    k = keyBuff;
    const valueKey = keyBuff;

    await concern.append(
      { op: OP.PUB, key: valueKey, cap, ref: { t, k, p, h, a }, meta },
      { optimistic: true }
    );
    await concern.update();
  }

  async function publishJobRatification(
    concern,
    jobKey,
    orgKey,
    attemptToken,
    determination,
    tier,
    cap,
    ref,
    note
  ) {
    jobKey = normalizeKeyToBuffer(jobKey);
    orgKey = normalizeKeyToBuffer(orgKey);
    attemptToken = normalizeKeyToBuffer(attemptToken);

    let { t, k, p, h, a } = normalizeRef(ref);
    // Boundary: canonicalize ref.k to ratification job key.
    k = jobKey;
    await concern.append(
      {
        op: OP.RAT,
        jK: jobKey,
        oK: orgKey,
        aK: attemptToken,
        d: determination,
        tr: tier,
        cap,
        ref: { t, k, p, h, a },
        n: note
      },
      { optimistic: true }
    );
    await concern.update();
  }

  return {
    addWriter,
    createJob,
    genesisConcernSurface,
    publishJobWork,
    publishJobRatification
  };
}

export { createConcernPublishHelpers };
