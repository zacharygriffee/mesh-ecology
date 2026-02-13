import test from "brittle";
import { updateWithTimeout } from "../../src/util/updateWithTimeout.js";

test("updateWithTimeout resolves when update resolves", async (t) => {
  const base = { update: async () => {} };
  await updateWithTimeout(base, 200);
  t.ok(true);
});

test("updateWithTimeout rejects on timeout", async (t) => {
  const base = { update: () => new Promise(() => {}) };
  let threw = false;
  try {
    await updateWithTimeout(base, 50, "lab");
  } catch (e) {
    threw = true;
    t.ok(e.code === "ERR_UPDATE_TIMEOUT");
    t.ok(String(e.message).includes("lab"));
  }
  t.ok(threw, "should throw on timeout");
});
