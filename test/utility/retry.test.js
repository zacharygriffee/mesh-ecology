import test from "brittle";
import { retry } from "../../src/util/retry.js";

test("retry succeeds within attempts and returns evidence", async (t) => {
  let calls = 0;
  const res = await retry(
    async () => {
      calls++;
      if (calls < 3) throw new Error("fail");
      return { ok: true, data: "done" };
    },
    { attempts: 5, timeoutMs: 200, baseDelayMs: 10, maxDelayMs: 50, jitter: 0.1, label: "unit" }
  );
  t.is(res.ok, true);
  t.is(calls, 3);
  t.ok(res.evidence.length >= 3, "evidence tracks attempts");
});

test("retry stops after max attempts on persistent failure", async (t) => {
  const res = await retry(
    async () => {
      throw new Error("always");
    },
    { attempts: 3, timeoutMs: 50, baseDelayMs: 5, maxDelayMs: 20, jitter: 0, label: "unit" }
  );
  t.is(res.ok, false);
  t.is(res.evidence.length, 3);
});

test("retry times out per attempt", async (t) => {
  let attempts = 0;
  const res = await retry(
    async ({ signal }) => {
      attempts++;
      return new Promise((_, reject) => {
        signal.addEventListener("abort", () => reject(new Error("attempt-timeout")));
      });
    },
    { attempts: 2, timeoutMs: 30, baseDelayMs: 5, maxDelayMs: 10, jitter: 0, label: "unit" }
  );
  t.is(res.ok, false);
  t.is(attempts, 2);
});
