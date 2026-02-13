import test from "brittle";
import { EventEmitter } from "events";
import { runFourBringup } from "../../src/util/bringup/runner.js";

function fakeSwarm() {
  const ee = new EventEmitter();
  ee.connections = new Set();
  ee.flush = async () => true;
  ee.join = () => {};
  return ee;
}

test("runner succeeds with retries when connection arrives late", async (t) => {
  const swarm = fakeSwarm();
  const spawn = {
    startDiscovery: async () => ({ swarm, discoveryJoin: { flushed: async () => true } }),
    startConcern: async () => ({ info: { key: "c" }, beeJob: { core: { length: 1 } } }),
    startOrganism: async () => ({}),
    startRatifier: async () => ({})
  };
  const advertiseConcern = async () => {};

  setTimeout(() => {
    swarm.connections.add(1);
    swarm.emit("connection", {});
  }, 50);

  const res = await runFourBringup({
    spawn,
    advertiseConcern,
    plan: { requirePubVisible: false, requireRatVisible: false },
    retry: { attempts: 2, timeoutMs: 200, baseDelayMs: 10, maxDelayMs: 50, jitter: 0 },
    timeouts: { connectMs: 500, flushMs: 200 }
  });

  t.is(res.ok, true);
  t.ok(res.evidence.find((e) => e.phase === "DISCOVERY_FLUSH"));
  t.ok(res.evidence.find((e) => e.phase === "SWARM_CONNECT"));
});

test("runner fails when advertise missing and required", async (t) => {
  const swarm = fakeSwarm();
  const spawn = {
    startDiscovery: async () => ({ swarm }),
    startConcern: async () => ({}),
    startOrganism: async () => ({}),
    startRatifier: async () => ({})
  };
  const res = await runFourBringup({
    spawn,
    plan: { requireConcernAdvertised: true, requireJobVisible: false, requirePubVisible: false, requireRatVisible: false },
    retry: { attempts: 1, timeoutMs: 100, baseDelayMs: 10, maxDelayMs: 20, jitter: 0 },
    timeouts: { connectMs: 50, flushMs: 50 }
  });
  t.is(res.ok, false);
  t.ok(res.evidence.find((e) => e.phase === "CONCERN_ADVERTISE"));
});
