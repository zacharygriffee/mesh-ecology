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

### Proof-Scope Matrix

| Lane | What it proves | What it does not prove |
| --- | --- | --- |
| Unit and runner tests | Deterministic local logic, state-machine behavior, and contract boundaries. | Transport confidence, mesh contact, or distributed readiness. |
| Single-transport `fakeswarm` labs | Protocol mechanics and derived-view semantics under deterministic local transport. | Decentralized contact, NAT traversal, public discovery, or production readiness. |
| Two-transport `fakeswarm` + non-strict `hyperswarm` labs | Deterministic semantic pass plus sampled real-transport evidence. | Distributed readiness when the real leg flakes or never stabilizes. |
| `LAB_REAL_STRICT=1` / strict CI Hyperswarm labs | Transport confidence for that scenario under the current environment. | Universal decentralized readiness, production health, or future topology stability. |
| `lab-contact-proof.direct-peer` | Bounded Protomux RPC exchange over a HyperDHT direct-peer seam. | Full mesh semantics, concern/discovery participation, NAT traversal guarantee, or distributed readiness. |
| HTTP/operator probes | Presentation, compatibility, and operator-surface behavior. | Mesh readiness, transport proof, or protocol acceptance. |

No single lane should be read as decentralized readiness. A decentralized-readiness claim needs an explicit real contact seam, such as Hyperswarm/HyperDHT/protomux-style transport evidence, plus scoped wording for the environment that produced it.

The direct participant contact lane is tracked in [Contact Proof Lane](./contact-proof-lane.md).

### Layered Transport Defaults

Use HyperDHT direct peer plus Protomux RPC as the preferred local-layer contact
proof when a participant key is known. Use Hyperswarm as the preferred
mesh-layer discovery lane when the claim is ecology participation, open
surface discovery, or plural observation.

Tests should not normalize one lane into the other. HyperDHT direct-peer labs
may prove bounded contact without public discovery. Hyperswarm labs must keep
discovery uncertainty visible through observation budgets, bounded absence, and
flake classification.

### Flake Classification

`runLabTwoTransport` returns:

- `PASS`: fake + real both pass
- `FLAKE_TRANSPORT`: fake passes, real times out in readiness/convergence without semantic contradiction
- `FAIL_SEMANTICS`: fake fails or real has semantic failure

`FLAKE_TRANSPORT` is non-fatal by default and logs compact evidence.

### Strict Mode

Set `LAB_REAL_STRICT=1` to treat `FLAKE_TRANSPORT` as a hard failure (for CI strictness).
