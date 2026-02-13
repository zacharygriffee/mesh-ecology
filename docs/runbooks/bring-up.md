Bring-Up Runbook (“run the four”)

Prereqs
- Install deps; start four terminals in repo root.

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
- In the REPL, run `debugNextDiscovery()` to process one discovery cycle; it uppercases string jobs when `cap === "debug.meta.value/v1"` and publishes a pub record.

Terminal 4 — ratifier
- Run `DISCOVERY_ID=<discoveryKey> node runRatifier.js`.
- In the REPL, run `debugNextDiscovery()` to process one cycle; it emits a rat record with determination “accept”, tier “debug”, note “auto-accepted by debug projector”.

Waiting / propagation
- Swarm replication can take ~10–20s in dev; if organism/ratifier see no records yet, wait and rerun `debugNextDiscovery()` after a few seconds.

Troubleshooting checklist
- No records seen: confirm `DISCOVERY_ID` matches Terminal 1 output in both organism and ratifier.
- Concern not advertised: ensure `addConcern("<concernKey>")` was called in discovery.
- Replication delay: wait 10–20s and rerun the debug helper; check terminals for swarm connection logs.
- Missing jobs: verify `createJob` was called and concern REPL shows entries (`getJobView().createReadStream()` can be inspected in REPL).
