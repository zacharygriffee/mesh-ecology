import idEncoding from "hypercore-id-encoding";
import b4a from "b4a";
import { replicateResource } from "../replicateBase.js";

// Read-only discovery adapter: advertise/scan only, no scheduling semantics.

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

export { joinDiscovery, joinDiscoveryTopic, scanDiscovery, ensureDiscoveryReplication };
