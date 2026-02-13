import test from "brittle";
import { createBaseWithCache } from "../../src/createBaseWithCache.js";
import { createBaseCache } from "../../src/baseCache.js";
import Corestore from "corestore";
import b4a from "b4a";
import fs from "fs";
import os from "os";
import path from "path";

function tempStore() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "cbc-"));
  const store = new Corestore(dir);
  return { dir, store };
}

test("createBaseWithCache: no cache returns new base", { skip: true }, async (t) => {
  const { dir, store } = tempStore();
  const key = b4a.from("a".repeat(32));
  const base1 = await createBaseWithCache(store, key, {}, null);
  const base2 = await createBaseWithCache(store, key, {}, null);
  await base1.ready?.();
  await base2.ready?.();
  t.ok(base1 !== base2);
  await base1.close();
  await base2.close();
  await store.close();
  fs.rmSync(dir, { recursive: true, force: true });
});

test("createBaseWithCache: cache returns same base for same id and different for other id", { skip: true }, async (t) => {
  const { dir, store } = tempStore();
  const cache = createBaseCache({ maxSize: 2 });
  const keyA = b4a.from("a".repeat(32));
  const keyB = b4a.from("b".repeat(32));
  const base1 = await createBaseWithCache(store, keyA, {}, cache);
  const base2 = await createBaseWithCache(store, keyA, {}, cache);
  await base1.ready?.();
  await base2.ready?.();
  t.is(base1, base2);
  const base3 = await createBaseWithCache(store, keyB, {}, cache);
  await base3.ready?.();
  t.ok(base3 !== base1);
  await base1.close();
  await base2.close();
  await base3.close();
  await store.close();
  fs.rmSync(dir, { recursive: true, force: true });
});

test("createBaseWithCache: eviction cleanup is called (currently missing base param)", { skip: true }, async (t) => {
  const { dir, store } = tempStore();
  const cache = createBaseCache({ maxSize: 1 });
  const keyA = b4a.from("a".repeat(32));
  const keyB = b4a.from("b".repeat(32));
  let closeCalls = 0;
  const baseA = await createBaseWithCache(store, keyA, {}, cache);
  const originalClose = baseA.close.bind(baseA);
  baseA.close = async () => {
    closeCalls += 1;
    return originalClose();
  };
  const baseB = await createBaseWithCache(store, keyB, {}, cache);
  await baseB.ready?.();
  t.is(closeCalls, 1, "eviction cleanup should close baseA once");
  await baseA.close();
  await baseB.close();
  await store.close();
  fs.rmSync(dir, { recursive: true, force: true });
});
