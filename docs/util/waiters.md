Waiters & Retry Helpers (phases, not gates)

Scope
- Helpers observe phase signals only; they do not guarantee “settled” or “ready”.
- No protocol semantics are changed; use with bring-up flows only.
- These helpers are for local debugging and operator evidence collection, not for defining actor truth.

Helpers
- retry(fn, opts): bounded exponential backoff with jitter; returns structured evidence; opts require attempts, timeoutMs, baseDelayMs, maxDelayMs, jitter, label.
- waitForSwarmConnections(swarm, { min, timeoutMs }): resolves when swarm.connections.size >= min via 'connection' events; precondition signal only.
- flushDiscovery({ swarm, discovery, timeoutMs }): awaits discovery.flushed() if available, then swarm.flush(); does not imply peers exist.
- waitForCorePeers(core, { min, timeoutMs }): uses hypercore 'peer-add'/'peer-remove'; fails fast if core.peers is unavailable.
- waitForCoreAppend(core, { timeoutMs }): resolves on next 'append'; heuristic for visibility. Edge-triggered: arm before triggering the append you intend to observe.
- waitForCoreAppendWithData(core, { timeoutMs, predicate }): resolves on the first append whose data passes the predicate (default: data is truthy and not null/false); useful to ignore null/keepalive appends. Signal only, not semantic correctness.
- waitForBeeNonEmpty(bee, { timeoutMs, pollMs }): polls bee.core.length > 0; heuristic only.
- waitForBeeKey(bee, key, { timeoutMs, pollMs }): polls bee.get(key) until non-null; interpretation-level.

Bring-up runner (dev helper)
- Library: src/util/bringup/runner.js (runFourBringup) orchestrates discovery→concern→organism→ratifier using waiters + retry; collects evidence per phase.
- Phases, not gates: uses flush → transport → advertise → visibility checks; all bounded with retries and timeouts.
- No “settled” promise: runner reports best-effort success/failure with evidence; operators should still probe/verify.
  Verify through joined surfaces and derived-view checks rather than cross-runtime store inspection.
- Tests: npm test (includes bringup-runner unit/integration).

Composition patterns (bring-up)
- Discovery: flushDiscovery → waitForSwarmConnections.
- Concern: after advertising, waitForCorePeers on concern base, then waitForCoreAppend.
- Organism: waitForCorePeers on concern base namespace; then interpretation via waitForBeeKey/job view queries.
- Ratifier: same as organism; use waitForBeeKey on rat view when jobs expected.

Warnings
- Phases not gates: signals indicate progress opportunities, not completion.
- No global settled: absence of a signal is expected under churn; retry is safe.
- Autobase events are coordination, not content proof; rely on view-level checks instead.
- Edge-triggered reminder: event-based waiters (e.g., waitForCoreAppend) must be armed before triggering the event; otherwise the signal may be missed. waitForCorePeers should be paired with an immediate state check when composing flows.
- Meaningful-data reminder: waitForCoreAppendWithData filters per predicate; it only asserts “predicate was true for appended block,” not that the block is semantically correct. Use to filter keepalive/null acks.

Examples
- await retry(() => doThing(), { attempts:5, timeoutMs:1000, baseDelayMs:200, maxDelayMs:2000, jitter:0.2, label:\"connect\" });
- await waitForSwarmConnections(swarm, { min:1, timeoutMs:5000 });
- await waitForCoreAppend(core, { timeoutMs:5000 });
- await waitForBeeKey(bee, jobKey, { timeoutMs:8000, pollMs:250 });
