# mesh-v0-2 todo

Purpose: keep the engine boring, compatibility-first, and explicit about authority-mediated writability while `mesh-ecology-packs` absorbs most user-facing simplification.

## Guiding decisions

- No major-release cleanup in this pass.
- No protocol, opcode, keyspace, or apply-rule changes.
- `discovery` and `concern` remain the only protocol surfaces.
- `authority` and `replica` are deployment roles, not new surfaces.
- Replica default posture is `readonly`.
- Writability is an authority-side, explicit capability grant.
- Existing sibling repos must be able to migrate incrementally.

## Compatibility contract

- Keep existing runtime semantics unchanged.
- Keep existing env-driven and CLI-driven flows working during the transition.
- Keep current SDK behavior for `state`, `trace`, propose/wait, and materialization semantics.
- Prefer compatibility wrappers, aliases, and documentation updates over removals.
- Treat old paths as `legacy-supported` before considering deprecation warnings.

## Phase 1: Compatibility baseline

- [x] Inventory current public/runtime-consumed entrypoints used by sibling repos, CLI flows, and packs helpers.
  - Accept when: one compatibility table covers exports, commands, env usage, and runtime assumptions relied on externally.
- [x] Mark each engine-facing surface as `supported`, `legacy-supported`, or `internal`.
  - Accept when: the support policy is documented in one place and linked from repo docs.

## Phase 2: Surface reduction

- [x] Declare the small supported engine surface around discovery open/use, concern open/use, runner creation, runner-shell creation, and mesh SDK usage.
  - Accept when: docs name the preferred entrypoints and explicitly stop presenting internals as first-class user concepts.
- [x] Remove wording that implies an `authority surface`.
  - Accept when: docs describe authority as a role over discovery/concern only.

## Phase 3: Capability model

- [x] Formalize the engine capability model in docs and public API expectations:
  - `authority | replica` as deployment role
  - `readonly | writable` as capability
  - replica default = `readonly`
  - writable elevation = explicit authority action
  - Accept when: repo docs and examples consistently present readonly-first replicas.
- [x] Audit comments, examples, and runner-facing docs for ambiguous writable posture.
  - Accept when: no maintained example implies writable-by-default replicas or actors.

## Phase 4: Engine API cleanup

- [x] Keep existing low-level APIs working while documenting preferred terminology and preferred entrypoints.
  - Accept when: no currently working sibling consumer path breaks.
- [x] Add compatibility aliases or normalization helpers where naming cleanup would otherwise force code churn.
  - Accept when: old names still resolve and new names are the documented preference.
- [x] Keep warmset/retry/dedupe/journal plumbing out of the public mental model.
  - Accept when: public docs center only discovery, concern, roles, actors, and materialization proof.

## Phase 5: Migration and deprecation

- [ ] Define a repo deprecation policy for engine-facing consumers.
  - Accept when: docs describe `supported`, `legacy-supported`, `deprecated`, and make clear that removal is not part of this pass.
- [x] Write a short sibling-repo migration note:
  - current usage
  - preferred usage
  - whether any code changes are required
  - Accept when: a dependent repo owner can tell whether they need no changes, low-touch changes, or later adoption work.
- [ ] Provide compatibility shims where needed for env/config normalization and legacy naming.
  - Accept when: migration can happen incrementally instead of atomically.

## Phase 6: Validation

- [x] Add or update targeted regression coverage for:
  - readonly replica defaults
  - explicit writer admission
  - actor helpers not implying authority powers
  - SDK `state`, `trace`, and materialization behavior
  - Accept when: focused runner/discovery/ratifier and SDK tests cover the compatibility-sensitive paths.
- [x] Keep protocol/runtime invariants visibly locked throughout the simplification work.
  - Accept when: no task in this TODO requires protocol or apply semantic changes.

## Coordination notes

- Primary product/control-plane work lives in [`../mesh-ecology-packs/todo.md`](../mesh-ecology-packs/todo.md).
- This repo should only absorb enough API/docs cleanup to support the packs-first control plane.
- Any task here that would change protocol semantics is out of scope and must be split into a separate explicit proposal.

## Validation set

- `npm test -- test/runner/agent-runner-runner-api.test.js`
- `npm test -- test/ratifier/agent-runner-ratifier-phase4.test.js`
- `npm test -- test/discovery/discovery-surface.replication.test.js`
- `npm test -- test/sdk/mesh-sdk.client.test.js`

## Phase 7: Runtime-owned host primitives for higher-layer wrappers

- [ ] Define one stable runtime-owned host spec covering discovery-host and concern-host config shape, required fields, and runtime-owned filesystem layout.
  - Accept when: higher layers can point to one boring spec for runtime-owned host fields and layout and do not need to reconstruct host setup from scripts or internal directories.
- [ ] Add one supported install/apply primitive that materializes runtime-owned config, units, and directories on a destination machine without adding orchestration or rollout semantics.
  - Accept when: packs or a product repo can hand runtime-owned host config to the engine in one supported shape without introducing new control-plane semantics.
- [ ] Add one machine-readable inspect/report primitive for deployed runtime hosts.
  - Report only bounded runtime facts such as:
    - host mode
    - configured discovery/concern keys
    - readiness or sync state
    - visibility state
    - writability or admission-relevant state
  - Must report observed runtime facts only; no remediation steps, rollout advice, or control-plane decisions.
  - Accept when: higher layers can consume one bounded report surface as proof input without custom parsing or orchestration-specific adapters.
- [ ] Define one stable packaging boundary for runtime-owned host binaries, config templates, unit files, install/apply assets, and their ownership relative to packs/product overlays.
  - Explicitly separate:
    - `mesh-v0-2` runtime-owned artifacts and primitives
    - `mesh-ecology-packs` deployment strategy and wrapping
    - product-repo overlays
  - Accept when: sibling repos no longer need to guess which deployment files or steps are engine-owned versus higher-layer owned.
- Gate: do not add wrapper hooks unless a named packs/product migration is blocked and the hook can be defined without introducing packs-shaped semantics.
