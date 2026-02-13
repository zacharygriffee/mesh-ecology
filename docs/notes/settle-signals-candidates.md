Settle / Readiness Signal Candidates (repo-friendly)

- Hyperswarm discovery flushed
  - Measure: `await discovery.flushed()` returned from `swarm.join(topic, ...)`.
  - Meaning: local announce/lookup completed for that topic on the DHT.
  - False positives: no peers may have announced yet; connections can still fail.
  - False negatives: subsequent refresh jitter may still add peers after it resolves.
  - Roles: discovery, concern, organism, ratifier.
  - Confidence: high (source: node_modules/hyperswarm/README.md:L31-L36; node_modules/hyperswarm/lib/peer-discovery.js:L191-L199).

- Hyperswarm swarm flush
  - Measure: `await swarm.flush()` after joins.
  - Meaning: pending discovery sessions flushed and connection queue drained.
  - False positives: peers attached but remote may not replicate view cores; does not guarantee application-level readiness.
  - False negatives: new peers announced after resolution will not be covered.
  - Roles: discovery, concern, organism, ratifier.
  - Confidence: high (source: node_modules/hyperswarm/index.js:L559-L572; node_modules/hyperswarm/README.md:L35-L38).

- Corestore replication handshake
  - Measure: await `replicate(...).noiseStream.opened` on the duplex returned by `corestore.replicate`.
  - Meaning: Noise handshake completed; muxer uncorked and existing cores attached locally.
  - False positives: remote may not attach its cores; does not ensure any data synced.
  - False negatives: new cores announced later need additional `_attachMaybe` events.
  - Roles: all (when wiring swarm connections into corestore).
  - Confidence: medium (source: node_modules/corestore/index.js:L421-L447).

- Hypercore peer-add/remove events
  - Measure: listen for `core.on('peer-add')` / `core.on('peer-remove')`.
  - Meaning: replication channel opened/closed for this core.
  - False positives: channel may open before any data transfer; stale peers might flap.
  - False negatives: peers may connect via other sessions not monitored; short connects may be missed if handler late.
  - Roles: concern/discovery/organism/ratifier cores.
  - Confidence: medium (source: node_modules/hypercore/lib/replicator.js:L3079-L3091; node_modules/hypercore/README.md:L701-L707).

- Hypercore download event
  - Measure: `core.on('download', (index, bytes, peer) => ...)`.
  - Meaning: a block just arrived from a peer; indicates replication activity.
  - False positives: a few blocks don’t mean view caught up; may be partial.
  - False negatives: cached data won’t emit; sparse downloads may be rare.
  - Roles: concern/discovery/organism/ratifier cores.
  - Confidence: medium (source: node_modules/hypercore/lib/replicator.js:L3094-L3101; node_modules/hypercore/README.md:L709-L714).

- Hyperswarm connection event
  - Measure: `swarm.on('connection', ...)` after join/flush.
  - Meaning: Noise stream opened to a peer; replication pipes can be attached.
  - False positives: peer may not host needed cores; connection can drop quickly.
  - False negatives: if handler attached late, initial connections may be missed.
  - Roles: all roles via shared swarm.
  - Confidence: high (source: node_modules/hyperswarm/index.js:L229-L240,L393-L399).

- Hyperbee watcher update
  - Measure: `watcher.on('update', ...)` (from `bee.watch` or `getAndWatch`).
  - Meaning: observed range/key changed after underlying core append/truncate processed.
  - False positives: update fired even for unrelated keys in broad ranges.
  - False negatives: only for watched ranges; un-watched parts won’t signal.
  - Roles: discovery/concern views (where bee is used).
  - Confidence: low (source: node_modules/hyperbee/index.js:L1450-L1453,L1605-L1606).
- Autobase flush clear
  - Measure: `await base.flush()` when `_flushing > 0` (rare but triggered during migrations/fast-forward).
  - Meaning: long-running internal maintenance finished; `_flushSignal` notified.
  - False positives: does not indicate replication caught up; only covers maintenance phases.
  - False negatives: if `_flushing` is zero, flush returns immediately even if data still syncing.
  - Roles: concern bases; any autobase usage.
  - Confidence: medium (source: node_modules/autobase/index.js:L671-L674,L1452-L1453,L1631-L1634).

- Hypercore replication depth heuristic
  - Measure: compare `remoteContiguousLength` vs `length`; when equal (or close), downloaded range matches local length.
  - Meaning: data blocks up to current length are present and verified locally.
  - False positives: remoteContiguousLength may lag header hints; equality doesn’t prove writer set complete.
  - False negatives: sparse downloads or paused replicator keep metric low despite eventual sync.
  - Roles: concern/organism/ratifier when checking underlying cores.
  - Confidence: medium (source: node_modules/hypercore/index.js:L567-L575).

- Hyperbee view ready + stable length heuristic
  - Measure: `await bee.ready()` then poll `bee.core.length` (or sub-view core) over a short interval for stability.
  - Meaning: underlying core/tree opened; stable length hints no new applied updates during window.
  - False positives: length stability doesn’t guarantee no missed remote appends.
  - False negatives: length can grow slowly if peers throttle; short window may miss in-flight updates.
  - Roles: discovery, concern views.
  - Confidence: low (source: node_modules/hyperbee/index.js:L896-L899).
