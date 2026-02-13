import test from "brittle";
import Corestore from "corestore";
import { waitForCorePeers, waitForCoreAppend } from "../../src/util/waiters/core.js";
import { waitForCoreAppendWithData } from "../../src/util/waiters/core.js";
import { waitForBeeNonEmpty, waitForBeeKey } from "../../src/util/waiters/view.js";
import Hyperbee from "hyperbee";
import { setTimeout as delay } from "timers/promises";
import { mkTemp } from "../_helpers/fs.js";

test("core peer and append via hyperswarm replication", async (t) => {
  const ta = mkTemp("waiters-core-a-");
  const tb = mkTemp("waiters-core-b-");
  let csA;
  let csB;

  try {
    csA = new Corestore(ta.dir);
    csB = new Corestore(tb.dir);
    const coreA = csA.get({ name: "test" });
    await coreA.ready();
    const coreB = csB.get({ key: coreA.key });
    await coreB.ready();

    const streamA = coreA.replicate(true);
    const streamB = coreB.replicate(false);
    streamA.pipe(streamB).pipe(streamA);

    const peerP = waitForCorePeers(coreB, { min: 1, timeoutMs: 20000 });
    const appendP = waitForCoreAppend(coreB, { timeoutMs: 20000 });
    await coreA.append("hello");

    const peerRes = await peerP;
    t.ok(peerRes.reached);

    const appendRes = await appendP;
    t.ok(appendRes.appended);
    t.ok(coreB.length >= 1);
  } finally {
    await csA?.close?.().catch(() => {});
    await csB?.close?.().catch(() => {});
    ta.cleanup();
    tb.cleanup();
  }
});

test("waitForCoreAppendWithData ignores predicate-false append then resolves on predicate-true", async (t) => {
  const temp = mkTemp("waiters-core-filter-");
  let store;
  try {
    store = new Corestore(temp.dir);
    const core = store.get({ name: "filter" });
    await core.ready();

    const waitP = waitForCoreAppendWithData(core, {
      timeoutMs: 1000,
      predicate: (data) => data && data.length > 0
    });

    await core.append(Buffer.alloc(0)); // predicate false (length 0)
    await core.append(Buffer.from("value")); // predicate true

    const res = await waitP;
    t.is(res.appended, true);
    t.ok(res.data && res.data.length > 0);
  } finally {
    await store?.close?.().catch(() => {});
    temp.cleanup();
  }
});

test("hyperbee view waiters", async (t) => {
  const temp = mkTemp("waiters-bee-");
  let store;
  try {
    store = new Corestore(temp.dir);
    const core = store.get({ name: "bee" });
    await core.ready();
    const bee = new Hyperbee(core, { keyEncoding: "utf-8", valueEncoding: "utf-8" });
    await bee.ready();
    await bee.put("k", "v");
    await waitForBeeNonEmpty(bee, { timeoutMs: 200, pollMs: 50 });
    const found = await waitForBeeKey(bee, "k", { timeoutMs: 500, pollMs: 50 });
    t.is(found.found, true);
  } finally {
    await store?.close?.().catch(() => {});
    temp.cleanup();
  }
});
