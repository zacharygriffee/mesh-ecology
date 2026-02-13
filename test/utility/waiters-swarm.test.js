import test from "brittle";
import { EventEmitter } from "events";
import { waitForSwarmConnections, flushDiscovery } from "../../src/util/waiters/swarm.js";

test("waitForSwarmConnections resolves when min met", async (t) => {
  const swarm = new EventEmitter();
  swarm.connections = new Set();
  const p = waitForSwarmConnections(swarm, { min: 1, timeoutMs: 200 });
  swarm.connections.add(1);
  swarm.emit("connection", {});
  const res = await p;
  t.is(res.reached, true);
  t.is(res.connections, 1);
});

test("waitForSwarmConnections returns reached:false on timeout", async (t) => {
  const swarm = new EventEmitter();
  swarm.connections = new Set();
  const res = await waitForSwarmConnections(swarm, { min: 1, timeoutMs: 20 });
  t.is(res.reached, false);
  t.is(res.connections, 0);
});

test("flushDiscovery handles absent methods", async (t) => {
  const swarm = { flush: async () => true };
  const res = await flushDiscovery({ swarm, discovery: null, timeoutMs: 100 });
  t.ok(res.evidence.length === 1);
});
