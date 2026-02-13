import b4a from "b4a";
import { OP } from "../../src/concern.js";

/**
 * Negative-test helper: append an intentionally invalid PUB where ref.k != key.
 * This must only be used in negative acceptance-gate tests.
 */
async function appendRawPubInvalidRef({
  base,
  fromKey,
  jobKey,
  attemptToken,
  refK,
  cap = "cap/invalid-ref",
  meta = {}
}) {
  if (!base?.append) throw new Error("base with append() required");
  if (!jobKey || !attemptToken || !refK) throw new Error("jobKey, attemptToken, and refK are required");

  if (fromKey && base?.local?.key && !b4a.equals(fromKey, base.local.key)) {
    throw new Error("fromKey must match base.local.key for raw append helper");
  }

  await base.append(
    {
      op: OP.PUB,
      key: jobKey,
      cap,
      ref: { t: "result", k: refK, a: attemptToken },
      meta
    },
    { optimistic: true }
  );

  await base.update().catch(() => {});
}

export { appendRawPubInvalidRef };
