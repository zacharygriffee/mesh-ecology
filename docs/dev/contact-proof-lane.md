# Contact Proof Lane Plan

This plan defines the next mesh-layer transport proof lane. It is a work packet,
not an implementation.

## Goal

Add one narrow contact proof lane that proves a participant can contact another
participant through a decentralized-shaped seam without using HTTP as the proof
surface.

The first useful proof is direct participant contact. It should not try to prove
all mesh semantics, actor economics, production health, or universal readiness.

## Preferred First Lane

Use Protomux RPC over a HyperDHT direct-peer seam.

Why this first:

- HyperDHT direct peer contact matches the device-accessibility goal better than
  LAN HTTP, SSH, or public inbound ports.
- Protomux RPC gives a bounded method surface instead of a generic service URL.
- The lane can be smaller and less discovery-flaky than a full Hyperswarm topic
  lab.
- It creates a clear contact seam that Edge and Platform can reference before
  they need a full mesh discovery flow.

## Candidate Lane Shape

```json
{
  "proofKind": "mesh_contact_direct_peer_lab",
  "transportKind": "protomux-rpc",
  "contactSeam": "hyperdht_direct_peer",
  "participantA": "mesh-contact-host",
  "participantB": "mesh-contact-client",
  "operation": "capability_echo_or_status",
  "contactAttempted": true,
  "contactSucceeded": true,
  "distributedReadinessClaimed": false
}
```

## Minimal Scenario

1. Start a host participant with a HyperDHT key pair.
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
6. Close all DHT/RPC resources deterministically.

The method should be intentionally small, such as `status.echo` or
`capability.echo`. It should not create jobs, publish PUBs, emit RATs, install
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

## Implementation Packet Boundary

The first implementation packet should add:

- a small test helper under `test/_helpers/` for direct-peer contact resources;
- one test under `test/utility/` or `test/labs/` with explicit proof scope;
- deterministic cleanup for DHT/RPC resources;
- flake classification only if the environment makes direct contact unstable;
- documentation updates to this file and the proof-scope matrix.

It must not add:

- HTTP fallback inside the proof lane;
- scheduler, watcher, daemon, deployment, or activation behavior;
- Edge-owned Platform setup semantics;
- broad lab rewrites;
- replacement of the existing two-transport harness.

## Success Criteria

The first proof lane is successful when:

- a local test performs a Protomux RPC exchange over HyperDHT direct peer;
- the receipt/evidence names `transportKind: "protomux-rpc"` and
  `contactSeam: "hyperdht_direct_peer"`;
- failure output distinguishes contact failure from semantic failure;
- docs state that success is environment-scoped contact evidence, not
  distributed readiness.
