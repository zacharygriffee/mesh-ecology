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

For bounded Edge control-panel responder caps, Mesh owns the responder behavior. Edge should submit a job and then invoke this Mesh command rather than writing a response itself:

```bash
node packages/mesh-operator-cli/bin/mesh.js responder run \
  --concern <returned-concern-key> \
  --config <returned-config-path> \
  --cap <supported-cap> \
  --once \
  --json
```

Authority limits:

- supported caps are `cap/edge/control-panel/hello-status`, `cap/edge/control-panel/selector-intent`, and `cap/edge/control-panel/yard-lights/set-state`
- opens and observes the concern through Mesh concern/job views
- emits one Mesh-owned response as concern PUB evidence
- does not mutate Edge files or assume Edge store paths
- does not add scheduler/daemon behavior; `--once` exits after one handle or no-match
- does not publish outside existing concern API/replication behavior
- selector-intent jobs invite plural responses; they do not select actors or assign actor obligation
- yard-lights set-state jobs record admitted/rejected request evidence only; they do not claim physical device truth, job completion, project completion, Edge authority, or Mesh truth

Hello-status:

```bash
node packages/mesh-operator-cli/bin/mesh.js responder run \
  --concern <returned-concern-key> \
  --config <returned-config-path> \
  --cap cap/edge/control-panel/hello-status \
  --once \
  --json
```

Success prints JSON with `state:"handled"`, exit `0`, `handled:1`, `skipped:<n>`, `concernKey`, `jobKey`, `cap`, `responseKey`, `receiptKey`, `responderId`, `statusBefore`, `statusAfter`, and:

```json
{
  "ok": true,
  "cap": "cap/edge/control-panel/hello-status",
  "message": "hello from mesh responder",
  "handledBy": "mesh-v0-2.generic-responder"
}
```

Selector-intent:

```bash
node packages/mesh-operator-cli/bin/mesh.js responder run \
  --concern <returned-concern-key> \
  --config <returned-config-path> \
  --cap cap/edge/control-panel/selector-intent \
  --once \
  --json
```

The job input must use `requestKind:"mesh_concern_selector_intent"`, `actorGroup`, `selectorKind`, optional `desiredState`, and `expectedResultMode:"plural_responses"`. Success adds `actorGroup`, `selectorKind`, `expectedResultMode:"plural_responses"`, `responseMode:"plural_selector_response"`, a bounded `responses` array, and a `posture.nonClaims` list. Current fixture-like Mesh evidence includes `yard-light-alpha` and `yard-light-beta` as observed/eligible responses.

Selector-intent output is response evidence only. It does not claim truth, completion, production proof, actor obligation, or canonical selection.

Yard-lights set-state:

```bash
node packages/mesh-operator-cli/bin/mesh.js responder run \
  --concern <returned-concern-key> \
  --config <returned-config-path> \
  --cap cap/edge/control-panel/yard-lights/set-state \
  --once \
  --json
```

The job input must be bounded Mesh-owned control request evidence:

```json
{
  "cap": "cap/edge/control-panel/yard-lights/set-state",
  "in": {
    "actorGroup": "yard_lights",
    "selectorKind": "all_in_actor_group",
    "requestedState": "on",
    "sourceRatificationRef": "ratification/<ref>",
    "operatorRef": "operator/<ref>",
    "requestId": "request/<id>"
  }
}
```

Allowed `selectorKind` values are `"all_in_actor_group"` and `"explicit_actor_ids"`. For `"explicit_actor_ids"`, include a non-empty `actorIds` string array. Allowed `requestedState` values are `"on"` and `"off"`. Unknown payload fields, arbitrary command strings, shell strings, and device/network side-effect instructions are rejected by Mesh local cap policy.

Admitted response evidence:

```json
{
  "ok": true,
  "cap": "cap/edge/control-panel/yard-lights/set-state",
  "requestId": "request/<id>",
  "actorGroup": "yard_lights",
  "selectorKind": "all_in_actor_group",
  "requestedState": "on",
  "sourceRatificationRef": "ratification/<ref>",
  "operatorRef": "operator/<ref>",
  "admissionState": "admitted",
  "responseMode": "ratified_control_request_evidence",
  "physicalDeviceTruthClaimed": false,
  "jobCompletionClaimed": false,
  "projectCompletionClaimed": false,
  "edgeAuthorityClaimed": false,
  "meshTruthClaimed": false,
  "deviceMutationAttempted": false,
  "networkSideEffectAttempted": false,
  "shellCommandExecuted": false
}
```

Rejected response evidence:

```json
{
  "ok": false,
  "cap": "cap/edge/control-panel/yard-lights/set-state",
  "requestId": "request/<id>",
  "admissionState": "rejected",
  "responseMode": "ratified_control_request_evidence",
  "reasonCodes": ["missing_source_ratification_ref"],
  "physicalDeviceTruthClaimed": false,
  "jobCompletionClaimed": false,
  "projectCompletionClaimed": false,
  "edgeAuthorityClaimed": false,
  "meshTruthClaimed": false,
  "deviceMutationAttempted": false,
  "networkSideEffectAttempted": false,
  "shellCommandExecuted": false
}
```

The responder does not perform physical device mutation in this version unless a future Mesh-owned path explicitly adds it.

No pending matching job prints JSON with `ok:false`, `state:"no_match"`, `handled:0`, and `skipped:<n>`, then exits nonzero. Treat malformed JSON, fatal stderr, or any other nonzero state as failure.

After a handled response, `status --concern <key> --config <operator-cli.json>` shows evidence in `counts.publish` and under `responders["mesh-v0-2.generic-responder"]`, including `handled`, numeric `byCap`, detailed `byCapCounts`, `latest`, and `latestByCap`. For selector-intent, `latest` includes selector fields, `responseMode`, response count, and non-claim posture. For yard-lights set-state, `latestByCap["cap/edge/control-panel/yard-lights/set-state"]` includes the latest admitted/rejected response evidence and reason codes when rejected.

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
