import test from "brittle";
import Corestore from "corestore";
import fs from "fs";
import os from "os";
import path from "path";

// Proves: corestore replication works via direct protocol stream between two stores (no network flake).
// Does NOT prove: Autobase/view semantics or discovery via swarm.
test("integration: replicate a hypercore over corestore streams", async (t) => {
  const dirA = fs.mkdtempSync(path.join(os.tmpdir(), "bringup-a-"));
  const dirB = fs.mkdtempSync(path.join(os.tmpdir(), "bringup-b-"));
  const storeA = new Corestore(dirA);
  const storeB = new Corestore(dirB);
  await storeA.ready?.();
  await storeB.ready?.();

  const coreA = storeA.get({ name: "demo-core", valueEncoding: "utf-8" });
  await coreA.ready();
  const coreB = storeB.get({ key: coreA.key, valueEncoding: "utf-8" });
  await coreB.ready();

  const streamA = storeA.replicate(true);
  const streamB = storeB.replicate(false);
  streamA.pipe(streamB).pipe(streamA);

  const waitForReplicatedBlock = async () => {
    const start = Date.now();
    while (Date.now() - start < 5000) {
      if (coreB.length > 0) {
        const val = await coreB.get(0);
        return val;
      }
      await new Promise((r) => setTimeout(r, 50));
    }
    throw new Error("replication timeout");
  };

  const testTimeout = setTimeout(() => {
    t.fail("test-level timeout exceeded");
  }, 7000);

  try {
    const appendP = waitForReplicatedBlock();
    await coreA.append("hello");
    const val = await appendP;
    t.is(val.toString(), "hello");
  } finally {
    clearTimeout(testTimeout);
    await coreA.close();
    await coreB.close();
    await storeA.close();
    await storeB.close();
    fs.rmSync(dirA, { recursive: true, force: true });
    fs.rmSync(dirB, { recursive: true, force: true });
  }
});
