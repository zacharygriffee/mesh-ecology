

const kHandlers = Symbol("replicateBaseHandlers");

function replicateBase(base, swarm) {
  // Avoid piling multiple identical listeners on the same base+swarm pair.
  if (!base[kHandlers]) base[kHandlers] = new Map();
  const handlers = base[kHandlers];

  let onConn = handlers.get(swarm);
  if (!onConn) {
    onConn = (conn) => {
      base.replicate(conn?.socket ?? conn);
    };
    handlers.set(swarm, onConn);
    swarm.on("connection", onConn);
    base.once("close", () => {
      swarm.off("connection", onConn);
      handlers.delete(swarm);
    });
  }

  const iter = typeof swarm?.connections?.values === "function"
    ? swarm.connections.values()
    : swarm?.connections ?? [];
  for (const conn of iter) {
    const stream = conn?.socket ?? conn;
    base.replicate(stream);
  }
}

export { replicateBase };
export const replicateResource = replicateBase;
