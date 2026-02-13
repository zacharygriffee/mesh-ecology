# Economy Contract (Strict Config v1)

## Canonical strict econ config
- Source: OP.STATE projection into the concern view, decoded with `stateEncoding`.
- Retrieved via `strictConfigKey(v)`; current version `v=1`.
- Fields: `{ v, econ: { mode:uint8, attemptBurn:uint64, ratBurn:uint64 } }`.

## validateEconomic contract
- Inputs (ctx): `mode`, `attemptBurn`, `ratBurn`, `actorKey`, `jobKey`, `attemptToken?`, `kind ('attempt'|'rat')`, `econProvider`.
- Outputs: `{ ok:true, effects: [] | [ { type:'burn', kind, actorKey, jobKey, attemptToken, amount } ] }` or `{ ok:false, code, details? }`.
- Error codes: `ERR_ECON_CONFIG_INVALID`, `ERR_ECON_PROVIDER_MISSING`, `ERR_ECON_UNSUPPORTED_MODE`, `ERR_BUDGET_INSUFFICIENT`.

## Concern apply integration
- Order for PUB/RAT (optimistic branch):
  1. Structural + state checks (job exists, dup checks, ref match).
  2. Read strict state (mode/burns) from view.
  3. Call `validateEconomic` **before** `host.ackWriter`.
  4. If `ok:false` → reject (no ack, no writes).
  5. If `ok:true` → `ackWriter`, persist event, then apply econ effects (burn totals).
- No base-log appends are emitted from econ effects.

## Derived view keyspace (reserved)
- `econ/v1/burn/total/<actorKey>`: accumulated burn amount (uint64), default 0.
- `econ/v1/lock/total/<actorKey>`: accumulated locks (uint64), default 0 (placeholder).
- `econ/v1/budget/<actorKey>`: reserved; must be canonical when implemented.

## Mode semantics
- OFF (0): always `ok`, no gating, `effects=[]`.
- BURN (1): requires canonical budget source; `validateEconomic` gates on available budget; burns applied to `econ/v1/burn/total` after acceptance.
- LOCK (2): requires canonical lock ledger; eligibility depends on lock totals; placeholder until lock ledger exists.

## Invariants
- Gating uses strict state only; no asymmetric/local view shortcuts.
- Econ effects are deterministic view writes only; no additional base events.
- apply() remains deterministic and replayable; no timers/env/randomness.
