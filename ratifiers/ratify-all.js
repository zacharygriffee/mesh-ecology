import idEncoding from "hypercore-id-encoding";

/**
 * Teaching example: ratify every accepted PUB the actor observes.
 *
 * What this demonstrates:
 * - Smallest useful ratifier implementation.
 * - Ratification as edge policy; acceptance still lives in concern apply.
 *
 * Change this first:
 * - `note` and optional `cap`.
 *
 * Common mistakes:
 * - Trying to mutate concern state directly (always publish via api).
 * - Confusing "I appended RAT" with "RAT accepted" (must be observed in derived view).
 */

export default {
  name: "ratify-all",
  async onTick(ctx, api) {
    for await (const pub of ctx.pubs()) {
      if (!pub?.jobKey || !pub?.attempt || !pub?.value?.oK) continue;
      await api.publish.rat({
        concernKey: ctx.concern.key,
        jobKey: pub.jobKey,
        orgKey: pub.value.oK,
        attemptZ32: idEncoding.encode(pub.attempt),
        cap: String(pub?.value?.cap || "cap/ecology/rat"),
        note: "ratify-all"
      });
    }
  }
};
