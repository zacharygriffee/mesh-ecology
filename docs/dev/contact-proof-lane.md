# Contact Proof Lane

This document defines the first mesh-layer direct contact proof lane. The narrow
lane is implemented by `test/labs/lab-contact-proof.direct-peer.test.js` with
the reusable helper in `test/_helpers/direct-contact-proof.js`.

## Goal

Add one narrow contact proof lane that proves a participant can contact another
participant through a decentralized-shaped seam without using HTTP as the proof
surface.

The first useful proof is direct participant contact. It should not try to prove
all mesh semantics, actor economics, production health, or universal readiness.

## Implemented First Lane

Use Protomux RPC over a HyperDHT direct-peer seam.

Why this first:

- HyperDHT direct peer contact matches the device-accessibility goal better than
  LAN HTTP, SSH, or public inbound ports.
- Protomux RPC gives a bounded method surface instead of a generic service URL.
- The lane can be smaller and less discovery-flaky than a full Hyperswarm topic
  lab.
- It creates a clear contact seam that Edge and Platform can reference before
  they need a full mesh discovery flow.

The current lab uses an isolated local HyperDHT bootstrapper so the test proves
direct peer contact through a HyperDHT-shaped seam without depending on public
DHT health, public discovery, HTTP, SSH, or inbound port configuration.

## Evidence Shape

```json
{
  "artifactKind": "mesh_contact_proof_evidence",
  "schema": "mesh-v0-2/contact-proof/direct-peer/v1",
  "proofKind": "mesh_contact_direct_peer_lab",
  "transportKind": "protomux-rpc",
  "contactSeam": "hyperdht_direct_peer",
  "participantA": "mesh-contact-host",
  "participantB": "mesh-contact-client",
  "operation": "capability.echo",
  "selectedTransport": {
    "transportKind": "protomux-rpc",
    "contactSeam": "hyperdht_direct_peer",
    "transportRole": "proof_lane",
    "scope": "isolated_local_hyperdht",
    "scaffoldTransport": false,
    "compatibilityAlias": false,
    "productionPreferred": false
  },
  "readinessEvidence": {
    "readinessScope": "direct_peer_contact",
    "distributedReadinessClaimed": false
  },
  "contactAttempted": true,
  "contactSucceeded": true,
  "distributedReadinessClaimed": false
}
```

## Minimal Scenario

1. Start a local HyperDHT bootstrapper.
2. Start a host participant with a HyperDHT key pair.
2. Expose one Protomux RPC method with a fixed bounded request and response.
3. Start a client participant with the host public key.
4. Client opens direct contact and calls the method.
5. Record contact evidence:
   - selected transport kind;
   - contact seam;
   - host public key;
   - method name;
   - request id;
   - response id;
   - elapsed time;
   - failure class when contact fails.
6. Close all DHT/RPC/bootstrap resources deterministically.

The method is intentionally small: `capability.echo`. It does not create jobs,
publish PUBs, emit RATs, install
anything, or mutate long-lived state.

## What This Lane Proves

- A mesh participant can be contacted through a direct peer seam.
- The contact can carry a bounded RPC exchange.
- The test harness can classify contact success/failure without falling back to
  HTTP.
- Direct peer evidence can be recorded in a shape Edge and causal-substrate can
  consume later.

## What This Lane Does Not Prove

- full concern/discovery participation;
- organism work selection;
- ratifier settlement;
- production readiness;
- universal distributed readiness;
- NAT traversal in every environment;
- public discovery health;
- Platform activation or deployment correctness;
- Edge authority to execute work.

## Relationship To Existing Lanes

| Lane | Keep using it for | Do not use it for |
| --- | --- | --- |
| `fakeswarm` | deterministic protocol semantics | decentralized contact |
| Hyperswarm two-transport | topic/discovery transport evidence | first-line semantic debugging |
| HTTP/operator probes | presentation and compatibility | mesh contact proof |
| Protomux RPC over HyperDHT | direct participant contact proof | full mesh semantic proof |

## Implementation Boundary

The first implementation packet added:

- a small test helper under `test/_helpers/` for direct-peer contact resources;
- one test under `test/labs/` with explicit proof scope;
- deterministic cleanup for DHT/RPC resources;
- failure classification for contact timeout, host listen failure, RPC contact
  failure, and semantic response mismatch;
- documentation updates to this file and the proof-scope matrix.

It does not add:

- HTTP fallback inside the proof lane;
- scheduler, watcher, daemon, deployment, or activation behavior;
- Edge-owned Platform setup semantics;
- broad lab rewrites;
- replacement of the existing two-transport harness.

## Run It

```bash
npm test -- test/labs/lab-contact-proof.direct-peer.test.js
```

## Success Criteria

The proof lane is successful when:

- a local test performs a Protomux RPC exchange over HyperDHT direct peer;
- the receipt/evidence names `transportKind: "protomux-rpc"` and
  `contactSeam: "hyperdht_direct_peer"`;
- failure output distinguishes contact failure from semantic failure;
- docs state that success is environment-scoped contact evidence, not
  distributed readiness.
