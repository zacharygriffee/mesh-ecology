Runtime Support Policy

Purpose: define the supported engine-facing surface for the current compatibility-first simplification pass, without changing v0 runtime semantics.

Practical consumer guidance now starts in `docs/use-cases/` for adjacent repos, app integrators, concern owners, and actor authors. This document remains the engine-facing support policy underneath that layer.
Canonical actor-participation doctrine lives in `docs/canonical-mesh-participation.md`.

## Status classes

- `supported`: preferred engine-facing surfaces for current consumers and sibling repos.
- `legacy-supported`: still supported for compatibility, but not the preferred path for new usage.
- `deprecated`: still works in the current pass, but should not be chosen for new usage and should carry an explicit replacement path in docs.
- `internal`: implementation detail; do not build new consumers against it.

This document is lower precedence than:
1. `docs/v0-locked.md`
2. `docs/protocol.md`
3. `docs/canonical-mesh-participation.md`

If this document conflicts with higher-precedence runtime docs, the higher-precedence docs win.

## Compatibility rules for this pass

- No protocol, opcode, keyspace, or `concern.apply()` semantic changes.
- No removal of currently working sibling-repo paths in this pass.
- Prefer documentation, support-policy labeling, and compatibility wrappers over removals.
- Preserve current SDK behavior for `state`, `trace`, propose/wait, and materialization semantics.

## Canonical runtime model

- `discovery` and `concern` are the only protocol surfaces.
- `authority` and `replica` are deployment roles over those surfaces, not new surfaces.
- `readonly` and `writable` are capabilities.
- Replica default posture is `readonly`.
- Writability is an authority-side, explicit capability grant.
- Organism and ratifier runtimes are proposer helpers by default; they do not assume writer authority.
- Any mesh-facing actor must obtain cross-runtime truth through mesh participation on supported surfaces or supported SDK/operator APIs.
- Cross-runtime filesystem inspection, store-root handoff, copied local storage, or direct-store shortcuts are not supported actor patterns.
- Existing low-level mechanics tests may prove physics here without constituting canonical mesh proof by themselves.
- `PUB` / `RAT` submission is proposal input, not canonical concern state.
- Intake/observation of proposal material is local runtime evidence, not shared concern truth.
- Canonical concern truth is derived-view materialization only, whether the proposal came from an optimistic proposer or an admitted writer.

## Supported surfaces

- Discovery surface open/use through `ensureDiscoverySurface(...)`.
- Concern surface open/use through `ensureConcernSurface(...)`.
- Runner shell creation through `createRunnerShell(...)` for discovery roaming and concern warming without projector publishing.
- Runner creation through `createRunner(...)` for projector-driven proposer flows.
- Mesh SDK entrypoints through package exports in `packages/mesh-sdk`.
- Runtime-owned host primitives documented in `docs/runbooks/runtime-host-primitives.md`:
  - host spec
  - apply primitive
  - inspect/report primitive

These are the supported engine-facing behavior families for the current pass. New docs and new consumers should center these concepts rather than lower-level plumbing.

## Legacy-supported surfaces

- Legacy organism/ratifier entrypoints kept for compatibility:
  - `src/organism.legacy.js`
  - `src/ratifier.legacy.js`
- Existing env-driven/operator flows that rely on current engine semantics but have not yet moved to the packs-led control plane.

Legacy-supported means:
- keep working,
- do not remove in this pass,
- do not treat as the preferred path for new consumers.

## Deprecation policy for this pass

- Deprecation is documentation and migration posture first, not removal.
- A surface should normally move through:
  - `supported`
  - `legacy-supported`
  - `deprecated`
- Mark something `deprecated` only when all of the following are true:
  - a preferred replacement is already documented
  - a currently working consumer path still exists
  - the migration can happen incrementally rather than atomically
- `deprecated` in this pass means:
  - still works
  - not preferred for new usage
  - must name the preferred replacement in docs
  - must not be removed as part of this pass
- Removal requires a later explicit proposal and is out of scope for this compatibility-first todo.

## Internal surfaces

The following remain internal implementation details for this pass:

- warmset implementation and warming heuristics
- retry/cooldown internals
- discovery roaming bookkeeping details
- dedupe-state persistence details
- projector-context plumbing
- concern publish helper internals beyond the supported behavior families above

Internal does not mean unstable at runtime; it means new sibling consumers should not couple to those modules directly unless a later explicit support decision is made.

## Compatibility inventory (current)

| Surface / path | Current status | Notes |
| --- | --- | --- |
| `ensureDiscoverySurface(...)` | supported | Canonical discovery open/use path. |
| `ensureConcernSurface(...)` | supported | Canonical concern open/use path. |
| `createRunner(...)` | supported | Canonical projector runner path. |
| `createRunnerShell(...)` | supported | Canonical coordination-only shell path. |
| `packages/mesh-sdk` exports | supported | Preferred client-facing surface. |
| runtime-owned host spec/apply/report primitives | supported | Boring runtime-owned substrate for higher-layer wrappers. |
| `mesh-operator-cli` runtime usage | legacy-supported | Supported, but likely to be wrapped by packs-led control plane. |
| `src/organism.legacy.js` | legacy-supported | Compatibility only. |
| `src/ratifier.legacy.js` | legacy-supported | Compatibility only. |
| warmset / retry / dedupe internals | internal | Do not expose as first-class user concepts. |
| projector-context plumbing | internal | Keep behind runner APIs. |

## Stop line before consumer migration feedback

`mesh-ecology-packs` now owns the preferred control plane for normal operator workflows.
This runtime policy assumes the packs-side `live:ctl` + `pack.json` `profiles` model is the
control-plane freeze for the current compatibility pass.

The following are still intentionally deferred until a real dependent-repo migration exposes a
concrete need:

- any new engine API shaped around `pack.json` `profiles`
- engine aliases chosen only to smooth an actual consumer migration
- config normalization helpers for packs-led startup
- deprecation warnings aimed at packs migration rollout

Until a real migration proves otherwise, engine work should stay at support-policy docs,
capability wording, narrow compatibility shims, and regression coverage that protects current
semantics.
