# Organism Runtime & Ratifier Contract (current physics)

Status: normative for runtime implementers; aligned with `docs/v0-locked.md`, `docs/protocol.md`, and `docs/economy-contract.md`. Legacy `src/organism.js` and `src/ratifier.js` are non-authoritative.

## 1) Purpose and Scope
- Define the organism runtime as a reusable shell that discovers concerns, keeps a warm working set, and executes developer-supplied policy via projectors to publish work (PUB).
- Define the ratifier runtime as the same shell with ratification policy layered on top, producing RAT events deterministically from its viewpoint.
- Out of scope: concern-side apply rules (already specified elsewhere) and any economics beyond OFF/BURN/LOCK.
- Hard invariants (must hold): discovery is an append-only scan log with no scheduling semantics; concerns are Autobase surfaces with Hyperbee views, and acceptance happens only inside `concern.apply()`; `apply()` is deterministic/replay-safe (no env/time/random/network reads; no base-log appends from apply); strict state (`OP.STATE`) is canonical per version `v`, written once per `v` in the view—changing values requires bumping `v`; economy modes OFF/BURN/LOCK exist, with ecology running under OFF now and BURN/LOCK integrating only through `validateEconomic` + view projections (LOCK is the only decentralized Sybil-resistant mode); internal keys are 32-byte buffers (b4a) with z32 used only at UX/logging boundaries.

## 1.1 Organism–Ratifier Relationship (Normative)
- The organism and ratifier roles MUST be implemented by the **same Runtime Shell**.
- The shell is identical across roles: discovery membership + cursors, roaming and warm-set manager, concern warming contract, local state surface, and projector runner.
- The ONLY permitted divergence is a **Role Policy module** (`OrganismPolicy` vs `RatifierPolicy`) that defines:
  - which concern streams are subscribed to,
  - what constitutes a “work unit,”
  - which publish verbs are emitted (PUB vs RAT).
- Any divergence outside the Role Policy layer is DRIFT and MUST be explicitly documented as an “exception case.”

## Default Role: Optimistic Proposer (Normative)
- By default, both organism and ratifier operate as optimistic proposers (non-writers) on concern surfaces.
- They connect/open/replicate concern surfaces via the concern bootstrap key (`base.key`) obtained from discovery; replication uses the normal concern surface, not a writer admission path.
- In runtime terms, their default deployment posture is a `readonly` replica/follower until an authority process explicitly grants writer capability.
- Proposals are submitted only through optimistic appends: `base.append(..., { optimistic: true })`.
- In default mode they MUST NOT:
  - call `addWriter(...)`,
  - append authority events (JOB / ADD / STATE or any writer-only operations),
  - assume publication implies acceptance (acceptance is determined by `concern.apply()` and may reject the proposal).
- Acceptance is deterministic and performed by `concern.apply()`; optimistic proposals MAY be rejected without violating correctness.

## Extension: Authority Writer / Hosted Concern Surfaces (Out of Scope)
- It is valid for an operator-designed organism/ratifier to become an authority writer or to host/orchestrate concern surfaces.
- This is NOT part of the default contract and MUST be an explicit, purposeful design choice.
- Making a replica writable is an advanced operator action, not a default runtime assumption.
- Any implementation operating in writer-mode MUST document:
  - writer governance / admission model,
  - safety model (what it is allowed to append, how it avoids drift).
- This section fences advanced “kung fu” designs as out-of-scope for the default; it does not forbid them.

### Key Discipline
- `base.key`: bootstrap key advertised in discovery; used to connect/open/replicate. It is not authority-bearing by itself.
- `base.local.key`: the local identity key used when appending; it only becomes authority-bearing if admitted via `addWriter`.
- `base.view.key`: view replication key; implementation detail for derived state transfer.
- Optimistic proposers are identified by `from.key` in `apply`; presence of `from.key` DOES NOT imply membership in the writer set.

## 2) Interfaces and Responsibilities (Organism)
- Maintain organism-local coordination state using Autobase + Hyperbee (future-friendly for multi-device). This state is advisory only; it never alters concern acceptance.
- Track membership of discovery surfaces: add/remove registry endpoints, persist cursors, and respect the append-only ordering.
- Roam discovery surfaces, flatten advertisements, and maintain a bounded **warm set** of concern surfaces.
- For each concern in the warm set: open and replicate, await ready, then read strict state once per warm cycle (caching allowed per cycle, but the concern view remains canonical).
- Run per-concern work loops driven by a developer-provided async projector that proposes PUB events and updates local organism state for scheduling; the projector never mutates the concern view directly.

## 3) Interfaces and Responsibilities (Ratifier)
- Mirror the organism shell: same discovery membership handling and warm-set behavior.
- Observe attempts (PUB) and produce RAT events through the projector, deterministically from the ratifier’s perspective.
- Ratifier projectors use the same context shape but emit RAT publications instead of (or in addition to) PUB.
- **Shared Shell Components (must match Organism):**
  - local state surface
  - discovery membership + cursors
  - warm set manager + `warmN` configuration
  - concern warming contract steps
  - projector runner lifecycle
- **Policy Differences (ratifier-only):**
  - observes PUB/attempt streams
  - emits RAT publications
  - ratification-specific eligibility heuristics are local and non-authoritative

## 4) Standardized Runtime Model (Default Implementation)
- **Coordinator lane:** continuously scan discovery surfaces, dedupe advertisements, manage the warm set, and keep up to `warmN` concerns warmed concurrently.
- **Worker lane(s):** run per-concern projector loops on warmed concerns; concurrency is bounded by genesis config (global and per-concern caps).
- **Isolation:** one Corestore instance per role process (organism runner, ratifier runner, discovery host, concern host). Cache objects are scoped to an observational pass to prevent cross-pass bleed.
- **Multi-device future:** one primary coordinator plus N worker devices share the same organism identity; local organism state coordinates work distribution but does not influence concern acceptance. Any worker’s PUB/RAT proposals may be rejected by `concern.apply()` without violating determinism.
- Default flow example (end-to-end):
  1. Add a discovery surface → persist cursor.
  2. Coordinator scans discovery (append-only) → collects concern ads.
  3. Warm top `warmN` concerns → open/replicate/ready → read strict state.
  4. Worker projector observes jobs/attempts → publishes PUB (organism) or RAT (ratifier) via publish interfaces.
  5. Concern apply validates deterministically (including economics) → if accepted, view updates; otherwise proposals remain unacknowledged.
  6. Warm-set membership is rotated per roam policy; evicted concerns are cleanly closed.

## 5) Organism Genesis Configuration (local)
- Concept: local, non-canonical configuration used at organism instantiation; lives in organism-local state, not in any concern’s strict state.
- Fields:
  - `warmN` (required): number of concerns to warm concurrently.
  - `maxWorkers` (optional): total concurrent projector workers across all concerns.
  - `perConcernConcurrency` (optional): worker cap per concern.
  - `roamPolicy` (optional): warm-set rotation policy (e.g., LRU, round-robin) applied locally.
- Changing genesis config is a local decision and does not affect concern validation.

## 6) Concern Warming Contract
Concrete steps to “warm a concern” (per concern, per warm cycle):
1. Obtain `concernKey` and transport hints from the discovery scan entry.
2. `ensureConcernSurface(concernKey)`: open Autobase + view (namespaced per role), using the role’s single Corestore instance.
3. Replicate/join swarm as needed and wait for the concern view to be ready/up-to-date for this pass.
4. Read strict state from the concern view (default `v=1n` if unspecified) and cache it for this warm cycle only.
5. Establish minimal readers/watchers required by the projector: job stream, PUB stream, and (ratifier) RAT/attempt streams.
6. Enter the projector work loop while the concern remains in the warm set; exit cleanly on eviction.
7. On eviction: close cursors/watchers and release concern-specific resources; retain discovery cursors only.

## 7) Work Projector Hook (Developer API)
- Signature: 
```js
async function projectConcern(ctx) { /* yields zero or more actions */ }
```
- `ctx` contents (read-only unless noted):
  - `concern`: handles/views for the concern (Autobase + Hyperbee view).
  - `strictState`: snapshot of canonical strict config (mode/burn rates) for the current `v`.
  - `jobs`, `attempts`, `pubs`, `rats`: iterators/cursors for relevant streams.
  - `publishJobWork(params)`: emit PUB (organism).
  - `publishJobRatification(params)`: emit RAT (ratifier).
  - `localState`: read/write access to organism-local coordination/scheduling state.
- Allowed actions emitted by the projector:
  - Publish attempt (PUB) with provided refs/caps.
  - Publish ratification (RAT) (ratifier only).
  - Update local organism state (e.g., cursors, caches, metrics).
- Constraints: projector never mutates the concern view directly; all concern mutations happen via publish APIs and are subject to `concern.apply()`. The projector must tolerate rejection and replay without side effects.
- **Role Policy Contract:** The Runtime Shell is identical for organism and ratifier; the Role Policy declares (a) which streams to subscribe to (jobs/pub/rat as applicable), and (b) which actions it may emit (`publishWork`/`publishRatification`). Anything outside this policy boundary MUST NOT diverge between roles unless recorded as an exception.

## 8) Economics Awareness (OFF now, BURN/LOCK later)
- Modes (per `docs/economy-contract.md` strict state): OFF=0, BURN=1, LOCK=2.
- OFF (current ecology): ignore economics for eligibility; proposals aim for liveness. Acceptance is still decided by `concern.apply()`.
- BURN: projector reads canonical burn budgets/totals from the concern view; may locally throttle or reorder, but final gating runs inside `validateEconomic` before `ackWriter` in `concern.apply()`.
- LOCK: future decentralized Sybil-resistant mode; eligibility will depend on the canonical lock ledger. Projectors may pre-check view data but must defer to `concern.apply()`.
- No economic effects are written by the projector; all econ projections are view writes performed inside `concern.apply()` after acceptance.

## 9) Determinism and Safety Requirements
- Publishing is propositional only; acceptance happens solely inside `concern.apply()` under deterministic rules.
- `concern.apply()` is pure/deterministic: no base-log appends from apply; no reads of wall-clock time, randomness, environment variables, or networks; replay produces identical views.
- Strict state is write-once per version `v`; attempts to change values require bumping `v` and writing a new strict config key. Consumers must treat the stored value as canonical for that `v`.
- Internal keys are 32-byte buffers; z32 is for boundaries/logging only. Comparisons use buffer equality.
- Discovery scan order is observational only; it conveys no scheduling priority. Any scheduling heuristics are local and must not alter correctness when rejected.
- Caching/view reuse is scoped to an observational pass; cross-pass reuse without namespacing is forbidden. One Corestore per role process; no sharing across roles.
- Do not base eligibility or acceptance logic on host-local environment or wall-clock thresholds that cannot be replayed. Local heuristics may influence scheduling but must tolerate rejection.

## Non-goals (Default Contract)
- No organism-hosted concern surfaces.
- No automatic promotion to writer.
- No writer-governance logic in the default runtime.
- No cross-concern portable budgets/economics in default mode.

## Drift Prevention Checklist
- Does the ratifier share the same warm-set implementation as the organism?
- Does it share the same discovery roaming logic and cursors?
- Does it share the same concern warming steps?
- Are differences limited to subscriptions + publish verbs defined in Role Policy?
- If not, is the exception documented with justification for why it cannot live inside Role Policy?

## 10) Glossary
- **discovery surface:** the append-only scan log(s) an organism follows to find concerns or other discovery registries.
- **concern surface:** Autobase log plus derived Hyperbee view for one concern; canonical source of strict state and work records.
- **warm set:** bounded subset of concerns currently opened, replicated, and fed into projector loops.
- **strict state:** canonical configuration stored via `OP.STATE` at a versioned key in the concern view; write-once per `v`.
- **attemptToken:** unique token per PUB attempt, used for deduplication and econ effects.
- **PUB / RAT / JOB / STATE:** concern event/view namespaces for attempts, ratifications, jobs, and strict state.
- **projector:** developer-supplied async function that consumes concern streams and emits PUB/RAT proposals plus local state updates.

## Non-goals
- No new protocol events are introduced here.
- No scheduling semantics are derived from discovery ordering.
- No economics beyond OFF/BURN/LOCK integration points are specified; anything else is out of scope.
- No guarantee of replication latency or liveness is implied; organisms must tolerate delays and replays.
