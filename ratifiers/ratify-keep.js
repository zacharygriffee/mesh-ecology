import idEncoding from "hypercore-id-encoding";

/**
 * Teaching example: selective ratification policy.
 *
 * What this demonstrates:
 * - Selectivity is edge policy (ratifier logic), not protocol physics.
 * - Keep predicate using metadata first, then capability fallback.
 *
 * Change this first:
 * - Predicate in `keep`.
 *
 * Common mistakes:
 * - Moving this selectivity into concern.apply (would change physics).
 * - Relying on one metadata field only without a fallback.
 */

export default {
  name: "ratify-keep",
  async onTick(ctx, api) {
    for await (const pub of ctx.pubs()) {
      if (!pub?.jobKey || !pub?.attempt || !pub?.value?.oK) continue;

      const metaTag = pub?.value?.meta?.tag;
      const cap = String(pub?.value?.cap || "");
      const keep = metaTag === "keep" || cap.includes("/keep");
      if (!keep) continue;

      await api.publish.rat({
        concernKey: ctx.concern.key,
        jobKey: pub.jobKey,
        orgKey: pub.value.oK,
        attemptZ32: idEncoding.encode(pub.attempt),
        cap: cap || "cap/ecology/rat",
        note: "ratify-keep"
      });
    }
  }
};
