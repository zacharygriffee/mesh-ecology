# AGENTS.md

This file defines default safety rules for AI/code agents working in this repo.

## Purpose

Keep ecology authoring fast while preserving locked v0 physics.

## Default Edit Scope

- Prefer edits in:
`organisms/*.js`
`ratifiers/*.js`
`packs/*/pack.json`
`scripts/run-ecology.js` (selection/env wiring only)
- Copy patterns from existing examples before inventing new structure.

## Protected Internals (No-Touch By Default)

Do not modify these unless the user explicitly requests protocol/runtime changes:

- `src/concern/keys.js`
- `src/concern/apply.js`
- `src/concern/encodings.js`
- `src/discovery.js` opcode/schema behavior
- `src/agent/runner/state-dedupe.js`
- `src/agent/runner/publish-pub.js`
- `src/agent/runner/publish-rat.js`
- `src/agent/runner/pubs-iterator.js`
- `src/agent/runner/rats-iterator.js`

## Non-Negotiable Invariants

- Discovery is advertise/scan only; no scheduling semantics.
- Discovery must not introduce cross-surface coordination or scheduling logic.
- Acceptance is derived-view materialization, not append success.
- Organisms/ratifiers are proposal helpers; `concern.apply` is the decider.
- No new opcodes, no protocol keyspace changes, no apply-rule rewrites unless explicitly requested.
- Dedupe/marker identities must not be widened or relaxed without explicit authorization.
- Long-running workers must not `markDone` unless derived-view acceptance has been observed (leaf exists).

## Actor Contract

- Actor files must default-export an object with:
`name`
`async onTick(ctx, api)`
- Canonical loader expectation: `definition.onTick` must exist.

## Organism Patterns

- Structure A (stateless): model after `organisms/opportunist-A.js`.
- Structure B (stateful): model after `organisms/worker-basic.js` or `organisms/worker-B.js`.
- For Structure B:
use `api.work` journal for phase/state
advance by `nextRunAtMs` and backoff
call `markDone` only after acceptance check
- Workflow journal boundaries:
workflow state must live only under `work/` and `work-open/` namespaces
do not store workflow state inside `agent/v1/state` (dedupe snapshot)
keep journal payloads small; store large artifacts elsewhere

## Ratifier Pattern

- Model after `ratifiers/ratify-all.js` and `ratifiers/ratify-keep.js`.
- Keep selectivity predicates in ratifier logic (edge policy), not in concern apply.
- Publish via `api.publish.rat(...)`.

## Discovery + Concern Surface Usage

- Discovery:
`ensureDiscoverySurface(...)`
`addConcern(...)`
`addDiscovery(...)`
- Concern:
`ensureConcernSurface(...)`
`createJob(...)`
view getters (`getJobView`, `getPublishView`, `getRatView`)
publish helpers through runner/actor APIs

## Prompt Requirements For Agents

Every implementation prompt should include:

- explicit reference files to copy from
- acceptance invariants
- "no protocol changes" constraint
- file scope constraints (where edits are allowed)

## Pre-PR / Pre-Commit Checklist

- No edits to protected internals unless explicitly authorized.
- No new `OP` values or concern/discovery schema changes.
- Actor keeps `onTick(ctx, api)` contract.
- Acceptance checks are derived-view based.
- For long-running workers: journal-backed phases and restart safety are preserved.
- If an actor name is missing, loader behavior must be explicit (visible fallback log or explicit error); no silent fallback.

## Useful Validation Commands

- `npm test -- test/runner/agent-runner-runner-api.test.js`
- `npm test -- test/ratifier/agent-runner-ratifier-phase4.test.js`
- `npm test -- test/labs/lab-ratifier.restart-dedupe.two-transport.test.js`
- `node scripts/inspect-work.js --store-root ./store/ecology --all`
