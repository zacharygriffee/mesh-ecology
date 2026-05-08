# Agent CLI Contract

This document defines machine-facing behavior for `packages/mesh-operator-cli/bin/mesh.js`.

## Scope

- No protocol/runtime semantic changes.
- Contract applies to CLI write commands used by operators and agents.

## Local Setup Command

- `concern setup --purpose <purpose> --root <path> --json`

This command creates or opens a purpose-scoped persistent store under `--root` and returns JSON only when `--json` is supplied. The JSON includes concern/discovery keys, store/config refs, local writer posture, status-shaped counts, and next commands for existing `job submit` and `status`.

Setup is idempotent for the same purpose/root when the store remains in place. Setup does not introduce scheduling behavior and does not claim canonical truth, actor response, job completion, or production readiness.

## Write Commands

- `discovery advertise-concern`
- `discovery add-writer`
- `job submit`

## Responder Command

- `responder run --concern <concern-z32> --config <operator-cli.json> --cap cap/edge/control-panel/hello-status --once --json`

This command is a bounded Mesh-owned responder loop. It opens the concern through Mesh concern APIs, reads the job view, skips jobs outside the requested cap, skips jobs already handled by `mesh-v0-2.generic-responder`, publishes one Mesh-owned response as concern PUB evidence, prints JSON, and exits. It is not a scheduler, daemon, Edge mutation command, or external network publication path beyond existing concern replication behavior.

Only this cap is supported:

- `cap/edge/control-panel/hello-status`

Successful output has this shape:

```json
{
  "ok": true,
  "action": "responder-run",
  "state": "handled",
  "concernKey": "<concern-z32>",
  "jobKey": "<job-z32>",
  "cap": "cap/edge/control-panel/hello-status",
  "responseKey": "<attempt-z32>",
  "receiptKey": "<attempt-z32>",
  "responderId": "mesh-v0-2.generic-responder",
  "handled": 1,
  "skipped": 0,
  "response": {
    "ok": true,
    "cap": "cap/edge/control-panel/hello-status",
    "message": "hello from mesh responder",
    "handledBy": "mesh-v0-2.generic-responder"
  },
  "statusBefore": {"counts": {"jobs": 1, "publish": 0, "ratify": 0}},
  "statusAfter": {"counts": {"jobs": 1, "publish": 1, "ratify": 0}}
}
```

When no matching pending job exists, the command prints JSON with `ok:false`, `state:"no_match"`, `handled:0`, `skipped:<n>`, `statusBefore`, and `statusAfter`, then exits nonzero. Automation should treat `state:"handled"` plus exit `0` as success, `state:"no_match"` as a blocked/no-work condition, and any invalid JSON or fatal stderr as failure.

`status --concern` includes responder evidence under:

- `counts.publish`
- `responders["mesh-v0-2.generic-responder"].handled`
- `responders["mesh-v0-2.generic-responder"].byCap["cap/edge/control-panel/hello-status"]`
- `responders["mesh-v0-2.generic-responder"].latest`

## Durability Barrier

Default behavior for every write command is `--wait`.

Barrier predicate:

- Read writer core peers from `core.peers`.
- Barrier is met when any peer reports `peer.remoteLength >= targetLength`.
- `targetLength` is the local writer core length after append.

Flags:

- `--wait` (default)
- `--no-wait`
- `--min-peers <n>` (default `1`)
- `--timeout-ms <n>` (default from `OPERATOR_TIMEOUT_MS`/config)

## Parseable Output Lines

Write commands emit one durability line:

- `durability: met`
- `durability: timeout`
- `durability: skipped`

Then they emit JSON payload for successful command results.

## Exit Codes

- `0`: command success.
- `1`: fatal error (including durability timeout).

Durability timeout is treated as a hard failure for `--wait`.

## Agent Usage Rules

- For authority-style append-and-exit flows, keep default `--wait`.
- Use `--no-wait` only for intentionally fire-and-forget workflows.
- Set `--timeout-ms` explicitly in automation to avoid environment drift.
- Use `--min-peers` for stricter connectivity requirements.

## Examples

Add writer:

```bash
node packages/mesh-operator-cli/bin/mesh.js discovery add-writer \
  --discovery <discovery-z32> \
  --writer <writer-z32> \
  --wait --min-peers 1 --timeout-ms 45000
```

Advertise concern:

```bash
node packages/mesh-operator-cli/bin/mesh.js discovery advertise-concern \
  --discovery <discovery-z32> \
  --concern <concern-z32> \
  --label "agent-run" \
  --wait --min-peers 1 --timeout-ms 45000
```

Submit job:

```bash
node packages/mesh-operator-cli/bin/mesh.js job submit \
  --concern <concern-z32> \
  --json /tmp/job.json \
  --wait --min-peers 1 --timeout-ms 45000
```
