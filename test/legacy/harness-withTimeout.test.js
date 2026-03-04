import test from "brittle";
import { withTimeout } from "./_helpers/harness.js";

test("withTimeout resolves passthrough", async (t) => {
  const res = await withTimeout(Promise.resolve("ok"), 1000, "x");
  t.is(res, "ok");
});

test("withTimeout rejects on timeout and includes label", async (t) => {
  let threw = false;
  try {
    await withTimeout(new Promise(() => {}), 30, "myLabel");
  } catch (e) {
    threw = true;
    const msg = String(e.message).toLowerCase();
    t.ok(msg.includes("mylabel"));
  }
  t.ok(threw);
});

test("withTimeout propagates rejection", async (t) => {
  const boom = new Error("boom");
  let threw = false;
  try {
    await withTimeout(Promise.reject(boom), 1000, "x");
  } catch (e) {
    threw = true;
    t.is(e, boom);
  }
  t.ok(threw);
});
