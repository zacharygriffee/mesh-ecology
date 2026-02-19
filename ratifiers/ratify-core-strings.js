import idEncoding from "hypercore-id-encoding";

/**
 * Teaching example: deterministic selectivity at the edge.
 *
 * Policy:
 * - Ratify only source records (`mesh/demo/core-strings/v1`).
 * - Do not ratify derived records to avoid extra loops/noise in this demo.
 *
 * This keeps concern.apply physics unchanged while showing schema-based edge policy.
 */

const SOURCE_SCHEMA = "mesh/demo/core-strings/v1";

export default {
  name: "ratify-core-strings",
  async onTick(ctx, api) {
    for await (const pub of ctx.pubs()) {
      if (!pub?.jobKey || !pub?.attempt || !pub?.value?.oK) continue;
      if (pub?.value?.meta?.schema !== SOURCE_SCHEMA) continue;

      await api.publish.rat({
        concernKey: ctx.concern.key,
        jobKey: pub.jobKey,
        orgKey: pub.value.oK,
        attemptZ32: idEncoding.encode(pub.attempt),
        cap: String(pub?.value?.cap || "cap/demo/core-strings/rat"),
        note: "ratify-core-strings-source"
      });
    }
  }
};
