# Ecology Labs (v0, econ=OFF)

These labs model ecology behavior under v0 constraints without economic enforcement. Acceptance is defined only by derived-view materialization (`pub/*`, `rat/*` leaves), while selection behavior is implemented at the edges (runner/projector policy), not in `concern.apply`.

## Invariants (Recap)

- Acceptance = derived-view leaf existence.
- `ackWriter` is called only inside `concern.apply`.
- No topic filtering.
- Discovery is advertising-only.
- Econ OFF (no burn/lock enforcement).
- Dual-transport execution: `fakeswarm` first (oracle), then `hyperswarm` (real network leg, strict in CI).

## Lab Ladder Overview

### `lab-template.two-transport`
Proves:
- Optimistic PUB acceptance.
- Derived-view materialization invariant.

### `lab-negative.acceptance-gates.two-transport`
Proves:
- Invalid PUB is not accepted.
- Duplicate attempt does not create second leaf.
- Append success != acceptance.

### `lab-ratifier.restart-dedupe.two-transport`
Proves:
- RAT acceptance via derived view.
- Restart does not re-ratify.
- Dedupe is state-backed.

### `lab-ecology.pub-contest.addressing.two-transport`
Proves:
- Multiple organisms can have accepted PUBs for the same job.
- No global single-winner implied by protocol.
- Uniqueness is origin-scoped.

### `lab-ecology.multi-ratifier.observe-same-pub.two-transport`
Proves:
- Multiple ratifiers can independently ratify the same PUB.
- RAT namespace includes ratifier identity.

### `lab-ecology.ratifier-selectivity.projector.two-transport`
Proves:
- Policy divergence via projector logic.
- Econ OFF does not prevent selective settlement.
- Selection is edge behavior, not concern physics.

## How to Run

### Run full suite
```bash
npm test -- --runInBand
```

### Run single lab
```bash
npx brittle test/labs/<file>.test.js
```

### Run with strict CI posture
```bash
CI=1 npx brittle test/labs/<file>.test.js
```

### Disable hyperswarm locally (fake only)
```bash
LAB_REAL=0 npm test -- --runInBand
```

### Calibration mode
```bash
LAB_CALIBRATE=1 LAB_CALIBRATE_SAMPLES=5 npx brittle test/labs/<file>.test.js
```

### Budget/strict overrides
- `LAB_READY_MS`: readiness budget (default `45000`).
- `LAB_CONVERGE_MS`: assertion/convergence budget (default `45000`).
- `LAB_TIMEOUT_MS`: outer brittle timeout budget (default `120000`, higher in calibration mode).
- `LAB_REAL_STRICT`:
  - unset -> defaults to `CI` value.
  - `1/true/on` -> treat hyperswarm transport flakes as failures.
  - `0/false/off` -> allow `FLAKE_TRANSPORT` verdict in non-strict posture.

Readiness behavior in the harness:
- readiness gate requires thresholds plus a stabilization window (`stableMs`, default `400ms`).
- one readiness pulse is attempted at 60% of ready timeout.
- pulse triggers refresh/flush attempts but does not change semantic assertions.

## Transport Behavior

- Hyperswarm leg uses readiness gating before scenario assertions execute.
- Stabilization window must hold before readiness is marked successful.
- A one-time readiness pulse runs at 60% of ready budget if readiness has not stabilized yet.
- Connection error sinks are attached to hyperswarm connection streams in test helpers so transient `ECONNRESET` does not crash the process; transport errors are recorded as evidence and semantic failures are still surfaced normally.

## Philosophy

These labs demonstrate that protocol acceptance remains constant, while economic or policy behavior emerges from edge logic (runners/projectors). This separation is deliberate and preserved under v0-locked constraints.
