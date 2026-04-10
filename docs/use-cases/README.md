# Use Cases

Purpose: give adjacent repos and app authors the shortest practical path into `mesh-v0-2` without making them start from engine internals.

Boundary reminder:
- `mesh-v0-2` owns runtime fabric and supported engine surfaces
- `mesh-ecology-packs` owns the preferred control-plane posture
- adjacent repos own their own app canon and domain semantics
- when an adjacent repo refers to this local checkout in prose, prefer `(adjacent mesh-v0-2)`

Start here by intent:

- I only need read-only observation or app-side participation:
  - [observer-client.md](observer-client.md)
- My app wants to expose a concern surface and let mesh supply conventional organisms/ratifiers:
  - [app-exposes-concern.md](app-exposes-concern.md)
- I am authoring an organism only:
  - [organism-author.md](organism-author.md)
- I am authoring a ratifier only:
  - [ratifier-author.md](ratifier-author.md)
- I am not sure which role I am:
  - [choose-your-role.md](choose-your-role.md)
- I am integrating mesh into an adjacent repo and need the clean boundary first:
  - [adjacent-repo-integration.md](adjacent-repo-integration.md)
- I need the contribution rule for new organisms, ratifiers, or concern conventions:
  - [actor-hygiene.md](actor-hygiene.md)

Keep in mind:

- `mesh-v0-2` is a coordination/runtime fabric, not your app canon.
- Discovery is pointer fabric, not scheduling.
- Concern is the bounded shared coordination surface.
- Replicas default to `readonly`.
- Writable authority is explicit.
- Mesh-facing actors must obtain shared truth through mesh participation or supported surfaces, never through another runtime's local storage.
- `mesh-ecology-packs` is the preferred control-plane layer for operational workflows.
- Reusable actor and convention intake should prefer packs before physics.
- Physics proof and canonical mesh proof are different proof lanes; low-level mechanics proof is necessary but not sufficient for canonical actor validity.

Deep references:

- locked invariants: [../v0-locked.md](../v0-locked.md)
- protocol snapshot: [../protocol.md](../protocol.md)
- canonical participation doctrine: [../canonical-mesh-participation.md](../canonical-mesh-participation.md)
- runtime support policy: [../runtime-support-policy.md](../runtime-support-policy.md)
- runtime consumer migration note: [../runtime-consumer-migration.md](../runtime-consumer-migration.md)
