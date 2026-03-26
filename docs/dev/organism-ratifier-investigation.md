> Status: Historical investigation notes. Useful for background, but not the source of truth for current runtime behavior.
> Current runtime truth lives in `docs/v0-locked.md`, `docs/protocol.md`, `docs/runtime-support-policy.md`, and the active runner tests.

# Organism/Ratifier Grounding — discovery.js & concern.js
_Repo state investigated on February 10, 2026. Updated after discovery replication mini-change._

## Post-mini-change update (replication helper + discovery replication convenience)
- `src/replicateBase.js` now also exports `replicateResource` (alias) and tolerates swarm connection objects that nest a `.socket` (lines ~1-24).
- `ensureDiscoverySurface(cs, config = {}, swarm?)` optionally wires replication via `replicateResource` immediately after Autobase construction; discovery remains advertise/scan-only (src/discovery.js, lines ~68-100).
- New fakeswarm coverage: `test/discovery-surface.replication.test.js` validates (1) the convenience path with `ensureDiscoverySurface(..., swarm)` and a shared key, and (2) the backward-compatible path where callers wire `replicateResource` manually.

## Discovery Surface Findings
- **Record schema (Autobase valueEncoding):** `op:uint8` where `APPEND=1`, `ADD=2`; APPEND payload `v` uses `{ t:uint8, k32:fixed32, v?:utf8 }` with `t` enum `DISCOVERY=1`, `CONCERN=2` (`src/discovery.js`, lines 7-65, 17-43). Fields are fixed32 buffers; labels are optional bounded UTF‑8 strings.
- **Key encoding:** `k32` is always a 32-byte Buffer. Human z32 strings are decoded/encoded only at call sites via `hypercore-id-encoding` (e.g., `addConcern`, `addDiscovery`, lines 108-129).
- **Append (advertise) API:** `addConcern(discovery, key, label?)` and `addDiscovery(...)` check `discovery.writable`, dedupe via linear scan `keyExists(view, k32)` over `view.createReadStream()`, then `base.append({op:APPEND, v:{t,k32,v}})` followed by `update()` (lines 102-122). `addWriter` appends `op:ADD, k32` for explicit writer admission (lines 124-129).
- **Scan (roam) API:** Consumers read the Hyperbee view returned by `open()` (`store.get({name:"view", valueEncoding: discoveryViewEncoding})`; lines 81-83) using `createReadStream()`; no cursors are stored in code—callers must track positions externally.
- **Apply behavior:** `apply(updates, view, host)` mirrors APPEND payloads into the view and invokes `host.addWriter(k32)` only for `OP.ADD` (lines 85-99). APPEND does not call `ackWriter`; discovery stays append-only.
- **Replication:** `ensureDiscoverySurface(cs, config, swarm?)` builds an Autobase with `open/apply`; if `swarm` is provided, it wires replication via `replicateResource`; otherwise callers remain responsible (lines ~68-99). Writer identity defaults to `Autobase.getLocalKey(cs)` when `config.key` not supplied.
- **Safe subscription guidance:** Open via `ensureDiscoverySurface`; optionally pass a swarm to auto-wire replication; otherwise call `replicateResource` yourself; stream the view append-only; dedupe locally by k32 if desired; track cursors in caller-local state since none are persisted in this module.

## Concern Surface Findings
- **Entrypoint:** `ensureConcernSurface(cs, swarm, {key?})` builds Autobase with `baseEncoding`, `open`, `apply`, `optimistic:true`, using `config.key ?? Autobase.getLocalKey(cs)`, wires replication via `replicateBase(base, swarm)`, then `ready()` (lines 421-434).
- **Initialization steps:** `open()` creates Hyperbee view (`keyEncoding: fixed32`, `extension:false`; lines 436-440). `apply()` delegates to `applyWithDeps` (lines 479-483).
- **Authority vs proposer:** Autobase is always created `optimistic:true`; writer authority is **not** inferred from `base.key === base.local.key` (no such check). Authority appends require `concern.writable` and specific helpers (`addWriter`, `createJob`, `genesisConcernSurface`), each guarding with `if (!concern.writable) throw ...` (lines 654-695, 682-687).
- **addWriter usage:** Only exposed via `addWriter(concern, key)`; not called inside apply except when processing non-optimistic `OP.ADD` (lines 614-618, 682-687).
- **publish APIs (optimistic proposers):**
  - `publishJobWork(concern, jobKey, cap, ref, meta)` → append `{op:PUB, key, cap, ref:{t,k,p?,h?,a}, meta}` with `{optimistic:true}` then `update()` (lines 704-722).
  - `publishJobRatification(concern, jobKey, orgKey, attemptToken, determination, tier, cap, ref, note)` → append `OP.RAT` optimistic then `update()` (lines 724-755).
- **Apply pipeline (deterministic authority):** `applyWithDeps` iterates updates:
  - **Optimistic branch:** validates structure + presence: job exists, attempt uniqueness, ref alignment; reads strict state (`getStrictStateFromView`, lines 442-447) and runs `validateEconomic`; on ok → `host.ackWriter(from.key)` then writes PUB or RAT into view (PUB under `pub/<job>/<org>/<attempt>`, RAT under `rat/<job>/<ratifier>/<org>/<attempt>`), then applies econ effects if any (lines 491-612).
  - **Non-optimistic branch:** `OP.ADD` → `host.addWriter`; `OP.JOB` writes job into `job/`; `OP.STATE` writes strict config once per version, skipping if exists (lines 613-645).
- **Meaning of “optimistic” here:** Autobase marks the update as optimistic; apply validates and explicitly `ackWriter(from.key)` before projecting into the view, gating convergence (lines 491-612, 525, 596).
- **When `base.writable` matters:** Only the local process with a writable corestore namespace can call helpers that throw otherwise. Optimistic proposers do **not** need local writability to append; they rely on optimistic mode and host ack.

## Capability + Identity Semantics
Matrix (Allowed/Forbidden/Derived with code refs):

| Capability | Host (concern indexer/authority) | Proposer (organism/ratifier) | Consumer/Leech |
| --- | --- | --- | --- |
| Open/replicate base | Allowed; `ensureConcernSurface` + `replicateBase` (421-434) | Allowed (same call; typically namespaced `org-`/`rat-`) | Allowed (open/replicate read-only) |
| View read | Allowed; Hyperbee view (436-440) | Allowed | Allowed |
| Optimistic append | Allowed but unnecessary; not prevented | Allowed via `publishJobWork` / `publishJobRatification` (704-755) | Allowed if they can append; apply will gate |
| Authoritative append (JOB/STATE/ADD) | Allowed when `concern.writable` true; `genesisConcernSurface`, `createJob`, `addWriter` (654-695) | Forbidden by default (not writable in proposer namespaces); helpers throw (682, 689) | Forbidden (no writable) |
| addWriter | Allowed via `addWriter` (682-687) | Forbidden by default (throws if not writable) | Forbidden |
| ackWriter (concern apply) | Performed inside `applyWithDeps` when optimistic PUB/RAT validated (525, 596) | Not called directly | Not called |
| ackWriter (agent/local) | Not present | Not present | Not present |

Identity notes:
- append identity is `from.key` supplied by Autobase update; optimistic proposers rely on `ackWriter(from.key)` inside apply for convergence.
- No comparison of `base.key` vs `base.local.key`; authority is purely `writable` + `OP.ADD` writes.

## Publish/Apply Mechanics
- **PUB event (optimistic):** `{op:PUB, key:<jobKey>, cap:string, ref:{t,k,p?,h?,a}, meta?}`; accepted only if job exists, attempt not duplicated, econ check ok; then stored under `pub/<job>/<org>/<attempt>` with `{oK, cap, ref, meta}` using `viewPubEncoding` (lines 496-535).
- **RAT event (optimistic):** `{op:RAT, jK:<job>, oK:<org>, aK:<attempt>, d:uint8, tr:uint16, cap, ref, n?}`; accepted only if job + attempt exist and no prior ratification; econ check per ratifier; stored under `rat/<job>/<ratifier>/<org>/<attempt>` with `viewRatEncoding` (537-611).
- **Strict state (authoritative):** `OP.STATE` writes `{v:uint64, econ:{mode:uint8, attemptBurn:uint64, ratBurn:uint64}}` to `state/<hash("state/v${v}/config/strict")>`; write-once per version (613-645, 650-673).
- **addWriter (authoritative):** `OP.ADD` processed only in non-optimistic branch → `host.addWriter(key)` (613-618).
- **apply invariants:** deterministic, no base appends inside apply, no env/time/random/network (479-483).

## View Layout Summary
- Root hashes (constants): `job/` (`JOB_KEY`), `pub/` (`PUB_KEY`), `rat/` (`RAT_KEY`), `state/` (`STATE_KEY`), econ totals `econ/v1/burn/total/` and `econ/v1/lock/total/` (STATE + econ effect projections) (lines 26-38, 442-475).
- Stored records:
  - `job/<jobKey>` → `{in, cap}` (`jobEncoding`).
  - `pub/<jobKey>/<orgKey>/<attemptToken>` → `{oK, cap, ref, meta?}` (`viewPubEncoding`).
  - `rat/<jobKey>/<ratifierKey>/<orgKey>/<attemptToken>` → `{d, tr, cap, ref, n?}` (`viewRatEncoding`).
  - `state/<strictConfigKey(v)>` → `{v, econ}` (`stateEncoding`).
  - `econ/v1/burn/total/<actorKey>` (uint64), `econ/v1/lock/total/<actorKey>` (reserved) (469-475).
- Tier field: uses `tr` (uint16). Apply/encode prefer `tr`; no dual-field handling here (537-611, 384-418).

## Drift Hazards + Guardrails
- **Implicit authority via `addWriter`:** Anyone with a writable namespace can call `addWriter`; apply will honor `OP.ADD` without additional policy (613-618, 682-687). Guard: keep proposer namespaces non-writable; treat `addWriter` as operator-only.
- **ackWriter auto-admission:** Optimistic PUB/RAT call `host.ackWriter(from.key)` after validation, effectively admitting proposers post-acceptance; no revocation or allowlist. Guard: design acceptance criteria carefully; isolate corestores per role to avoid key bleed.
- **`base.key` vs `from.key` confusion:** No explicit checks; authority not derived from `base.key`. Guard: document that authority = writer admission + writable local core; do not rely on base key equality.
- **Shared corestores:** ensure per-role namespaces; cross-role sharing could let a process be writable unintentionally.
- **Discovery replication posture:** `ensureDiscoverySurface` can now auto-wire replication when a swarm is supplied; callers without a swarm still need to wire replication explicitly.

## What organism/ratifier must call (warm, propose, observe)
- **Warm a concern:** `ensureConcernSurface(corestore.namespace("org-"+k), swarm, {key})`; wait `ready()`, ensure replication via provided `swarm`; read strict state with `getStrictState(view, v)` or `getStrictStateFromView` pattern used in apply; establish view readers (`getJobView`, `getPublishViewByJob` or `createReadStream` on `pub/` and `rat/` subtrees).
- **Propose work:** `publishJobWork(concern, jobKey, cap, ref{t,k,p?,h?,a}, meta?)` (optimistic).
- **Propose ratification:** `publishJobRatification(concern, jobKey, orgKey, attemptToken, determination, tier, cap, ref, note?)` (optimistic).
- **Observe acceptance:** watch `pub/<job>/<org>/` and `rat/<job>/<ratifier>/<org>/` via Hyperbee read streams; acceptance occurs when entries appear (after apply/ack).

## Capability + Identity Semantics (Summary)
- Optimistic proposers need only the bootstrap key and network replication; they do not need writer admission.
- Authority operations require `concern.writable` and are limited to job creation, writer admission, and strict-state genesis helpers.

## Questions / Ambiguities
- Discovery replication convenience now exists when a swarm is supplied; the remaining choice is whether a caller wants that convenience path or explicit external replication.
- No explicit cursor persistence for discovery scans; intended pattern is caller-local cursors—should a shared helper exist?
- Writer revocation is not addressed; `host.addWriter` admits but no removal path is present (lines 85-99, 613-618).
