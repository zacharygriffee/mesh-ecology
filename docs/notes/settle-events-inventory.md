Settle / Event Surfaces Inventory (primary sources)

Hyperswarm
- Emitter: `swarm` (Hyperswarm instance) — Event: `connection`; fires when Noise stream opens and peer added to `connections` inside `_connect` client path and `_handleServerConnection` server path; relevance: peer link ready for replication; noise: medium (fires for every socket) — source: node_modules/hyperswarm/index.js:L229-L240,L393-L399.
- Emitter: `swarm` — Event: `update`; fired after connection open/close and queue churn; relevance: indicates state change in peer set/queue; noise: high; source: node_modules/hyperswarm/index.js:L241-L267,L392-L399.
- Emitter: `discovery` (result of `swarm.join`) — Method `flushed()` resolves after announce/lookup cycle and `swarm.listen`; not an event but settle-related; source: node_modules/hyperswarm/lib/peer-discovery.js:L191-L199.

Corestore
- Emitter: `corestore` replication stream (protocol stream) — Event: `noiseStream.opened` promise used to uncork muxer; relevance: confirms handshake before attaching cores; noise: low; source: node_modules/corestore/index.js:L421-L447.
- Emitter: `core.replicator` (per core) — Callback `ondownloading` invoked to attach streams; not event, but hook used to attach; source: node_modules/corestore/index.js:L652-L658.
- Emitter: `StreamTracker` records streams; no public events surfaced.

Hypercore
- Emitter: `core` sessions/monitors — Event: `peer-add` / `peer-remove`; fired in replicator `_onpeerupdate` when a replication channel opens/closes; relevance: peer presence for this core; noise: medium; source: node_modules/hypercore/lib/replicator.js:L3079-L3091.
- Emitter: `core` sessions — Event: `download` / `upload`; fired per block transferred in `_ondownload` / `_onupload`; relevance: replication progress; noise: high (per block); source: node_modules/hypercore/lib/replicator.js:L3094-L3109.
- Emitter: `core` sessions — Event: `append`; emitted when core length increases (local or remote) in session-state `onappend`; relevance: content growth; noise: medium; source: node_modules/hypercore/lib/session-state.js:L649-L655.
- Emitter: `core` sessions — Event: `truncate`; emitted on truncation; relevance: reorg/rollback signal; source: node_modules/hypercore/lib/session-state.js:L658-L678.
- Emitter: `core` sessions — Event: `remote-contiguous-length`; documented in README; emitted when remote contiguous hint updates; source: node_modules/hypercore/README.md:L693-L719.

Autobase
- Emitter: `base` (ReadyResource) — Event: `update`; fired after apply/linearizer completes an update cycle; relevance: view advanced; noise: medium; source: node_modules/autobase/index.js:L2030-L2031.
- Emitter: `base` — Event: `interrupt`; fired when apply interrupted (e.g., close) inside `_onError`; relevance: signals aborted apply; noise: low; source: node_modules/autobase/index.js:L834-L837.
- Note: base delegates storage to hypercores; append events are numerous and noisy; use view-core events for finer granularity.

Hyperbee
- Emitter: `bee.core` (hypercore) — Events: `append`, `truncate`; wired in constructor to call `_onappend`/`_ontruncate`; relevance: underlying data changed; noise: medium/high depending on write rate; source: node_modules/hyperbee/index.js:L441-L443,L680-L688.
- Emitter: `Watcher` / `EntryWatcher` — Event: `update`; emitted when watched range/key changes after append/truncate processing; relevance: higher-level view update; noise: medium; source: node_modules/hyperbee/index.js:L1450-L1453,L1605-L1606.
