# Runtime-Owned Host Primitives

This document defines the boring runtime-owned host surface that higher layers may wrap.
It does not define deployment strategy, rollout semantics, or control-plane policy.

## Supported Primitive Set

The supported runtime-owned host primitives are:

- one host spec file shape
- one apply primitive that materializes runtime-owned files and directories
- one inspect/report primitive that emits bounded runtime facts

Higher layers such as `mesh-ecology-packs` may wrap these primitives, but should keep deployment
strategy and orchestration logic out of `mesh-v0-2`.

## Host Spec (`version: 1`)

Example: `deploy/config/runtime-hosts.example.json`

Stable top-level shape:

```json
{
  "version": 1,
  "repoRoot": "/opt/mesh-v0-2",
  "paths": {
    "configDir": "/etc/mesh",
    "dataDir": "/var/lib/mesh",
    "systemdDir": "/etc/systemd/system"
  },
  "discoveryHost": {
    "config": {
      "discoveryKey": "<z32>" ,
      "discoveryCreate": false
    }
  },
  "concernHost": {
    "config": {
      "concernKeys": ["<z32>"]
    }
  }
}
```

Required/expected rules:

- `version` must be `1`
- `repoRoot` points at the checked-out runtime repo used for rendered unit files
- `paths` defines the runtime-owned filesystem layout
- `discoveryHost` is optional, but if present must provide `discoveryKey` or `discoveryCreate=true`
- `concernHost` is optional, but if present must provide at least one `concernKeys` entry
- Host config prefers camelCase JSON keys

Runtime-owned host config fields are the same fields accepted by the host CLIs:

- discovery host:
  - `corestoreDir`
  - `discoveryKey`
  - `discoveryCreate`
  - `swarmTopics`
  - `swarmBootstrap`
  - `swarmSeedHex`
  - `discoveryWriters`
  - `updateIntervalMs`
  - `heartbeatMs`
- concern host:
  - `corestoreDir`
  - `concernKeys`
  - `swarmTopics`
  - `swarmBootstrap`
  - `swarmSeedHex`
  - `concernWriters`
  - `validation`
  - `updateIntervalMs`
  - `heartbeatMs`

## Apply Primitive

Command:

```bash
node scripts/runtime-host-apply.js --spec ./deploy/config/runtime-hosts.example.json
```

Optional flags:

- `--root /some/root`
- `--repo-root /path/to/mesh-v0-2`

What it does:

- creates runtime-owned config, data, and systemd directories
- writes `discovery-host.json` and `concern-host.json` from the supported host spec
- renders runtime-owned unit files from `deploy/systemd/*.service`
- emits machine-readable JSON summary of written files

What it does not do:

- no `systemctl`
- no service start/stop
- no rollout or health decisions

## Inspect / Report Primitive

Command:

```bash
node scripts/runtime-host-report.js --spec ./deploy/config/runtime-hosts.example.json
```

Optional flags:

- `--root /some/root`

The report emits bounded runtime facts only, including:

- host mode
- configured discovery or concern keys
- config and unit presence
- local readiness/open state
- local visibility/open state
- writability
- local discovery entry count
- local concern counts for `jobs`, `publish`, and `ratify`
- configured writer/admission-relevant lists

The report is explicitly not:

- remediation advice
- rollout guidance
- control-plane policy

## Packaging Boundary

`mesh-v0-2` runtime-owned artifacts:

- `packages/hetzner-discovery-host/bin/discovery-host.js`
- `packages/hetzner-concern-host/bin/concern-host.js`
- `deploy/config/*.json` templates that define runtime-owned host config examples
- `deploy/systemd/*.service`
- `deploy/install.sh`
- `scripts/runtime-host-apply.js`
- `scripts/runtime-host-report.js`

`mesh-ecology-packs` owns:

- deployment strategy
- environment/profile composition
- rollout sequencing
- higher-layer operational policy and wrappers

Product repos own:

- product-specific overlays
- product-specific config generation around the supported host spec
- automation that composes runtime-owned artifacts with product concerns

## Boundary Rules

- Do not add packs-shaped semantics to the host spec.
- Do not add rollout or orchestration behavior to the apply primitive.
- Do not add remediation or decision logic to the report primitive.
- If a higher layer needs more than these bounded primitives, that need must be justified explicitly rather than inferred from control-plane convenience.
