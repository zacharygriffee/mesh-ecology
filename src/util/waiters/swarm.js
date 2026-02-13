import { setTimeout as delay } from "timers/promises";

function waitForSwarmConnections(swarm, { min = 1, timeoutMs }) {
  if (!swarm || typeof swarm.on !== "function") {
    throw new Error("swarm with EventEmitter interface required");
  }
  if (!(timeoutMs > 0)) throw new Error("timeoutMs must be > 0");

  return new Promise((resolve) => {
    const start = Date.now();
    const cleanup = () => {
      swarm.off?.("connection", onConn);
    };
    const finish = (reached) => {
      cleanup();
      resolve({
        reached,
        connections: swarm.connections?.size ?? 0,
        elapsedMs: Date.now() - start
      });
    };
    const onConn = () => {
      if ((swarm.connections?.size ?? 0) >= min) finish(true);
    };
    swarm.on("connection", onConn);
    if ((swarm.connections?.size ?? 0) >= min) finish(true);
    delay(timeoutMs).then(() => finish((swarm.connections?.size ?? 0) >= min));
  });
}

async function flushDiscovery({ swarm, discovery, timeoutMs }) {
  const start = Date.now();
  const results = [];
  const withTimeout = async (p, label) => {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      await p;
      clearTimeout(timer);
      results.push({ label, ok: true });
    } catch (err) {
      clearTimeout(timer);
      results.push({ label, ok: false, error: err?.message ?? String(err) });
    }
  };

  if (discovery?.flushed) {
    await withTimeout(discovery.flushed(), "discovery.flushed");
  }
  if (swarm?.flush) {
    await withTimeout(swarm.flush(), "swarm.flush");
  }
  return {
    elapsedMs: Date.now() - start,
    evidence: results
  };
}

export { waitForSwarmConnections, flushDiscovery };
