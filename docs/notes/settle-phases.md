Settle Phases (Notes-Only)

Scope and stance
- NON-BINDING description for operators; does not create protocol guarantees or readiness APIs.
- Based on existing settle-signal research, event inventory, and v0-locked constraints; observations only.

What “settled” does NOT mean here
- No global clock or quorum-free readiness: peers discover asynchronously via Hyperswarm; `connection` only means a socket is up (source: settle-signals-research Hyperswarm section).
- No guarantee of completeness: peers may join/leave; Hypercore `peer-add`/`peer-remove` signals only channel changes (source: settle-events-inventory Hypercore).
- Autobase coordination events (`update`) are not content proof; ordering is eventual and may reorder (sources: settle-signals-research Autobase events + Autobase README notes in research).
- View presence does not imply global convergence; replication is best-effort and topic/discovery scoped.

Phase ladder (signals are heuristics; absence is acceptable)

1) Transport phase
- Signals: Hyperswarm `swarm.on("connection")`; Hypercore `peer-add` / `peer-remove` (source: settle-events-inventory Hyperswarm, Hypercore).
- Can infer: a Noise-secured channel exists and a core replication channel opened.
- Cannot infer: that the remote has relevant cores, that data moved, or that views match.
- Typical absence/failure: no peers advertising the topic; duplicate-connection rejection.
- Operator posture: retry joins/flush, re-run REPL helpers; treat connects as opportunities, not proof.

2) Replication activity phase
- Signals: Hypercore `download` events; changes in `remote-contiguous-length` (heuristic) (source: settle-events-inventory Hypercore).
- Can infer: blocks are being received; some contiguous range is now present locally.
- Cannot infer: that all writers or all heads are synced; sparse ranges may still be missing.
- Typical absence/failure: remote throttling or no announced data; peers connected but idle.
- Operator posture: keep replication running; if idle, retry swarm flush or re-advertise; do not gate on single download.

3) Visibility phase
- Signals: Hypercore `append` on the core backing the view (e.g., `bee.core`) (source: settle-events-inventory Hyperbee/Hypercore).
- Can infer: local storage length advanced; a new block was appended to the view core.
- Cannot infer: semantic validity of the record; whether indexing of other peers is complete.
- Typical absence/failure: replication still in transit; append blocked by backpressure.
- Operator posture: poll length/streams, allow time for next append; rerun REPL queries.

4) Interpretation phase
- Signals: Hyperbee watcher `update`, range iteration seeing new job/pub/rat records (source: settle-events-inventory Hyperbee).
- Can infer: application-level records are now observable in the view queried.
- Cannot infer: that all related records are present (other peers may lag) or that downstream roles have seen them.
- Typical absence/failure: replication not yet delivered relevant subtrees; watcher range too narrow.
- Operator posture: widen queries, retry iteration, or wait/re-run watchers; treat as soft evidence only.

Autobase warning
- Autobase `update`/`append` activity reflects linearizer/apply coordination, not content arrival certainty (source: settle-signals-research Autobase events).
- Events are noisy (multiple per batch, reorderings possible) and must not be treated as settle/readiness signals.
- Use Autobase signals only to know “an apply cycle ran,” not that data is complete or final.

Retry-first posture
- All phases are retry-safe; absence of signals is expected under churn and does not imply fault.
- REPL-driven probes and manual retries align with the system’s advertising-only discovery and best-effort replication model (sources: v0-locked discovery constraint; settle-signals research on flush/propagation).
- No hidden scheduler: operators should re-run helpers (join/flush/debugNextDiscovery) rather than wait for implicit gates.

Non-goals
- Does not define or endorse a `waitUntilSettled()` primitive.
- Does not add sleep-based gates or automatic orchestration.
- Does not override v0-locked invariants or introduce new semantics.

Why Phases, Not Gates
- Each phase exposes partial evidence only; signals may arrive out of order or not at all.
- Treat phases as a ladder of increasing confidence, not as binary readiness checks.
- This preserves agent confinement: operators observe and retry instead of assuming completion.
