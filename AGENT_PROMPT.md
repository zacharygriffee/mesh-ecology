## Codex Task — [SHORT TASK NAME]

### Goal
[One sentence: what to add/change. Example: “Add a new selective ratifier that ratifies only pubs tagged keep, plus add it to starter-pack.”]

### Edit Scope (allowed)
You may edit/add files only in:
- `organisms/*.js`
- `ratifiers/*.js`
- `packs/*/pack.json`
- `scripts/run-ecology.js` (selection/env wiring only)
- `docs/dev/*` (optional, only if explicitly requested below)

### Protected Internals (NO TOUCH unless I explicitly authorize)
Do not modify:
- `src/concern/keys.js`
- `src/concern/apply.js`
- `src/concern/encodings.js`
- `src/discovery.js` opcode/schema behavior
- `src/agent/runner/state-dedupe.js`
- `src/agent/runner/publish-pub.js`
- `src/agent/runner/publish-rat.js`
- `src/agent/runner/pubs-iterator.js`
- `src/agent/runner/rats-iterator.js`

### Non-Negotiable Invariants
- Discovery is advertise/scan only; **no scheduling or cross-surface coordination logic**.
- Acceptance is **derived-view materialization**, not append success.
- Organisms/ratifiers are proposal helpers; `concern.apply` is the decider.
- **No new opcodes**, no protocol keyspace changes, no apply-rule rewrites unless I explicitly request.
- Dedupe/marker identities must not be widened/relaxed without explicit authorization.
- Long-running workers must not `markDone` unless derived-view acceptance has been observed (leaf exists).
- Workflow state must live only under `work/` and `work-open/` namespaces; do not store workflow state in `agent/v1/state`.
- If an actor name is missing, loader behavior must be explicit (clear error or visible fallback log) — no silent fallback.

### Actor Contract (must follow)
- Default export an object with:
  - `name` (string)
  - `async onTick(ctx, api)`
- `definition.onTick` must exist.

### Patterns to Copy (do not invent structure)
Pick the closest reference and copy its structure:
- Structure A organism: `organisms/opportunist-A.js` or `organisms/pub-once.js`
- Structure B organism: `organisms/worker-basic.js` or `organisms/worker-B.js`
- Ratifier: `ratifiers/ratify-all.js` and `ratifiers/ratify-keep.js`
- Pack format: `packs/starter-pack/pack.json`

### Task Details
Implement:
- **Type:** [organism|ratifier|pack|selection wiring]
- **Name / filename:** [e.g. `ratifiers/ratify-cap-prefix.js`]
- **Behavior spec:**
  - Inputs used (ctx/jobs/pubs/rats, api.work, api.publish)
  - Predicate / selection rule:
    - [e.g. “ratify only pubs where pub.value.meta.tag === 'keep'”]
  - Backoff behavior (if any):
    - [e.g. “use api.work.cooldown('ratify:<job>', 5000)”]
  - Acceptance rule:
    - “Do not treat append success as acceptance; only treat derived-view leaf existence as acceptance.”

### Output Expectations
- Keep the new actor file small and readable.
- Add a short teaching header comment at top explaining what it demonstrates.
- If updating packs, update `packs/*/pack.json` only (no other pack logic).

### Validation Commands (run and report results)
Run:
1) `npm test -- --runInBand`
2) `CI=1 node test/run-files.js test/labs/`
3) Smoke the ecology demo with your actor selection:
   - `ECO_DURATION_MS=15000 ECO_DEFS=1 ECO_ORGANISMS=[...] ECO_RATIFIERS=[...] node scripts/run-ecology.js`
   - OR pack-driven: `ECO_DURATION_MS=15000 ECO_DEFS=1 ECO_DEFS_PACK=[...] node scripts/run-ecology.js`

### Deliverables
Return:
- Files changed/added
- Brief explanation of behavior + where it copies patterns from
- Validation results (pass/fail + any relevant output)
