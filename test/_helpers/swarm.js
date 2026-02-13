async function closeSwarm(s) {
  if (!s) return;
  if (s.connections && typeof s.connections.values === "function") {
    for (const conn of s.connections.values()) {
      conn?.destroy?.();
      conn?.socket?.destroy?.();
    }
  }
  await s.close().catch(() => {});
  if (typeof s.destroy === "function") s.destroy();
}

async function safeFlush(swarm, ms = 50) {
  if (!swarm?.flush) return;
  await Promise.race([swarm.flush(), new Promise((resolve) => setTimeout(resolve, ms))]);
}

async function flushBoth(a, b) {
  await a.flush();
  await b.flush();
}

export { closeSwarm, safeFlush, flushBoth };
