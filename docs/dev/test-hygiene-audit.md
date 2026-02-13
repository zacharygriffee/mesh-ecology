## Summary
- Test runner now invokes a per-file brittle runner (`test/run-files.js`) from `npm test`, which serializes test files into fresh processes and surfaces failures via exit code propagation. Single files remain runnable via `npx brittle <file> --runInBand`.
- Most fakeswarm usages now pass per-file `topics` Maps (including discovery replication tests after cleanup), reducing cross-test socket retention.
- Teardown paths are now explicit (close bases, stores, swarms, destroy sockets) without timeout races in runner-shell tests.
- Diagnostics: the leak-check test is gated by `LEAK_CHECK=1` and is report-only (no socket destruction) to avoid masking leaks.
- Warmup/skip logic is bounded when `maxTicks/maxMs/maxAttempts` are set (>0); tests that pass zero values still loop every tick until readiness, relying on retries rather than hard bounds.

## Findings
- **Test runner wiring**  
  - `package.json:7-11` switches `npm test` to `node test/run-files.js`, which enumerates `test/*.test.js`, spawns `npx brittle <file> --runInBand` per file, and exits on first failure.  
  - Single-file ergonomics remain via `npx brittle test/foo.test.js --runInBand` or invoking the file directly; the runner is not required for targeted runs.  
  - `test/run-files.js:1-21` sorts files lexically; note this order differs from the previous glob order and includes the diagnostic `z-leak-check.test.js`.

- **Fakeswarm topics isolation**  
  - Isolated (uses fresh `topics` Map):  
    - `test/agent-runner-shell.test.js:56-63`  
    - `test/agent-runner-runner-api.test.js:20-26`  
    - `test/agent-runner-capability-flip.test.js:20-26`  
    - `test/discovery-surface.replication.test.js:37-45,81-85`  
  - No remaining call sites rely on default topics.

- **Teardown patterns**  
  - Runner tests now await closes directly (runner → stores → swarms) without `Promise.race` timeouts (`agent-runner-shell.test.js:138-152,199-218,252-264`); socket destruction remains explicit in the close helper.  
  - Discovery replication tests close swarms/stores explicitly and now use isolated topics, reducing lingering handles (`test/discovery-surface.replication.test.js:35-60,79-112`).  
  - Agent state/concern/discovery closes remain explicit; no best-effort timeouts observed after cleanup.

- **Diagnostics / logging**  
  - `test/z-leak-check.test.js` is now skipped unless `LEAK_CHECK=1` and only reports handles (no destruction) (`test/z-leak-check.test.js:1-23`).  
  - Verbose `t.comment` breadcrumbs remain but are limited to a few runner tests; output volume is acceptable for now.  
  - No other persistent debug logging observed in src/.

- **Warmup / status semantics**  
  - Warm budget enforcement lives in `src/agent/warmset.js:29-78`; bounds only apply when `maxTicks>0` or `maxMs>0` or `maxAttempts>0`. Tests frequently pass zeros (e.g., `agent-runner-shell.test.js:118-121`, `agent-runner-runner-api.test.js:173-175`), which leaves warm attempts unbounded per tick (though still one attempt per tick).  
  - Status telemetry fields are scalars (status, attempts, cooldowns, isWritable/isCreator) and do not expose live handles or views (`src/agent/warmset.js:82-96`, `src/agent/runner.js:71-123`).

## Recommended cleanup (prioritized)
- **Applied (must)**  
  - Fakeswarm topics isolated across all tests, including discovery replication (`test/discovery-surface.replication.test.js`).  
  - Leak check gated by `LEAK_CHECK=1` and made report-only (`test/z-leak-check.test.js`).

- **Applied (should)**  
  - Runner-shell teardown now awaits closes explicitly (no timeout race wrappers).

- **Pending/Nice**  
  - Optionally gate verbose `t.comment` breadcrumbs behind an env flag to keep CI quieter.  
  - Consider documenting single-file test invocation alongside `test/run-files.js` runner usage.  
  - Warm budgets remain zero in some tests for behavior reasons; add bounds later if determinism is prioritized.
