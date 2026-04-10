Organism Traversal Contract (reference, v0-aligned)

- Actor posture: traversal is a mesh-facing activity. Obtain truth through discovery/concern participation and revalidation on those surfaces, never through another runtime's local storage.
- Cursoring: traverse discovery/concern surfaces by sequence index; persist cursors locally (no protocol state). Use append-only ordering; do not assume key lookups.
- Dedupe: deduplicate advertisements and concerns locally by 32-byte key (buffer equality). Re-advertisements may appear multiple times; retain latest cursor and drop repeats per pass.
- Budgets: enforce local ceilings for (a) registry opens per pass, (b) concerns opened per pass, (c) entries scanned per surface. Budget misses should defer work to later passes.
- Liveness: either maintain a warm window (bounded open set) or bounded rechecks; revisit pending items within the same pass to tolerate propagation latency.
- Priority: discovery order is observational only; no priority or scheduling is derived from advertisement position.
- Queueing: traversal queues are local-only and ephemeral; reconstructable from cursors + append-only logs.
- Revalidation: before publishing work/ratifications, re-read the target concern to confirm job/attempt existence and uniqueness; never rely solely on cached discovery output.
