Discovery & Replication — Current Mental Model (snapshot)
========================================================

Scope
- Discovery surface and traversal state (current code).
- Replication wiring via replicateBase.
- Warm-window / bounded recheck liveness considerations.
- No protocol changes; matches v0 posture (advertising-only discovery).

Discovery surface model
- Surface: Autobase with a Hypercore view (no Hyperbee).
- Entry shape: `{ t, k32, v }` where `t` = kind (“concern”/“discovery”), `k32` = advertised z32 key, `v` = optional metadata.
- Ops: append-only plus writer admission; no tomb/delete.
- Stream: `createReadStream` yields the appended entry objects; options are Hypercore-style (`start/end/snapshot/wait/timeout/live`). Cursoring must be by sequence index, not key range.

Replication wiring (replicateBase.js)
- One connection handler per base+swarm (symbol-backed map); idempotent attach.
- All current connections are replicated immediately; future connections use the single handler.
- Cleanup on `base.close` detaches the handler; no listener pile-up.
- Remaining nondeterminism is only swarm connection order.

Warm-window / bounded rechecks (liveness)
- Not required for protocol correctness, but can be required for traversal liveness.
- Without a warm-window or bounded rechecks, a traversal that opens a cold concern once and closes it immediately may permanently miss work that arrives shortly after the first read.
- Warm-window and bounded rechecks are equivalent liveness strategies: warm-window amortizes latency across multiple concerns; bounded rechecks revisit cold surfaces within the same pass.
- When using a warm window, bound the window and close on eviction to drop handlers/FDs cleanly (replicateBase cleanup covers this).

Traversal state (current vs planned rewrite)
- Organism/ratifier still expect Bee-style `{ key, value }`; they must be updated to consume `{ t, k32, v }` from Hypercore streams in the upcoming warm-window rewrite.
- Discovery and concern cold-opens should both follow: open → `updateWithTimeout` → optional bounded `getWait` on first read to tolerate swarm latency.

Risks / status
- Replication listener accumulation: resolved by replicateBase guard.
- Discovery reader shape mismatch: still a risk until rewrite.
- Traversal liveness under cold-open latency: mitigated by warm-window or bounded rechecks; otherwise false negatives are possible.
- Nondeterminism: limited to network ordering; replicateBase does not amplify it.
- Concern invariants: optimistic validation preserved; single-genesis guard still unclear; propose/commit boundary still blurred in organism logic.
- Genesis/gas/bond semantics: explicitly out of scope for this snapshot.

Guardrails for the rewrite
- Discovery stays advertising-only; traversal order must not imply scheduling/priority.
- Use sequence-index cursors for discovery; dedupe by `k32` so re-advertise does not raise priority.
- Apply warm-window or bounded rechecks for liveness; bound opens and close on eviction to avoid FD leaks.
- Apply the same bounded `getWait`/tick budget to both discovery and concern cold-opens; do not assume immediate visibility.
