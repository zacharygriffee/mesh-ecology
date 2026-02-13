import test from "brittle";
import Corestore from "corestore";
import crypto from "crypto";
import { ensureDiscoverySurface, addConcern, addDiscovery } from "../../src/discovery.js";
import idEncoding from "hypercore-id-encoding";
import { mkTemp } from "../_helpers/fs.js";
import { findByKey } from "../_helpers/view.js";

test("discovery reopen preserves data", async (t) => {
  const { dir, cleanup } = mkTemp("disc-local-");
  let key;
  try {
    // first open
    let store = new Corestore(dir);
    await store.ready?.();
    const disc1 = await ensureDiscoverySurface(store);
    key = disc1.key;

    const concernKey = idEncoding.encode(crypto.randomBytes(32));
    await addConcern(disc1, concernKey, "concern-one");
    await disc1.update();
    let rec = await findByKey(disc1.view, concernKey);
    t.ok(rec && rec.t === 2);
    await disc1.close();
    await store.close();

    // reopen
    store = new Corestore(dir);
    await store.ready?.();
    const disc2 = await ensureDiscoverySurface(store, { key });
    await disc2.update();
    rec = await findByKey(disc2.view, concernKey);
    t.ok(rec && rec.t === 2);
    await disc2.close();
    await store.close();
  } finally {
    cleanup();
  }
});

test("addConcern idempotent", async (t) => {
  const { dir, cleanup } = mkTemp("disc-local-");
  try {
    const store = new Corestore(dir);
    await store.ready?.();
    const disc = await ensureDiscoverySurface(store);
    const k = idEncoding.encode(crypto.randomBytes(32));
    await addConcern(disc, k, "concern-a");
    await addConcern(disc, k, "concern-b");
    await disc.update();
    const rec = await findByKey(disc.view, k);
    t.ok(rec && rec.t === 2);
    await disc.close();
    await store.close();
  } finally {
    cleanup();
  }
});

test("addDiscovery idempotent", async (t) => {
  const { dir, cleanup } = mkTemp("disc-local-");
  try {
    const store = new Corestore(dir);
    await store.ready?.();
    const disc = await ensureDiscoverySurface(store);
    const k = idEncoding.encode(crypto.randomBytes(32));
    await addDiscovery(disc, k, "discovery-a");
    await addDiscovery(disc, k, "discovery-b");
    await disc.update();
    const rec = await findByKey(disc.view, k);
    t.ok(rec && rec.t === 1);
    await disc.close();
    await store.close();
  } finally {
    cleanup();
  }
});

test("delete removes record", { skip: true }, async (t) => {
  const { dir, cleanup } = mkTemp("disc-local-");
  try {
    const store = new Corestore(dir);
    await store.ready?.();
    const disc = await ensureDiscoverySurface(store);
    const k = idEncoding.encode(crypto.randomBytes(32));
    await addConcern(disc, k, "concern-del");
    await disc.update();
    await disc.append({ key: k, op: "del" });
    await disc.update();
    const rec = await findByKey(disc.view, k);
    t.ok(!rec);
    await disc.close();
    await store.close();
  } finally {
    cleanup();
  }
});
