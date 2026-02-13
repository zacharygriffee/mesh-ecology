import { setTimeout as delay } from "timers/promises";

async function waitForBeeNonEmpty(bee, { timeoutMs, pollMs = 250 }) {
  if (!bee?.core) throw new Error("bee with core required");
  const start = Date.now();
  const deadline = start + timeoutMs;
  while (Date.now() < deadline) {
    if (bee.core.length > 0) {
      return { nonEmpty: true, length: bee.core.length, elapsedMs: Date.now() - start };
    }
    await delay(pollMs);
  }
  return { nonEmpty: bee.core.length > 0, length: bee.core.length, elapsedMs: Date.now() - start };
}

async function waitForBeeKey(bee, key, { timeoutMs, pollMs = 250 }) {
  if (!bee?.get) throw new Error("bee with get() required");
  const start = Date.now();
  const deadline = start + timeoutMs;
  while (Date.now() < deadline) {
    const val = await bee.get(key).catch(() => null);
    if (val) {
      return { found: true, value: val, elapsedMs: Date.now() - start };
    }
    await delay(pollMs);
  }
  return { found: false, value: null, elapsedMs: Date.now() - start };
}

export { waitForBeeNonEmpty, waitForBeeKey };
