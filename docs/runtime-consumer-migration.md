Runtime Consumer Migration Note

Purpose: help sibling repos and direct engine consumers understand what remains supported, what is now preferred, and what should move to the packs-led control plane.

For new consumers, start with `docs/use-cases/` before reading this migration note. This document assumes you already know which role or integration posture you need.

Ownership split for this note:
- `mesh-v0-2` owns supported runtime surfaces and engine semantics
- `mesh-ecology-packs` owns the preferred control-plane path for operator workflows
- adjacent repos own app canon, product semantics, and repo-specific policy

## Short version

- No immediate consumer rewrite is required in this pass.
- `mesh-ecology-packs` `live:ctl` is now the preferred control plane for normal operator workflows.
- `@mesh/mesh-sdk` remains the preferred thin app/client surface.
- `@mesh/mesh-operator-cli` remains supported for compatibility, but is no longer the preferred primary control plane.
- Engine/runtime work should not duplicate pack/profile resolution unless a real consumer migration proves a gap.

## Supported now

- `ensureDiscoverySurface(...)`
- `ensureConcernSurface(...)`
- `createRunner(...)`
- `createRunnerShell(...)`
- `@mesh/mesh-sdk`

These remain valid engine-facing surfaces for current consumers.

## Legacy-supported now

- `@mesh/mesh-operator-cli` as the main human-facing control plane
- `src/organism.legacy.js`
- `src/ratifier.legacy.js`
- env-heavy/manual startup flows that predate `mesh-ecology-packs` pack/profile resolution

Legacy-supported means:
- still supported,
- not removed in this pass,
- not the preferred path for new usage.

Deprecated means:
- still works in this pass,
- must name a preferred replacement,
- is not part of the removal scope for this pass.

## Preferred usage by consumer type

### App/client consumers

Preferred path:
- use `@mesh/mesh-sdk` for observation and in-process participation

Do not move:
- client-facing observation or trace flows that already fit the SDK
- cross-runtime truth acquisition into store-root or filesystem inspection paths

Low-touch follow-up:
- point operators to `mesh-ecology-packs live:ctl` for workflow bring-up and diagnostics instead of trying to extend client code into a control plane

### Operator / automation consumers

Preferred path:
- use `mesh-ecology-packs` `live:ctl` with `--pack` and `--profile`

Keep working for now:
- direct `mesh-operator-cli` usage for stateless authority writes
- existing env/config-driven automation built around current engine semantics

Low-touch follow-up:
- move human-facing or environment-heavy orchestration to the packs repo first
- keep `mesh-operator-cli` for compatibility and narrow stateless authority cases
- prefer camelCase JSON config fields for runtime-owned config files while keeping current uppercase env vars and legacy aliases working

### Engine-adjacent sibling repos

Preferred path:
- consume the supported runtime surfaces only
- avoid coupling to warmset/retry/dedupe/projector internals
- avoid coupling to another runtime's local storage layout or copied corestore state

No-change allowed:
- if current usage stays within supported or legacy-supported paths and does not need the packs control plane yet

## Migration guidance

### No-change path

Stay where you are if:
- you already use `@mesh/mesh-sdk` for client behavior, or
- you use a currently supported engine surface and do not need pack/profile control-plane features

### Low-touch path

Move to this first:
- operator workflows → `mesh-ecology-packs live:ctl`
- client/observer behavior → keep on `@mesh/mesh-sdk`
- engine consumers → keep current supported APIs, but align docs and terminology with readonly-first replicas and explicit writer admission

### Later-adoption path

Defer until a future pass:
- removal of legacy engine entrypoints
- migration-helper automation
- config normalization shims tied to packs deprecation work
- any shift from `legacy-supported` to `deprecated` without real dependent-consumer evidence

## Explicit non-goals for this pass

- no protocol or apply semantic changes
- no required major-version migration
- no removal of current sibling-consumer paths
- no new engine APIs shaped around packs `profiles`
