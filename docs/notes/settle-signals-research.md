Settle / Readiness Signals — Primary Source Notes

Hyperswarm
- Ready semantics: `discovery.flushed()` waits for a joined topic to finish announce/lookup on the DHT; `swarm.flush()` waits until pending discovery work and queued connection attempts are drained (source: node_modules/hyperswarm/README.md:L31-L36 and node_modules/hyperswarm/index.js:L559-L572).
- Events: `'connection'` emitted on successful peer link (source: node_modules/hyperswarm/README.md:L21-L38,L73-L79).
- Internals: `PeerDiscovery.flushed()` awaits any in-flight refresh and swarm.listen promise; `flush()` resolves after all peer-discovery sessions report flushed and queues empty (source: node_modules/hyperswarm/lib/peer-discovery.js:L191-L199 and node_modules/hyperswarm/index.js:L559-L572).
- Timing/grace: refresh uses 2 min jitter and 30s grace for sleep recovery, so discovery completion can be delayed (source: node_modules/hyperswarm/lib/peer-discovery.js:L72-L108).
- Events surface (additional): `swarm` emits `connection` and `update` on open/close; discovery sessions are promises (flushed) rather than events (source: node_modules/hyperswarm/index.js:L229-L267,L393-L399).

Hyperdht
- Ready semantics: server has `_listening` promise; `listening` getter true once non-null. Suspension/resume await that promise (source: node_modules/hyperdht/lib/server.js:L47-L76).
- Events: server emits `'connection'` when encrypted socket accepted (source: node_modules/hyperdht/lib/server.js:L59-L61).
- No explicit eventual-consistency warning; readiness tied to `listen()` completion.

Autobase
- Ready: examples call `await base.ready()` before append/update (source: node_modules/autobase/README.md:L16-L29).
- Apply ordering: README warns ordering is eventually consistent and may reorder as new causal info arrives (source: node_modules/autobase/README.md:L60-L69).
- Flush signal: `flush()` waits on `_flushSignal` when `_flushing > 0`, notified when maintenance decrements `_flushing` (source: node_modules/autobase/index.js:L671-L674,L1452-L1453,L1631-L1634).
- Events: `base` emits `update` after apply cycles, `interrupt` on interrupted apply; underlying view cores use hypercore events for append/download (source: node_modules/autobase/index.js:L2030-L2031,L834-L837).
- Update completion: `update()` (not cited here) returns when linearizer/apply have processed current heads, but ordering can still change per warning above.

Hypercore
- Ready: `ready()` returns `opening` promise; replication attaches immediately if opened, otherwise after `opening` resolves (source: node_modules/hypercore/index.js:L602-L604,L523-L528).
- Replication attachment: `_attachToMuxer` waits for `opening` before calling `core.replicator.attachTo`, ensuring core state available (source: node_modules/hypercore/index.js:L523-L528).
- No explicit settle event; contiguous length / remoteContiguousLength expose replication progress heuristics (source: node_modules/hypercore/index.js:L567-L575).
- Events: `peer-add`/`peer-remove` on replication channels, `download`/`upload` per block, `append`/`truncate` on length changes, `remote-contiguous-length` when hint updates (source: node_modules/hypercore/lib/replicator.js:L3079-L3109; node_modules/hypercore/lib/session-state.js:L649-L678; node_modules/hypercore/README.md:L693-L719).

Corestore
- Replication: `replicate()` corks the muxer until `noiseStream.opened` resolves, then attaches existing cores; new discovery keys attach via `_attachMaybe` when `ondiscoverykey` fires (source: node_modules/corestore/index.js:L421-L447).
- Legacy peer discovery helper: `findingPeers()` returns a decrementable handle and tracks active discovery sessions; can serve as “looking for peers” indicator (source: node_modules/corestore/index.js:L290-L299).
- Events/hooks: replication stream’s `noiseStream.opened` promise used to signal handshake; core.replicator `ondownloading` hook triggers stream attach (source: node_modules/corestore/index.js:L421-L447,L652-L658).
- Ready is via ReadyResource (implicit); no extra settle hook exposed.

Hyperbee
- Ready: `ready()` waits for underlying hypercore and tree to be opened (source: node_modules/hyperbee/index.js:L896-L899).
- Events: `bee.core` emits `append`/`truncate` and cascades to watchers; Watcher/EntryWatcher emit `update` on observed changes (source: node_modules/hyperbee/index.js:L441-L443,L680-L688,L1450-L1453,L1605-L1606).
- View currency: watchers (append/truncate) keep caches updated, but there is no explicit “fully indexed” event beyond awaiting `update()` on the core.

Hypercore-id-encoding
- Only affects key encoding/normalization; no readiness semantics.
