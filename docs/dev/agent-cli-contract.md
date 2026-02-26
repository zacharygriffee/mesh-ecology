# Agent CLI Contract

This document defines machine-facing behavior for `packages/mesh-operator-cli/bin/mesh.js`.

## Scope

- No protocol/runtime semantic changes.
- Contract applies to CLI write commands used by operators and agents.

## Write Commands

- `discovery advertise-concern`
- `discovery add-writer`
- `job submit`

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
