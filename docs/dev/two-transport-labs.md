## Two-Transport Lab Pattern

Use `runLabTwoTransport` from `test/_helpers/lab-two-transport.js` to run one scenario twice in the same test:

1. `fakeswarm` pass (deterministic oracle, must pass)
2. `hyperswarm` pass (best effort, may classify transport flake)

### Readiness Gate

`waitForReplicationReady` in `test/_helpers/lab-ready.js` records phased evidence and only checks transport readiness:

- join + flush (`discovery.flushed()` / `swarm.flush()`)
- swarm connection counts
- core peer counts for required bases/cores

It does not change protocol behavior and does not imply semantic convergence by itself.

### Flake Classification

`runLabTwoTransport` returns:

- `PASS`: fake + real both pass
- `FLAKE_TRANSPORT`: fake passes, real times out in readiness/convergence without semantic contradiction
- `FAIL_SEMANTICS`: fake fails or real has semantic failure

`FLAKE_TRANSPORT` is non-fatal by default and logs compact evidence.

### Strict Mode

Set `LAB_REAL_STRICT=1` to treat `FLAKE_TRANSPORT` as a hard failure (for CI strictness).
