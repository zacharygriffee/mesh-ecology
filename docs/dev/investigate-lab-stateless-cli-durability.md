# Investigate Lab: Stateless CLI Durability Barrier

Date: 2026-02-24
Scope: reconnaissance only (no protocol/runtime changes)

## 1) Repo Test Harness Summary

- Test runner is `brittle`, invoked per file by `npm test -> node test/run-files.js`, and each file is run as `npx brittle <file> --runInBand`. (`package.json:7-11`, `test/run-files.js:35-44`)
- Labs follow `test/labs/` naming patterns with explicit transport suffixes:
  - `*.single-transport.test.js` (e.g., `lab-fn-pub.single-transport`, `lab-fn-rat.single-transport`). (`test/labs/lab-fn-pub.single-transport.test.js:19`, `test/labs/lab-fn-rat.single-transport.test.js:19`)
  - `*.two-transport.test.js` (e.g., template and ecology labs). (`test/labs/lab-template.two-transport.test.js:14`, `test/labs/lab-negative.acceptance-gates.two-transport.test.js:18`)
- Two-transport labs set explicit brittle timeout via shared budgets (`{ timeout: budgets.outerTimeoutMs }`). (`test/labs/lab-template.two-transport.test.js:12-15`, `test/_helpers/lab-budgets.js:21-31`)
- Deterministic transport wiring exists in two forms:
  - Single-transport fake mesh: shared `topics` map + `createFakeSwarm({ topics })` + same topic `join`. (`test/labs/lab-fn-pub.single-transport.test.js:20-25`, `test/discovery/discovery-surface.replication.test.js:23-29`)
  - Two-transport harness: deterministic seed derivation, deterministic per-topic bytes (`topicFor`), fake transport via shared `fakeTopics` map, or real transport via Hyperswarm seeded by role. (`test/_helpers/lab-two-transport.js:192-193`, `test/_helpers/lab-two-transport.js:199`, `test/_helpers/lab-two-transport.js:219-221`, `test/_helpers/lab-two-transport.js:237-239`)
- Env flags observed in harness/labs:
  - `LEAK_CHECK=1` enables leak diagnostic test. (`test/misc/z-leak-check.test.js:3-6`)
  - `LAB_CALIBRATE` changes run-files behavior warning and drives lab budget calibration mode. (`test/run-files.js:30-33`, `test/_helpers/lab-budgets.js:13-15`)
  - `LAB_READY_MS`, `LAB_CONVERGE_MS`, `LAB_TIMEOUT_MS`, `LAB_REAL`, `LAB_REAL_STRICT`, `CI` control two-transport execution posture. (`test/_helpers/lab-budgets.js:7-22`, `docs/dev/ecology-labs.md:139-147`)

## 2) FakeSwarm / Transport Patterns (with evidence)

### Pattern A: Discovery replication test (minimal 2-peer fake transport)
- Swarm creation: two fake swarms sharing one `topics` map. (`test/discovery/discovery-surface.replication.test.js:23-25`)
- Peer connect path: both swarms join the same random 32-byte topic. (`test/discovery/discovery-surface.replication.test.js:26-29`)
- Replication path:
  - Convenience: pass swarm into `ensureDiscoverySurface(..., swarm)`. (`test/discovery/discovery-surface.replication.test.js:37-38`)
  - Manual: call `replicateResource(discX, swarmX)`. (`test/discovery/discovery-surface.replication.test.js:79-84`)
- Cleanup: close bases, stores, swarms, and temp dirs. (`test/discovery/discovery-surface.replication.test.js:54-61`, `test/discovery/discovery-surface.replication.test.js:99-106`)

### Pattern B: Runner API fake pair helper
- Swarm creation: helper `makeSwarmPair()` creates two swarms with shared `topics`. (`test/runner/agent-runner-runner-api.test.js:25-31`)
- Peer connect path: helper joins both to shared `topicSeed`. (`test/runner/agent-runner-runner-api.test.js:23-31`)
- Replication path: pass swarm into `ensureDiscoverySurface` / `ensureConcernSurface`. (`test/runner/agent-runner-runner-api.test.js:34-41`, `test/runner/agent-runner-runner-api.test.js:44-51`)
- Sync pacing in loops: `safeFlush(host)`, `safeFlush(runner)`, then `runner.tick()`. (`test/runner/agent-runner-runner-api.test.js:69-75`)
- Cleanup: close runners/stores/bases/swarms and remove dirs. (`test/runner/agent-runner-runner-api.test.js:146-156`)

### Pattern C: Single-transport lab (host + publisher + ratifier)
- Swarm creation: 3 fake swarms with one shared topics map. (`test/labs/lab-fn-rat.single-transport.test.js:20-27`)
- Replication path: all surfaces created with swarms passed in. (`test/labs/lab-fn-rat.single-transport.test.js:53`, `test/labs/lab-fn-rat.single-transport.test.js:57`, `test/labs/lab-fn-rat.single-transport.test.js:65-69`)
- Convergence loop style: repeated `safeFlush(...)` across swarms + `base.update({ wait: true })` checks. (`test/labs/lab-fn-rat.single-transport.test.js:96-107`, `test/labs/lab-fn-rat.single-transport.test.js:132-145`)
- Cleanup uses helper `closeSwarm` (destroys connections/sockets then closes swarm). (`test/labs/lab-fn-rat.single-transport.test.js:162-165`, `test/_helpers/swarm.js:1-11`)

### Pattern D: Two-transport generic harness
- Swarm creation:
  - fake leg: `createFakeSwarm({ topics: fakeTopics })`
  - real leg: `new Hyperswarm({ seed: deriveSeed(...) })` (`test/_helpers/lab-two-transport.js:219-221`)
- Deterministic peer/topic topology: `topicFor(name) -> deriveSeed(runSeed, ...)`, then `swarm.join(topic, { server: true, client: true })`. (`test/_helpers/lab-two-transport.js:237-239`, `test/labs/lab-template.two-transport.test.js:50-53`)
- Readiness gate before assertions: `waitForReplicationReady({ swarms, discoveries, bases, budgets })`. (`test/_helpers/lab-two-transport.js:254-261`)
- Cleanup: centralized reverse-order resource cleanup (`createLabResources().cleanup()`). (`test/_helpers/lab-two-transport.js:291-294`, `test/_helpers/lab-resources.js:56-86`)

## 3) Surface Bring-up Patterns (Discovery + Concern)

### Discovery surface pattern
- Host discovery open: `ensureDiscoverySurface(store.namespace("discovery"), {}, hostSwarm)` then add local writer, then `update({ wait: true })`. (`test/labs/lab-fn-pub.single-transport.test.js:74-77`)
- Replica discovery open by base key: `ensureDiscoverySurface(otherStore, { key: discA.key }, swarmB)`. (`test/discovery/discovery-surface.replication.test.js:37-38`)
- Discovery append op in tests usually `addConcern(...)` then explicit `discovery.update({ wait: true })`. (`test/discovery/discovery-surface.replication.test.js:43-45`, `test/labs/lab-fn-rat.single-transport.test.js:79-80`)

### Concern surface pattern
- Host concern open: `ensureConcernSurface(namespace, hostSwarm)`; initialize state via append + `update({ wait: true })`. (`test/labs/lab-fn-rat.single-transport.test.js:57-63`)
- Follower/replica concern open by host key: `ensureConcernSurface(namespace, followerSwarm, { key: hostBase.key })`. (`test/labs/lab-template.two-transport.test.js:68-74`, `test/labs/lab-negative.acceptance-gates.two-transport.test.js:47-52`)

### Replication attachment behavior in core modules
- Discovery: swarm replication attachment is optional convenience path. (`src/discovery.js:78-83`)
- Concern: replication is wired via `replicateBase(base, swarm)`. (`src/concern.js:44-56`)
- `replicateBase` listens on swarm connection events, replicates existing connections, and removes listener on base close. (`src/replicateBase.js:5-29`, `test/replication/replicateBase.test.js:26-35`, `test/replication/replicateBase.test.js:47-57`)

### How update/apply loops are driven in tests
- Most tests/labs drive convergence manually using looped `safeFlush(...)` + `base.update({ wait: true })` + assertions. (`test/labs/lab-pass-fresh.view-update.test.js:124-135`, `test/labs/lab-negative.acceptance-gates.two-transport.test.js:171-177`)
- Runner-based tests add `runner.tick()` into same manual loop. (`test/runner/agent-runner-runner-api.test.js:69-75`)

## 4) Replication Observability Tools Available Today

### Existing waiters/utilities
- Swarm connection established: `waitForSwarmConnections(swarm, { min, timeoutMs })` based on `swarm.connections.size` and `connection` events. (`src/util/waiters/swarm.js:3-27`)
- Core peer-add/peer-remove: `waitForCorePeers(core, ...)` listens for `peer-add`/`peer-remove` and reads `core.peers.length`. (`src/util/waiters/core.js:9-17`, `src/util/waiters/core.js:23-30`)
- Append visibility: `waitForCoreAppend` and `waitForCoreAppendWithData`. (`src/util/waiters/core.js:33-50`, `src/util/waiters/core.js:53-80`)
- View visibility: `waitForBeeNonEmpty`, `waitForBeeKey`. (`src/util/waiters/view.js:3-14`, `src/util/waiters/view.js:16-28`)
- Retry/poll helpers available: `retry(...)`, `getWait(...)`. (`src/util/retry.js:17-58`, `src/getWait.js:3-27`)

### What exists for “some peer remoteLength >= targetLength”
- No repo helper currently implements this exact predicate.
- Lowest-level primitives available now:
  - `core.peers` is exposed. (`node_modules/hypercore/index.js:594-596`)
  - peer objects carry `remoteLength`. (`node_modules/hypercore/lib/replicator.js:558-560`, `node_modules/hypercore/lib/inspect.js:16-19`)
  - core emits per-index transfer events (`download`, `upload`) with source peer. (`node_modules/hypercore/lib/replicator.js:3094-3100`, `node_modules/hypercore/lib/replicator.js:3103-3108`)
- Repo guidance explicitly frames waiters as “phases, not gates” and not global settled proofs. (`docs/util/waiters.md:1-5`, `docs/util/waiters.md:19-21`, `docs/util/waiters.md:30-33`)

## Minimal API Call Graph

Recommended call graph for the new lab (Discovery-first):

1. `createFakeSwarm({ topics })` for `authoritySwarm`, `remoteSwarm`. (`test/discovery/discovery-surface.replication.test.js:23-29`)
2. `swarm.join(topic)` on both peers. (`test/discovery/discovery-surface.replication.test.js:26-29`)
3. `ensureDiscoverySurface(authorityStore.namespace("discovery"), {}, authoritySwarm)`. (`test/labs/lab-fn-pub.single-transport.test.js:74`)
4. `addWriter(discoveryAuthority, discoveryAuthority.local.key)` then `discoveryAuthority.update({ wait: true })`. (`test/labs/lab-fn-pub.single-transport.test.js:75-77`)
5. `ensureDiscoverySurface(remoteStore.namespace("discovery"), { key: discoveryAuthority.key }, remoteSwarm)`. (`test/discovery/discovery-surface.replication.test.js:37-38`)
6. Precondition waits: `waitForSwarmConnections(...)` + `waitForCorePeers(discoveryAuthority.local, ...)`. (`src/util/waiters/swarm.js:3-27`, `src/util/waiters/core.js:3-30`)
7. Authority append: `addConcern(discoveryAuthority, concernKey, label)` then `discoveryAuthority.update({ wait: true })`. (`src/discovery.js:113-119`)
8. Durability barrier loop:
  - compute `targetLength = discoveryAuthority.local.length`
  - poll `discoveryAuthority.local.peers` until some `peer.remoteLength >= targetLength` (low-level primitive). (`node_modules/hypercore/index.js:594-596`, `node_modules/hypercore/lib/inspect.js:16-19`)
9. Simulate authority exit: close authority base/store/swarm.
10. Remote proof after authority closed: `remoteDiscovery.update({ wait: true })` and assert `findByKey(remoteDiscovery.view, concernKey)` is non-null. (`test/discovery/discovery-surface.replication.test.js:48-52`, `test/_helpers/view.js:4-9`)

## 5) Proposed Lab Plan (Repo-accurate)

### Placement and filename
- Folder: `test/labs/` (matches current lab location). (`test/labs/lab-template.two-transport.test.js:14`)
- Recommended file: `test/labs/lab-stateless-authority-cli-durability.single-transport.test.js`
  - Reason: docs recommend deterministic single-transport fake-first for semantic proofs before real-network parity. (`docs/dev/ecology-labs.md:18-21`, `docs/dev/ecology-labs.md:27-30`)

### Setup/teardown utilities
- Use `mkTmp`/`mkTemp` for isolated per-role dirs. (`test/_helpers/fs.js:5-12`)
- Use shared fake transport map `topics = new Map()` and `createFakeSwarm({ topics })`. (`test/discovery/discovery-surface.replication.test.js:23-25`)
- Use `safeFlush` inside convergence loops and `closeSwarm` for teardown. (`test/_helpers/swarm.js:13-16`, `test/_helpers/swarm.js:1-11`)
- Structure with `try/finally` cleanup (common in labs). (`test/labs/lab-fn-pub.single-transport.test.js:35-42`, `test/labs/lab-fn-pub.single-transport.test.js:132-145`)

### Role construction
- `authority` role: dedicated corestore + discovery surface writer.
- `remote` role: separate corestore + replica discovery surface opened with `{ key: authority.key }`. (`test/discovery/discovery-surface.replication.test.js:37-38`)
- Separate swarms for each role on same topic (no shared base object). (`test/discovery/discovery-surface.replication.test.js:24-29`)

### Surface to test first
- Discovery surface first (preferred) because append/read path is minimal (`addConcern` + `findByKey`) and already has replication tests. (`test/discovery/discovery-surface.replication.test.js:42-52`)

### Exact wait strategy
- Step A: precondition connectivity
  - `waitForSwarmConnections(authoritySwarm, { min:1, timeoutMs })`
  - `waitForSwarmConnections(remoteSwarm, { min:1, timeoutMs })` (`src/util/waiters/swarm.js:3-27`)
- Step B: precondition core peer visibility on authority writer core
  - `waitForCorePeers(discoveryAuthority.local, { min:1, timeoutMs })` (`src/util/waiters/core.js:3-30`)
- Step C: append target
  - append via `addConcern(...)`, `update({ wait:true })`, set `N = discoveryAuthority.local.length`. (`src/discovery.js:113-119`, `node_modules/hypercore/index.js:549-552`)
- Step D: durability barrier
  - poll authority writer `core.peers` until at least one peer has `remoteLength >= N`. (`node_modules/hypercore/index.js:594-596`, `node_modules/hypercore/lib/inspect.js:16-19`)
  - optional extra signal: observe `upload`/`download` core events while waiting. (`node_modules/hypercore/lib/replicator.js:3094-3108`)
- Step E: close authority resources; then on remote, `update({ wait:true })` and assert entry exists.

### Assertion proving post-exit durability
- Strong assertion for this lab goal:
  - after durability barrier is met and authority is closed,
  - remote still materializes the appended discovery entry (`findByKey(...)` returns record with expected type/key). (`test/discovery/discovery-surface.replication.test.js:48-52`, `test/_helpers/view.js:4-9`)

## 6) Risks / Pitfalls (Top 5)

1. **Topic mismatch (peers never connect)**
- Correct pattern: all swarms must share one topics map and join same topic bytes. (`test/discovery/discovery-surface.replication.test.js:23-29`)

2. **Replica opens a different base (wrong key), causing false negatives**
- Correct pattern: replica must open with `{ key: hostBase.key }`. (`test/discovery/discovery-surface.replication.test.js:37-38`, `test/labs/lab-template.two-transport.test.js:68-74`)

3. **Replication not attached when swarm omitted from surface construction**
- Correct pattern: either pass swarm into surface constructor or call `replicateResource` manually. (`test/discovery/discovery-surface.replication.test.js:79-84`, `src/discovery.js:78-83`)

4. **Event/wait race (arming append wait too late)**
- Correct pattern: arm edge-triggered waiters before triggering append. (`docs/util/waiters.md:12`, `docs/util/waiters.md:33`, `test/utility/waiters-core-view.integration.test.js:28-30`)

5. **Leaky teardown (open sockets/handles)**
- Correct pattern: close bases/stores/swarms and destroy swarm connections/sockets in helper. (`test/labs/lab-fn-rat.single-transport.test.js:154-166`, `test/_helpers/swarm.js:1-11`)

## Cleanup Checklist

For the new lab, ensure all of the following are awaited/executed in `finally`:

- Close authority and remote Autobase/discovery handles (`base.close()`). (pattern: `test/discovery/discovery-surface.replication.test.js:54-56`, `test/discovery/discovery-surface.replication.test.js:99-101`)
- Close authority and remote corestores. (`test/discovery/discovery-surface.replication.test.js:56-57`, `test/discovery/discovery-surface.replication.test.js:101-102`)
- Close swarms via `closeSwarm(...)` to destroy sockets before close. (`test/_helpers/swarm.js:1-11`)
- Cleanup temp dirs (`mkTemp.cleanup()` or `fs.rmSync(..., { recursive:true, force:true })`). (`test/_helpers/fs.js:9-12`, `test/labs/lab-fn-pub.single-transport.test.js:144`)
- If any join handles are created in harness-style tests, destroy them. (`test/labs/lab-template.two-transport.test.js:54-63`)

## Concrete Recommendation

Use a **single-transport fakeswarm lab under `test/labs/`** first:
- `lab-stateless-authority-cli-durability.single-transport.test.js`
- Discovery-only surface
- Durability barrier implemented by polling `authorityBase.local.peers[*].remoteLength >= authorityBase.local.length`
- Then close authority and assert remote materialization.

This is fully aligned with current deterministic lab patterns and existing readiness/waiter primitives.
