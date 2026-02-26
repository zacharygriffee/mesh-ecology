import { setTimeout as delay } from "timers/promises";

const DEFAULT_MIN_PEERS = 1;
const DEFAULT_TIMEOUT_MS = 15_000;
const POLL_MS = 50;

function positiveInt(value, fallback) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) return fallback;
  return Math.floor(parsed);
}

function nonNegativeInt(value, fallback) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 0) return fallback;
  return Math.floor(parsed);
}

async function waitForDurability(core, targetLength, opts = {}) {
  const minPeers = positiveInt(opts.minPeers, DEFAULT_MIN_PEERS);
  const timeoutMs = positiveInt(opts.timeoutMs, DEFAULT_TIMEOUT_MS);
  const target = nonNegativeInt(targetLength, 0);

  const start = Date.now();
  let lastConnected = 0;
  let lastMaxRemoteLength = 0;

  while (Date.now() - start < timeoutMs) {
    const peers = Array.isArray(core?.peers) ? core.peers : [];
    const connected = peers.length;
    const maxRemoteLength = peers.reduce((max, peer) => {
      const remoteLength = Number.isInteger(peer?.remoteLength) ? peer.remoteLength : 0;
      return remoteLength > max ? remoteLength : max;
    }, 0);

    lastConnected = connected;
    lastMaxRemoteLength = maxRemoteLength;

    const hasPeerAtTarget = peers.some((peer) => {
      const remoteLength = Number.isInteger(peer?.remoteLength) ? peer.remoteLength : 0;
      return remoteLength >= target;
    });
    const enoughConnectedPeers = connected >= minPeers;

    // Barrier policy:
    // 1) Prefer observing at least minPeers connected.
    // 2) Always treat one peer reaching target as sufficient durability.
    if (!enoughConnectedPeers && !hasPeerAtTarget) {
      await delay(POLL_MS);
      continue;
    }

    if (hasPeerAtTarget) {
      return {
        met: true,
        targetLength: target,
        minPeers,
        connectedPeers: connected,
        maxRemoteLength
      };
    }

    await delay(POLL_MS);
  }

  const err = new Error(
    `durability timeout: targetLength=${target} minPeers=${minPeers} connectedPeers=${lastConnected} maxRemoteLength=${lastMaxRemoteLength} timeoutMs=${timeoutMs}`
  );
  err.code = "DURABILITY_TIMEOUT";
  err.details = {
    met: false,
    targetLength: target,
    minPeers,
    connectedPeers: lastConnected,
    maxRemoteLength: lastMaxRemoteLength,
    timeoutMs
  };
  throw err;
}

export { waitForDurability };
