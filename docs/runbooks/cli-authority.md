# CLI Authority Runbook

This runbook covers stateless authority CLI writes with a durability barrier:
append, wait for replication, exit.

Compatibility note:
- This path remains supported for narrow stateless authority operations.
- Preferred control-plane workflows now live in `mesh-ecology-packs` via `live:ctl`.
- Use this runbook when you intentionally want direct CLI authority writes, not as the default operator UX.

## Local Concern Setup

For local/operator services that need a persistent named concern without owning Mesh internals:

```bash
node packages/mesh-operator-cli/bin/mesh.js concern setup \
  --purpose <purpose> \
  --root <path> \
  --json
```

The command creates or opens a purpose-scoped store under `--root`, opens the concern and local discovery surfaces through Mesh code paths, and returns JSON with:

- `purpose`
- `concernKey`
- `discoveryKey`
- `concernStore`, `discoveryStore`, and `operatorStore` refs
- `configPath` / `configRefs`
- local writer posture and writer keys
- status-shaped counts
- next commands for `job submit` and `status`

The command is idempotent for the same `--purpose` and `--root`: it reopens the same purpose-scoped store and returns the same concern/discovery keys. The output does not claim canonical truth, actor response, job completion, or production readiness.

For a local single-store submit, use the returned `CORESTORE_DIR` and `--no-wait` unless a remote peer is expected:

```bash
CORESTORE_DIR=<returned-operator-store> \
node packages/mesh-operator-cli/bin/mesh.js job submit \
  --concern <returned-concern-key> \
  --json <job.json> \
  --no-wait

CORESTORE_DIR=<returned-operator-store> \
node packages/mesh-operator-cli/bin/mesh.js status --concern <returned-concern-key>
```

## Mesh Generic Responder

For the generic Mesh-owned responder cap, Mesh owns the responder envelope behavior. Adjacent repos should submit a job and then invoke this Mesh command rather than writing a response themselves:

```bash
node packages/mesh-operator-cli/bin/mesh.js responder run \
  --concern <returned-concern-key> \
  --config <returned-config-path> \
  --cap <supported-cap> \
  --once \
  --json
```

Authority limits:

- supported generic concern-local responder cap is `cap/concern/call-for-responses/v1`; it is not app-specific, not a global capability registry, and not discovery/search/scheduling
- opens and observes the concern through Mesh concern/job views
- emits one Mesh-owned response as concern PUB evidence
- does not mutate adjacent repo files or assume adjacent repo store paths
- does not add scheduler/daemon behavior; `--once` exits after one handle or no-match
- does not publish outside existing concern API/replication behavior
- call-for-responses jobs invite plural response evidence inside one chosen concern; they do not select actors, assign obligation, claim completion, claim device truth, claim Mesh truth, or claim adjacent-repo truth

Call for responses:

```bash
node packages/mesh-operator-cli/bin/mesh.js responder run \
  --concern <returned-concern-key> \
  --config <returned-config-path> \
  --cap cap/concern/call-for-responses/v1 \
  --once \
  --json
```

The job input must use `requestKind:"mesh_concern_call_for_responses"`, a non-empty `profile`, `needRef`, `producer.repo`, `producer.surface`, `responseMode:"plural_response_evidence"`, subject fields, and the required non-claim list. Payloads that imply actor selection, actor obligation, completion, device truth, Mesh truth, adjacent-repo truth, shell execution, scheduling, discovery search, or a global capability registry are rejected as response evidence.

Success prints JSON with `state:"handled"`, exit `0`, `handled:1`, `skipped:<n>`, `concernKey`, `jobKey`, `cap`, `responseKey`, `receiptKey`, `responderId`, `statusBefore`, `statusAfter`, and generic plural response evidence.

No pending matching job prints JSON with `ok:false`, `state:"no_match"`, `handled:0`, and `skipped:<n>`, then exits nonzero. Treat malformed JSON, fatal stderr, or any other nonzero state as failure.

After a handled response, `status --concern <key> --config <operator-cli.json>` shows evidence in `counts.publish` and under `responders["mesh-v0-2.generic-responder"]`, including `handled`, numeric `byCap`, detailed `byCapCounts`, `latest`, and `latestByCap`.

## Prereqs

- Repo checkout with dependencies installed.
- At least one shared swarm topic (`z32`).
- Discovery host and concern host/peer online for replication.

## 1) Init Discovery (authoritative host)

Start discovery host once to create or reopen the discovery base:

```bash
CORESTORE_DIR=/var/lib/mesh/discovery \
SWARM_TOPICS=<topic-z32> \
node packages/hetzner-discovery-host/bin/discovery-host.js
```

Capture the printed `DISCOVERY_KEY` (`z32`).

## 2) Run Hetzner Host

Preferred production mode is systemd:

```bash
sudo bash deploy/install.sh
sudo systemctl restart mesh-discovery-host
sudo journalctl -u mesh-discovery-host -n 100 --no-pager
```

## 3) Add Writer (laptop/operator key admission)

Use the operator CLI against the discovery key:

```bash
CORESTORE_DIR=./store/operator \
SWARM_TOPICS=<topic-z32> \
node packages/mesh-operator-cli/bin/mesh.js discovery add-writer \
  --discovery <discovery-z32> \
  --writer <laptop-writer-z32> \
  --wait \
  --min-peers 1 \
  --timeout-ms 45000
```

## 4) Advertise Concern

```bash
CORESTORE_DIR=./store/operator \
SWARM_TOPICS=<topic-z32> \
node packages/mesh-operator-cli/bin/mesh.js discovery advertise-concern \
  --discovery <discovery-z32> \
  --concern <concern-z32> \
  --label "laptop-concern" \
  --wait \
  --min-peers 1 \
  --timeout-ms 45000
```

## 5) Advertise Discovery

```bash
CORESTORE_DIR=./store/operator \
SWARM_TOPICS=<topic-z32> \
node packages/mesh-operator-cli/bin/mesh.js discovery advertise-discovery \
  --discovery <parent-discovery-z32> \
  --nested <child-discovery-z32> \
  --label "child-discovery" \
  --wait \
  --min-peers 1 \
  --timeout-ms 45000
```

## 6) Submit Job

```bash
cat > /tmp/job.json <<'JSON'
{
  "cap": "cap/operator/manual",
  "in": {
    "task": "demo",
    "payload": {"n": 1}
  }
}
JSON

CORESTORE_DIR=./store/operator \
SWARM_TOPICS=<topic-z32> \
node packages/mesh-operator-cli/bin/mesh.js job submit \
  --concern <concern-z32> \
  --json /tmp/job.json \
  --wait \
  --min-peers 1 \
  --timeout-ms 45000
```

## Durability Behavior

Write commands default to waiting for durability.

- `durability: met` means at least one remote peer reported `remoteLength >= targetLength`.
- `durability: timeout` means timeout before that threshold; process exits nonzero.
- `--no-wait` skips the barrier (`durability: skipped`).

Use `--min-peers` to require a minimum connected peer count before barrier completion unless a peer already reaches target length.
