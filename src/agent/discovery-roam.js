import idEncoding from "hypercore-id-encoding";
import b4a from "b4a";
import { replicateResource } from "../replicateBase.js";
import { ensureDiscoverySurface } from "../discovery.js";

// Read-only discovery adapter: advertise/scan only, no scheduling semantics.
// Roaming discovery should not imply writable or authority-bearing posture.

function joinDiscoveryTopic(swarm, discoveryKeyBuf) {
  if (!swarm) return;
  const topic = b4a.isBuffer(discoveryKeyBuf) ? discoveryKeyBuf : idEncoding.decode(discoveryKeyBuf);
  swarm.join(topic);
  return topic;
}

function joinDiscovery(swarm, discoveryBase) {
  return joinDiscoveryTopic(swarm, discoveryBase.key);
}

// cursor counts entries; discovery view is append order.
async function* scanDiscovery(discoveryBase, { since = 0 } = {}) {
  // Yields { seq, t, k32, v } in append order. since counts entries consumed.
  let seq = 0;
  for await (const entry of discoveryBase.view.createReadStream()) {
    seq += 1;
    if (seq <= since) continue;
    const { t, k32, v } = entry;
    yield { seq, t, k32, v };
  }
}

function ensureDiscoveryReplication(discoveryBase, swarm) {
  if (swarm) replicateResource(discoveryBase, swarm);
}

async function ensureTrackedDiscovery({
  discoveries,
  discoveryIndex,
  corestore,
  swarm,
  key,
  cursors = {},
  namespacePrefix = "disc"
}) {
  const keyBuf = b4a.isBuffer(key) ? key : idEncoding.decode(key);
  const keyZ32 = idEncoding.encode(keyBuf);
  const existing = discoveryIndex.get(keyZ32);
  if (existing) return existing;

  const disc = await ensureDiscoverySurface(
    corestore.namespace(`${namespacePrefix}-${keyZ32}`),
    { key: keyBuf },
    swarm
  );
  ensureDiscoveryReplication(disc, swarm);
  joinDiscovery(swarm, disc);

  const tracked = { disc, cursor: cursors[keyZ32] ?? 0, key: keyZ32 };
  discoveries.push(tracked);
  discoveryIndex.set(keyZ32, tracked);
  return tracked;
}

export {
  joinDiscovery,
  joinDiscoveryTopic,
  scanDiscovery,
  ensureDiscoveryReplication,
  ensureTrackedDiscovery
};
