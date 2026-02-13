# Economy Walkthrough (developer-facing)

## Strict econ state (OP.STATE)
- Encoding: `stateEncoding` wraps `{ v:uint64, econ:{ mode:uint8, attemptBurn:uint64, ratBurn:uint64 } }`.
- Normalization: `normalizeStrictConfigV1` enforces uint64 bounds and mode ∈ {0,1,2}, returning `{ v, econ }` with bigint burns.
- Write-once per version: OP.STATE is stored at `strictConfigKey(v) = hash("state/v${v}/config/strict")`; apply skips writes if a version already exists.

## validateEconomic(ctx)
- Modes:
  - OFF (0): always ok, `effects=[]`.
  - BURN (1): gates on budget (initial - burned); may emit `[{ type:'burn', kind, actorKey, jobKey, attemptToken, amount }]`.
  - LOCK (2): currently unsupported → ERR_ECON_UNSUPPORTED_MODE.
- Errors: `ERR_ECON_CONFIG_INVALID`, `ERR_ECON_PROVIDER_MISSING`, `ERR_ECON_UNSUPPORTED_MODE`, `ERR_BUDGET_INSUFFICIENT`.

## Concern apply integration (optimistic PUB/RAT)
Ordering (PUB branch excerpt):
```
// structural + state checks already passed
const econResult = await validateEconomic(...);
if (!econResult.ok) continue;
await host.ackWriter(from.key);
await view.sub(PUB_KEY)...put(attemptToken, {...});
if (econResult.effects?.length) await applyEconomicEffects(view, econResult.effects);
```
RAT branch uses the same ordering: validate → ackWriter → write RAT view record → apply econ effects.
Rationale: econ totals only change after the acceptance record exists, keeping replay deterministic.

## Derived econ keyspace
- `econ/v1/burn/total/<actorKey>`: accumulated burns (uint64), default 0.
- `econ/v1/lock/total/<actorKey>`: reserved for lock accounting, default 0.
- Totals are projected inside apply via `applyEconomicEffects`, which reads the current total and writes back `total + amount` for burn effects. No base events are appended.

## Invariants
- apply is deterministic and replay-safe; no env/time/random or host-local gating.
- Strict state is written once per `v`; later writes with the same `v` are ignored.
- validateEconomic runs before `ackWriter`; econ effects are applied only after the acceptance record is stored.
- No base-log mutations are emitted as econ side effects; all econ projections are view-only.
