Bring-Up Runbook (“run the four”)

Prereqs
- Install deps; start four terminals in repo root.
- Preferred control-plane workflows now live in `mesh-ecology-packs` via `live:ctl`.
- This runbook is for direct engine/runtime bring-up and local debugging of the raw four-process loop.
- Status: local debug runbook only. It is not the preferred control-plane path and not actor integration precedent for adjacent repos.
- External pack installs are documented in submodule docs at `external/mesh-ecology-packs/docs/installation.md` (when installed).

Terminal 1 — discovery
- Run `node runDiscovery.js`.
- Copy the printed discovery key (z32).
- In the REPL, `key` shows current key; `addConcern(<concernKey>, meta?)` advertises concerns.

Terminal 2 — concern
- Run `node runConcern.js`.
- Copy the printed concern key (z32).
- In the REPL, create at least one job: `createJob(cap, jobPayload)`; payload can be any JSON-serializable value.

Advertise concern into discovery
- In the discovery REPL, call `addConcern("<concernKey>")` using the concern key from Terminal 2.

Terminal 3 — organism
- Run `DISCOVERY_ID=<discoveryKey> node runOrganism.js`.
- In the REPL, run `help()` to see controls.
- `tick()` (or `debugNextDiscovery()`) runs one modern runner pass.
- `start()/stop()` controls a tick loop; `status()` shows warm/cursor status.

Terminal 4 — ratifier
- Run `DISCOVERY_ID=<discoveryKey> node runRatifier.js`.
- In the REPL, run `help()` to see controls.
- `tick()` (or `debugNextDiscovery()`) runs one modern runner pass.
- `start()/stop()` controls a tick loop; `status()` shows warm/cursor status.
- Default ratifier actor is `fn-rat` with default function module `docs/examples/fn-rat/example.js`.
- Override actor/module if needed:
  - `DISCOVERY_ID=<discoveryKey> RAT_ACTOR=ratify-all node runRatifier.js`
  - `DISCOVERY_ID=<discoveryKey> RAT_ACTOR=fn-rat FN_RAT_MODULE=./docs/examples/fn-rat/example.js node runRatifier.js`
- Runtime REPL helpers:
  - `setFnModule("./path/to/module.js")` updates `FN_RAT_MODULE` and rebuilds runner.
  - `fnModule()` prints current module path and whether active actor uses it.

Waiting / propagation
- Swarm replication can take ~10–20s in dev; if organism/ratifier see no records yet, wait and rerun `debugNextDiscovery()` after a few seconds.

Troubleshooting checklist
- No records seen: confirm `DISCOVERY_ID` matches Terminal 1 output in both organism and ratifier.
- Concern not advertised: ensure `addConcern("<concernKey>")` was called in discovery.
- Replication delay: wait 10–20s and rerun the debug helper; check terminals for swarm connection logs.
- Missing jobs: verify `createJob` was called and concern REPL shows entries (`getJobView().createReadStream()` is acceptable as local debug only, not as a cross-runtime actor pattern).

Function organism: `fn-pub`
- Run organism REPL with explicit actor + function module:
  - `DISCOVERY_ID=<discoveryKey> ORG_ACTOR=fn-pub FN_PUB_MODULE=./docs/examples/fn-pub/example.js node runOrganism.js`
- In REPL, run `tick()` (or `start()`), then inspect concern PUB leaves from concern REPL via `getPublishView()` for local debug only.
- Reminder: publish append is optimistic proposal only; acceptance is when derived `pub/<job>/<org>/<attempt>` leaf materializes.
- See `docs/protocol.md` ("Acceptance / Materialization") for canonical semantics of `{accepted:false,...}` vs derived-view proof.
