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

- `responder run --concern <concern-z32> --config <operator-cli.json> --cap <supported-cap> --once --json`

This command is a bounded Mesh-owned responder loop. It opens the concern through Mesh concern APIs, reads the job view, skips jobs outside the requested cap, skips jobs already handled by `mesh-v0-2.generic-responder`, publishes one Mesh-owned response as concern PUB evidence, prints JSON, and exits. It is not a scheduler, daemon, app mutation command, or external network publication path beyond existing concern replication behavior.

Supported caps:

- `cap/concern/call-for-responses/v1`

`call-for-responses` is a generic concern-local job/response convention. It is not app-specific, not a global capability registry, not discovery/search/scheduling, and not a protocol change. It reuses existing concern `JOB` plus `PUB` materialization: an adjacent repo may submit a bounded job into a chosen concern, and responders may publish plural response evidence. The response evidence does not select actors, assign obligation, claim completion, claim device truth, claim Mesh truth, or claim adjacent-repo truth.

`call-for-responses` jobs must use:

- `in.requestKind: "mesh_concern_call_for_responses"`
- `in.profile`: non-empty producer profile, for example `"local_layer_need_call"`
- `in.needRef`: non-empty producer-local need reference
- `in.producer.repo` and `in.producer.surface`
- `in.responseMode: "plural_response_evidence"`
- `in.subject.kind` and `in.subject.summary`
- `in.subject.constraints`: optional bounded object
- `in.nonClaimsRequired`: must include `no_actor_selection`, `no_actor_obligation`, `no_completion_claim`, `no_device_truth`, and `no_mesh_truth`
- optional `in.operatorRef`

Payloads are rejected as response evidence when they imply actor selection, actor obligation, completion, device truth, Mesh truth, adjacent-repo truth, shell execution, scheduling, global discovery, or a global capability registry. App-specific caps and device/control semantics belong in the app package, a pack, or an explicitly named demo adapter outside Mesh core command behavior.

Successful call-for-responses output keeps the same envelope and adds generic plural response evidence:

```json
{
  "ok": true,
  "action": "responder-run",
  "state": "handled",
  "concernKey": "<concern-z32>",
  "jobKey": "<job-z32>",
  "cap": "cap/concern/call-for-responses/v1",
  "requestKind": "mesh_concern_call_for_responses",
  "profile": "<producer-profile>",
  "needRef": "<producer-need-ref>",
  "producer": {
    "repo": "<producer-repo>",
    "surface": "<producer-surface>"
  },
  "responseMode": "plural_response_evidence",
  "responses": [
    {
      "responderRef": "mesh-v0-2.generic-responder",
      "observed": true,
      "eligibility": "eligible"
    }
  ],
  "posture": {
    "nonClaims": [
      "does not select actors",
      "does not assign actor obligation",
      "does not claim completion",
      "does not claim physical device truth",
      "does not claim Mesh truth"
    ]
  },
  "statusBefore": {"counts": {"jobs": 1, "publish": 0, "ratify": 0}},
  "statusAfter": {"counts": {"jobs": 1, "publish": 1, "ratify": 0}}
}
```

Possible call-for-responses rejection codes include `invalid_payload`, `unsupported_payload_field`, `invalid_request_kind`, `missing_profile`, `missing_need_ref`, `invalid_producer`, `missing_producer_repo`, `missing_producer_surface`, `invalid_response_mode`, `invalid_subject`, `missing_subject_kind`, `missing_subject_summary`, `invalid_subject_constraints`, `missing_required_non_claims`, `invalid_operator_ref`, and `forbidden_claim`.

When no matching pending job exists, the command prints JSON with `ok:false`, `state:"no_match"`, `handled:0`, `skipped:<n>`, `statusBefore`, and `statusAfter`, then exits nonzero. Automation should treat `state:"handled"` plus exit `0` as success, `state:"no_match"` as a blocked/no-work condition, and any invalid JSON or fatal stderr as failure.

`status --concern` includes responder evidence under:

- `counts.publish`
- `responders["mesh-v0-2.generic-responder"].handled`
- `responders["mesh-v0-2.generic-responder"].byCap["cap/concern/call-for-responses/v1"]`
- `responders["mesh-v0-2.generic-responder"].latest`
- `responders["mesh-v0-2.generic-responder"].latestByCap["cap/concern/call-for-responses/v1"]`

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
