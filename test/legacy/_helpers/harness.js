function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function withTimeout(promise, ms, label = "timeout") {
  let timer;
  const timeoutPromise = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error(`${label} after ${ms}ms`)), ms);
  });
  try {
    return await Promise.race([promise, timeoutPromise]);
  } finally {
    clearTimeout(timer);
  }
}

async function cycleLoop({ maxCycles, timeoutMs, cycle }) {
  const start = Date.now();
  const log = [];
  for (let i = 1; i <= maxCycles; i++) {
    const res = await cycle(i);
    const entry = { i, ...res, elapsedMs: Date.now() - start };
    log.push(entry);
    if (res.found) return { found: true, cycles: i, log, elapsedMs: Date.now() - start };
    if (Date.now() - start > timeoutMs) break;
  }
  return { found: false, cycles: maxCycles, log, elapsedMs: Date.now() - start };
}

export { withTimeout, sleep, cycleLoop };
