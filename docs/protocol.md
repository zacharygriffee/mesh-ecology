Protocol Snapshot (current implementation)

Discovery surface
- Storage: Autobase-backed append-only scan log (compact-encoded). Readers consume by sequence index; there is no Hyperbee view, put, or del.
- Payload per entry: `t` (uint8 kind enum: discovery/concern), `k32` (fixed32 buffer key), `v` (optional bounded utf8 label). Internally keys remain 32-byte buffers; z32 strings are only for UX/logging.
- Operations: addConcern/addDiscovery append a new advertisement; re-advertising appends again (dedupe is consumer policy). addWriter still appends writer admissions for Autobase, handled in apply() via host.addWriter.
- Writer admission is operator/indexer plumbing, not the routine organism onboarding path; normal proposal intake uses optimistic submit plus concern.apply validation and host.ackWriter.
- Contract: Discovery only advertises pointers; it MUST NOT schedule work or invoke projectors.

Concern surface
- Autobase with optimistic intake; derived Hyperbee view persists:
  - job/<jobKey> -> { in, cap, tomb }
  - pub/<jobKey>/<organismKey>/<attemptToken> -> { oK, cap, ref, meta }
  - rat/<jobKey>/<ratifierKey>/<organismKey>/<attemptToken> -> { d, tr, cap, ref, n }
- Tier field: `tr` (uint16) is canonical. Legacy data may contain `t`; indexers should prefer `tr` when both appear.
- Optimistic admission: host.ackWriter is called only inside concern.apply() after validating job presence, attempt uniqueness, and ref alignment. Failed validations are skipped without ack.
- Concern base namespacing in runtime uses `concern-<concernKeyHex>` (see `src/agent/warmset.js`).
- Role-specific namespaces are used for role-local state/discovery bookkeeping (for example `${role}-state` and `${role}-disc-*` in `src/agent/runner.js`), not for concern base naming.

Proposal / Intake / Canonical Truth
- `PUB` and `RAT` are proposal inputs. Submission or append means a proposal was offered to the concern surface; it does not mean the proposal became canonical state.
- `Observed` / `intake` means the runtime saw proposal material on the Autobase/apply path. Intake is local substrate or apply evidence, not shared canonical concern truth.
- `Writer` vs `proposal` are different concepts:
  - optimistic proposers can submit `PUB` / `RAT` without prior writer admission
  - admitted writers may append through the non-optimistic path
  - both paths still depend on deterministic `concern.apply()` validation before canonical materialization
- This repo does not define a global canonical `pending` namespace for raw arrivals. Concerns may model their own accepted/pending state explicitly if they need it, but raw intake is not canonical by default.

Acceptance / Materialization
- `publishPub` / `publishRat` returning `{ accepted:false, ... }` means the call proposed/appended work; it is not by itself proof of failure.
- Acceptance proof is derived-view materialization:
  - PUB materialized: `pub/<jobKey>/<organismKey>/<attemptToken>` leaf exists.
  - RAT materialized: `rat/<jobKey>/<ratifierKey>/<organismKey>/<attemptToken>` leaf exists.
- Operationally, this appears as concern-view PUB/RAT counts increasing.
- Canonical concern truth is the derived view only. Successful append, observed intake, or local submission evidence are not canonical by themselves.
- Modes:
  - Optimistic-proof path materializes via optimistic apply (`optimistic=true` at apply time).
  - Trusted-writer path materializes for admitted writers via non-optimistic apply (`optimistic=false` at apply time).
  - Both paths materialize into the same derived PUB/RAT leaves.
- On open mesh transport, claims like `no open inbox` can only truthfully mean `no open canonical inbox`. They cannot mean absence of raw proposals reaching transport or apply.

Replication
- Bases replicate to all swarm connections via replicateBase. Observed propagation in dev is on the order of ~10–20 seconds, but this is empirical only—not a guarantee.
