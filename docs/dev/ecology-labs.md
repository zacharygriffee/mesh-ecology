# Ecology Labs (v0, econ=OFF)

These labs model ecology behavior under v0 constraints without economic enforcement. Acceptance is defined only by derived-view materialization (`pub/*`, `rat/*` leaves), while selection behavior is implemented at the edges (runner/projector policy), not in `concern.apply`.

## Invariants (Recap)

- Acceptance = derived-view leaf existence.
- `ackWriter` is called only inside `concern.apply`.
- No topic filtering.
- Discovery is advertising-only.
- Econ OFF (no burn/lock enforcement).
- Dual-transport execution: `fakeswarm` first (oracle), then `hyperswarm` (real network leg, strict in CI).

## Harness selection decision tree

1. Is this mostly runner logic (dedupe/state machine/projector contract) without transport behavior?
   - Use `unit-fast` runner tests under `test/runner/` or `test/ratifier/`.
2. Is this a semantic lab proof (acceptance gates, pass freshness, projector observation) where deterministic replication is enough?
   - Use single-transport `fakeswarm` lab.
3. Do you need parity evidence across fake+real networking or readiness/flake classification?
   - Use two-transport lab (`runLabTwoTransport`).
4. When NOT to use two-transport:
   - Do not start with two-transport for pass-freshness or acceptance semantics; it adds topology and transport noise with no extra semantic signal.

### Quick chooser (anti-churn)

- If the behavior does not require replication/transport, write a unit test.
- If proving semantic behavior (acceptance gates, projector observation, pass freshness), use single-transport `fakeswarm` first.
- Use two-transport labs only when you explicitly need transport-parity/readiness evidence.
- For pass-fresh checks, use `test/labs/lab-pass-fresh.view-update.test.js` as canonical and keep it in default lanes.
- Treat extra two-transport pass-fresh variants as optional investigation artifacts, not canonical defaults.

Hyperswarm-strict CI caveats:
- Real-network legs can fail due to environment constraints (`EPERM`, host networking policy, transient DHT/connectivity noise).
- Treat fake pass as semantic oracle first; use hyperswarm strict lanes as transport confidence, not first-line semantic debugging.
- For local semantic iteration, prefer fake-only (`LAB_REAL=0`) before escalating to strict real-network runs.

## Acceptance is derived-view materialization

- Append success is not acceptance (`append != accepted`).
- For labs, projector-observation assertions should be gated by derived view leaf existence (`pub/*`, `rat/*`) before expecting the next tick to observe it.
- Pattern:
  - publish proposal
  - flush/update until derived leaf exists
  - run next `tick()`
  - assert projector observation

## Warmth vs Freshness

- Warmth is allowed: keep Autobase handles open across ticks (`warmset` exists to reduce lag).
- Cached perception is forbidden by default: do not carry strictState objects, iterators, or view snapshots across ticks in runner logic or freshness-sensitive labs.
- In labs that assert freshness, obtain fresh view handles per probe (or recreate the getter at probe time) and bound iterator lifetimes.

## Minimal topology first

- Start with the fewest roles/swarms that can prove the claim.
- Add extra writers/roles only if the claim requires them.
- Example: `test/labs/lab-pass-fresh.view-update.test.js`
  - single-transport `fakeswarm`
  - one runner instance, two measured ticks
  - publish between ticks
  - gate on derived leaf acceptance
  - assert `ctx.pubs()` transitions `0 -> 1` without runner restart

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

## Debugging / Inspecting Work Journal

Use the work-journal inspector to see runner-local workflow persistence (`api.work`) without reading raw Hyperbee keys:

```bash
node scripts/inspect-work.js --store-root ./store/ecology --all
node scripts/inspect-work.js --store-root ./store/ecology --role org-B
```

`dueNow` means work items with `nextRunAtMs <= now`, which is how cooldown/backoff scheduling decides eligibility for the next tick.

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
