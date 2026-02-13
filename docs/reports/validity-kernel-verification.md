# Validity Kernel Verification Report

## 1) Executive summary
- Kernel is pure: no surface/replication imports, no side effects or nondeterminism detected; helpers limited to `b4a` and local modules.
- Structural validators enforce v0-locked bounds (cap/meta/note/job JSON), ref integrity, attempt presence, and duplicate checks via optional getters; dispatch only supports JOB/PUB/RAT.
- Error codes are stable strings and returned via `{ok:false, code, details}`; valid inputs return `{ok:true}` without mutating inputs or throwing.
- Tests cover key length, ref mismatch, bounds, getter-based existence/duplication paths, and dispatcher; all required test commands pass.
- Integration test edits are limited to IDE-case fixes (`APPEND` -> `append`) and making discovery tests adhere to append-only/label contract (string labels, skip del-op); diffs included.
- Repo contains many other pre-existing untracked/modified files outside this task; flagged for awareness (see inventory).

## 2) Changed file inventory (working tree)
Commands:
- `git status --short`
- `git diff --name-only`
- `git diff --stat`

Findings:
- Task-intent files present: `src/validity/errors.js`, `src/validity/types.js`, `src/validity/structural.js`, `src/validity/index.js`, `test/validity-structural.test.js`, `test/bringup-runner.integration.test.js`, `test/waiters-core-view.integration.test.js`, `test/discovery-surface.local.test.js`.
- Numerous other modified/untracked files exist (e.g., `.env`, `.gitignore`, labs/*, run*.js, src/* including concern/discovery, util files, node_modules, store/, docs/, etc.). These are outside the requested scope and should be reviewed separately if needed.

## 3) Purity evidence
Commands and outputs:
- `rg -n "autobase|hyperbee|corestore|hyperswarm|hypercore|noise|swarm|replicate" src/validity` → **no hits**
- `rg -n "fs\b|node:fs|process\.env|Date\.now|Math\.random|setTimeout|setInterval" src/validity` → **no hits**
- `rg -n "require\(|import\s" src/validity` → imports only `b4a`, local `errors.js`, and helper exports in `types.js`.
Conclusion: kernel modules are surface-agnostic, deterministic, and side-effect free.

## 4) Kernel behavior summary
- `errors.js`: exports stable codes `ERR_KEYLEN, ERR_CAP_BOUNDS, ERR_NOTE_BOUNDS, ERR_META_BOUNDS, ERR_REF_MISSING, ERR_REF_KEY_MISMATCH, ERR_JOB_MISSING, ERR_ATTEMPT_MISSING, ERR_DUP_ATTEMPT, ERR_DUP_RAT, ERR_TIER_BOUNDS, ERR_DETERMINATION_BOUNDS, ERR_OP_UNSUPPORTED`.
- `types.js`: exports predicates `isKey32`, `boundedUtf8ByteLen`, `isUint8`, `isUint16`, `isBoundedCap`, `normalizeAttemptToken` (hex-normalizes buffers/views; stringifies others; returns `undefined` for nullish). Typedefs cover Key32, Ref, JobValue, PubValue, RatValue, Getters.
- `structural.js`:
  - Common helpers: bounds constants; `ok()/fail()` return shapes; `jsonWithin` checks JSON size without throwing; `validateRefStructure` enforces ref object, key32, type/path bounds, hash key32, attempt len, returns normalized attemptToken.
  - `validateJob`: requires key32; cap within 256 bytes; optional `in` payload JSON ≤ 16000 bytes; returns ok/fail without getters.
  - `validatePub`: requires key32, ref valid, key == ref.k, attemptToken present (ref.a or value.attemptToken), cap bound, meta JSON ≤ 16000; optional getters: `getJob` must find job, `getAttempt` must not find existing attempt (duplicate rejection).
  - `validateRat`: requires jK/oK key32, aK length if buffer, ref valid and ref.k matches jK, attemptToken from aK/ref.a/value.attemptToken present; cap bound, note UTF-8 ≤ 256, tier uint16, determination uint8; optional getters: job must exist, attempt must exist, `getRat` must not already have ratification (duplicate rejection); ratifierKey optional (rK/ratifierKey) passed to getter.
  - `validateEvent`: dispatches only OP.JOB/OP.PUB/OP.RAT (numeric or case-insensitive string); others return ERR_OP_UNSUPPORTED.
- All validators return `{ok:true}` or `{ok:false, code, details}` and do not throw or mutate inputs; failure paths use `fail` helper, success uses `ok` helper.

## 5) Docs alignment mapping
- Cap/meta/note bounds and JSON size (validateJob/validatePub/validateRat) ↔ v0 locked protocol forbids economics/gas enforcement and focuses on bounded payloads (docs/v0-locked.md: gas/bonds not active; docs/protocol.md payload shapes; caps limited to UTF-8 strings).
- Ref integrity (key32, ref.k match event key) ↔ docs/protocol.md concern apply requires ref alignment before ackWriter; ensures optimistic writes only ack when ref matches job key.
- Attempt presence & uniqueness (validatePub requires attemptToken, rejects duplicate via getter) ↔ docs/protocol.md optimistic pub requires job exists and attempt uniqueness prior to ack.
- Ratification requirements (job & attempt existence, duplicate rat rejection, tier uint16 `tr`, determination uint8) ↔ docs/protocol.md tier canonical `tr`, ratifications operate on existing attempts and must be unique per ratifier/origin/attempt.
- Ref structure bounds (type/path bounded) ↔ docs/protocol.md ref fields bounded UTF-8; discovery/concern remain append-only; no delete enforcement in kernel.
- No economics enforced (no gas/bond logic) ↔ docs/v0-locked.md and glossary emphasize economics FUTURE-only; kernel contains none.

## 6) Test coverage summary
`test/validity-structural.test.js` covers:
- Key length error (job key).
- Ref/job key mismatch.
- Cap bounds, meta bounds, note bounds.
- Getter paths: job missing, duplicate attempt, attempt missing for rat, duplicate rat.
- Tier bounds (uint16) and determination bounds (uint8).
- Dispatcher `validateEvent` happy path.
Helpers use in-memory maps for getters; attemptToken normalization exercised via buffers.

## 7) Test run results
- `npm test -- test/validity-structural.test.js` → all tests passed (48/48, includes broader suite invoked by brittle).
- `npm test -- test/bringup-runner.integration.test.js test/waiters-core-view.integration.test.js test/discovery-surface.local.test.js` → all tests passed (48/48 assertions across suite; discovery delete case intentionally skipped).

## 8) Risks / open questions
- Many unrelated modified/untracked files in repo; not assessed here. If a clean baseline is required, consider reviewing/staging separately.
- Discovery delete-op remains skipped to honor append-only contract; if delete semantics are desired later, protocol changes and codec updates would be required.

## 9) Appendices: diffs for approved integration/discovery tests

### A. bringup-runner.integration.test.js (IDE casing fix)
```diff
--- before (APPEND placeholder)
+++ after
@@
-    const APPENDP = waitForReplicatedBlock();
-    await coreA.APPEND("hello");
-    const val = await APPENDP;
+    const appendP = waitForReplicatedBlock();
+    await coreA.append("hello");
+    const val = await appendP;
```

### B. waiters-core-view.integration.test.js (IDE casing fix)
```diff
--- before (APPEND placeholder)
+++ after
@@
-test("core peer and APPEND via hyperswarm replication", async (t) => {
+test("core peer and append via hyperswarm replication", async (t) => {
@@
-  const APPENDP = waitForCoreAppend(coreB, { timeoutMs: 20000 });
-  await coreA.APPEND("hello");
+  const appendP = waitForCoreAppend(coreB, { timeoutMs: 20000 });
+  await coreA.append("hello");
@@
-  const APPENDRes = await APPENDP;
-  t.ok(APPENDRes.APPENDed);
+  const appendRes = await appendP;
+  t.ok(appendRes.appended);
@@
-test("waitForCoreAppendWithData ignores predicate-false APPEND then resolves on predicate-true", async (t) => {
+test("waitForCoreAppendWithData ignores predicate-false append then resolves on predicate-true", async (t) => {
@@
-  await core.APPEND(Buffer.alloc(0)); // predicate false (length 0)
-  await core.APPEND(Buffer.from("value")); // predicate true
+  await core.append(Buffer.alloc(0)); // predicate false (length 0)
+  await core.append(Buffer.from("value")); // predicate true
@@
-  t.is(res.APPENDed, true);
+  t.is(res.appended, true);
```

### C. discovery-surface.local.test.js (append-only alignment)
```diff
+async function findByKey(view, keyBuf) {
+  const k32 = b4a.isBuffer(keyBuf) ? keyBuf : idEncoding.decode(keyBuf);
+  for await (const entry of view.createReadStream()) {
+    if (b4a.equals(entry.k32, k32)) return entry;
+  }
+  return null;
+}
@@
-    await addConcern(disc1, concernKey, { meta: { n: 1 } });
-    await disc1.update();
-    let rec = await disc1.view.get(concernKey);
-    t.ok(rec && rec.value.kind === "concern");
+    await addConcern(disc1, concernKey, "concern-one");
+    await disc1.update();
+    let rec = await findByKey(disc1.view, concernKey);
+    t.ok(rec && rec.t === 2);
@@
-    rec = await disc2.view.get(concernKey);
-    t.ok(rec && rec.value.kind === "concern");
+    rec = await findByKey(disc2.view, concernKey);
+    t.ok(rec && rec.t === 2);
@@
-    await addConcern(disc, k, { meta: { a: 1 } });
-    await addConcern(disc, k, { meta: { a: 2 } });
-    const rec = await disc.view.get(k);
-    t.ok(rec && rec.value.kind === "concern");
+    await addConcern(disc, k, "concern-a");
+    await addConcern(disc, k, "concern-b");
+    const rec = await findByKey(disc.view, k);
+    t.ok(rec && rec.t === 2);
@@
-    await addDiscovery(disc, k, { meta: { a: 1 } });
-    await addDiscovery(disc, k, { meta: { a: 2 } });
-    const rec = await disc.view.get(k);
-    t.ok(rec && rec.value.kind === "discovery");
+    await addDiscovery(disc, k, "discovery-a");
+    await addDiscovery(disc, k, "discovery-b");
+    const rec = await findByKey(disc.view, k);
+    t.ok(rec && rec.t === 1);
@@
-test("delete removes record", async (t) => {
+test("delete removes record", { skip: true }, async (t) => {
@@
-    await addConcern(disc, k, { meta: {} });
-    const rec = await disc.view.get(k);
-    t.ok(!rec);
+    await addConcern(disc, k, "concern-del");
+    const rec = await findByKey(disc.view, k);
+    t.ok(!rec);
```
