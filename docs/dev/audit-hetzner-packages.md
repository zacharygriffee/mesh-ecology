> Status: Time-bound audit report from 2026-02-24. Treat repo-state remarks here as historical unless they match current docs/code.

# Hetzner Packages v0 Compliance Audit

Date: 2026-02-24
Type: Static assurance audit (no behavior changes)
Primary sources: `docs/v0-locked.md`, `docs/protocol.md`
Informative source status at audit time: `docs/runbooks/bring-up.md` available; `README.md` was not yet present in repo root.

## Executive Summary

### Invariant Verdicts

- I1 Discovery advertising-only: **PASS**
- I2 Concern optimistic intake (ack discipline): **PASS**
- I3 Role isolation (separate process + one Corestore per role): **PASS**
- I4 Pass boundary safety: **PASS**
- I5 No parallel protocol: **PASS**
- I6 z32 discipline: **PASS**

### Goal Answers (A-H)

- A) v0-locked compliant: **YES (PASS)**
- B) Role boundaries enforced: **YES (PASS)**
- C) Discovery host advertising-only: **YES (PASS)**
- D) Concern optimistic intake + ackWriter only in apply after validation: **YES (PASS)**
- E) Operator CLI avoids parallel protocol: **YES (PASS)**
- F) z32 for UX with buffer internals retained: **YES (PASS)**
- G) systemd/install lightweight constraints: **PASS with low-risk note** (shared `WorkingDirectory`, separate `ExecStart` is correct)
- H) Sharp edges (determinism/FD storm): **No constitutional blockers found; low-risk operational notes only**

## Evidence Table

| Invariant | Result | File:Line Evidence |
|---|---|---|
| I1 Discovery advertising-only | PASS | `docs/v0-locked.md:3`; `docs/protocol.md:8`; `packages/hetzner-discovery-host/bin/discovery-host.js:10`; `packages/hetzner-discovery-host/bin/discovery-host.js:208`; `src/discovery.js:113` |
| I2 Concern optimistic intake + ack discipline | PASS | `docs/v0-locked.md:4`; `docs/protocol.md:16`; `src/concern/apply.js:75`; `src/concern/apply.js:78`; `src/concern/apply.js:92`; `src/concern/apply.js:93`; `src/concern/apply.js:132`; `src/concern/apply.js:142`; `src/concern/apply.js:156`; `src/concern/apply.js:158` |
| I3 Role/process/corestore isolation | PASS | `docs/v0-locked.md:6`; `packages/hetzner-discovery-host/bin/discovery-host.js:14`; `packages/hetzner-discovery-host/bin/discovery-host.js:187`; `packages/hetzner-concern-host/bin/concern-host.js:14`; `packages/hetzner-concern-host/bin/concern-host.js:208`; `deploy/systemd/mesh-discovery-host.service:13`; `deploy/systemd/mesh-concern-host.service:13`; `deploy/install.sh:51`; `deploy/install.sh:73` |
| I4 Pass boundary safety | PASS | `docs/v0-locked.md:7`; `packages/hetzner-discovery-host/bin/discovery-host.js:191`; `packages/hetzner-concern-host/bin/concern-host.js:212`; `src/replicateBase.js:7`; `src/replicateBase.js:17` |
| I5 No parallel protocol | PASS | `packages/mesh-operator-cli/bin/mesh.js:10`; `packages/mesh-operator-cli/bin/mesh.js:12`; `packages/mesh-operator-cli/bin/mesh.js:13`; `packages/mesh-operator-cli/bin/mesh.js:244`; `packages/mesh-operator-cli/bin/mesh.js:309`; `docs/protocol.md:4`; `docs/protocol.md:11` |
| I6 z32 discipline | PASS | `docs/protocol.md:5`; `packages/hetzner-discovery-host/bin/discovery-host.js:17`; `packages/hetzner-discovery-host/bin/discovery-host.js:202`; `packages/hetzner-concern-host/bin/concern-host.js:17`; `packages/hetzner-concern-host/bin/concern-host.js:223`; `packages/mesh-operator-cli/bin/mesh.js:22`; `packages/mesh-operator-cli/bin/mesh.js:205` |

## Findings

### F-001 (Low): Shared systemd WorkingDirectory across both role units

- Risk: **Low**
- Evidence: `deploy/systemd/mesh-discovery-host.service:10`, `deploy/systemd/mesh-concern-host.service:10`
- Assessment: Both services are still separate processes with separate binaries and separate data directories, so v0 constitutional role isolation remains satisfied. Shared cwd is an ops hardening nit, not a protocol/runtime semantic violation.

### F-002 (Low): Concern heartbeat does full view scans each cycle

- Risk: **Low**
- Evidence: `packages/hetzner-concern-host/bin/concern-host.js:169`, `packages/hetzner-concern-host/bin/concern-host.js:270`, `packages/hetzner-concern-host/bin/concern-host.js:271`, `packages/hetzner-concern-host/bin/concern-host.js:272`
- Assessment: This is observability overhead, not protocol behavior drift. With current enforced max 1 concern (`packages/hetzner-concern-host/bin/concern-host.js:201`), impact is bounded but could grow if bounds are loosened later.

## Recommendations (No Required Code Changes)

- Keep current v0 behavior unchanged; no mandatory remediation identified.
- Optional ops hardening:
  - Consider distinct `WorkingDirectory` per unit for cleaner isolation semantics.
  - If concern cardinality is increased in future, consider cheaper heartbeat metrics to avoid repeated full scans.
- Keep using static audit script in CI/pre-release checks:
  - `node scripts/audit-hetzner-packages.js`

## Methodology

- Static source inspection with exact file:line evidence.
- Deterministic scripted checks in `scripts/audit-hetzner-packages.js` using profile `scripts/audit-hetzner-packages.expected.json`.
- No protocol/runtime edits, no refactors, no network/server additions.
