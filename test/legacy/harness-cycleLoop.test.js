import test from "brittle";
import { cycleLoop, sleep } from "../../labs/_shared/harness.js";

test("cycleLoop stops on first found", async (t) => {
  const res = await cycleLoop({
    maxCycles: 5,
    timeoutMs: 1000,
    cycle: async () => ({ found: true })
  });
  t.is(res.found, true);
  t.is(res.cycles, 1);
  t.is(res.log.length, 1);
});

test("cycleLoop stops when found after N", async (t) => {
  let count = 0;
  const N = 3;
  const res = await cycleLoop({
    maxCycles: 5,
    timeoutMs: 1000,
    cycle: async () => {
      count++;
      return { found: count === N };
    }
  });
  t.is(res.found, true);
  t.is(res.cycles, N);
  t.is(res.log.length, N);
});

test("cycleLoop respects maxCycles", async (t) => {
  const res = await cycleLoop({
    maxCycles: 5,
    timeoutMs: 1000,
    cycle: async () => ({ found: false })
  });
  t.is(res.found, false);
  t.is(res.cycles, 5);
  t.is(res.log.length, 5);
});

test("cycleLoop handles timeout consistently", async (t) => {
  const res = await cycleLoop({
    maxCycles: 10,
    timeoutMs: 20,
    cycle: async () => {
      await sleep(50);
      return { found: false };
    }
  });
  t.ok(res.found === false);
});
