import test from "brittle";
import { EventEmitter } from "events";
import { replicateBase } from "../../src/replicateBase.js";

function fakeConn(name) {
  return { name };
}

function fakeBase() {
  let calls = [];
  const ee = new EventEmitter();
  ee.replicate = (conn) => {
    calls.push(conn);
  };
  ee.getCalls = () => calls;
  ee.close = () => ee.emit("close");
  return ee;
}

function fakeSwarm() {
  const ee = new EventEmitter();
  ee.connections = new Set();
  return ee;
}

test("replicateBase registers existing connections", (t) => {
  const swarm = fakeSwarm();
  const conn1 = fakeConn("c1");
  swarm.connections.add(conn1);
  const base = fakeBase();

  replicateBase(base, swarm);
  t.is(base.getCalls().length, 1);
  t.is(base.getCalls()[0], conn1);
});

test("replicateBase replicates on new connection", (t) => {
  const swarm = fakeSwarm();
  const base = fakeBase();
  replicateBase(base, swarm);
  const conn2 = fakeConn("c2");
  swarm.emit("connection", conn2);
  t.is(base.getCalls().length, 1);
  t.is(base.getCalls()[0], conn2);
});

test("replicateBase removes listener after base close", (t) => {
  const swarm = fakeSwarm();
  const base = fakeBase();
  replicateBase(base, swarm);
  const initial = swarm.listenerCount("connection");
  base.close();
  const conn3 = fakeConn("c3");
  swarm.emit("connection", conn3);
  t.is(base.getCalls().length, 0);
  t.is(swarm.listenerCount("connection"), initial - 1);
});
