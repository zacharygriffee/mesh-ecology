import { setTimeout as delay } from "timers/promises";

function computeBackoff(attempt, { baseDelayMs, maxDelayMs, jitter }) {
  const exp = baseDelayMs * Math.pow(2, attempt - 1);
  const capped = Math.min(exp, maxDelayMs);
  const spread = capped * (jitter ?? 0);
  if (!spread) return capped;
  const rand = Math.random() * spread;
  return capped - spread / 2 + rand;
}

/**
 * retry(fn, opts)
 * fn receives { attempt, signal, deadlineMs } and may throw or return { ok:false } to trigger retry.
 * Always terminates within attempts * timeout + bounded backoff.
 */
async function retry(fn, opts) {
  const {
    attempts,
    timeoutMs,
    baseDelayMs,
    maxDelayMs,
    jitter = 0,
    label = "retry"
  } = opts;

  if (!(attempts > 0)) throw new Error("attempts must be > 0");
  if (!(timeoutMs > 0)) throw new Error("timeoutMs must be > 0");
  if (!(baseDelayMs >= 0)) throw new Error("baseDelayMs must be >= 0");
  if (!(maxDelayMs >= baseDelayMs)) throw new Error("maxDelayMs must be >= baseDelayMs");

  const evidence = [];
  for (let attempt = 1; attempt <= attempts; attempt++) {
    const controller = new AbortController();
    const started = Date.now();
    const deadlineMs = started + timeoutMs;
    const timer = setTimeout(() => controller.abort(new Error("attempt-timeout")), timeoutMs);
    try {
      const value = await fn({ attempt, signal: controller.signal, deadlineMs });
      clearTimeout(timer);
      if (value && value.ok === false) {
        evidence.push({ attempt, kind: "fail", value });
      } else {
        evidence.push({ attempt, kind: "ok" });
        return { ok: true, attempt, value, evidence };
      }
    } catch (err) {
      clearTimeout(timer);
      evidence.push({ attempt, kind: "error", error: err?.message ?? String(err) });
    }

    if (attempt === attempts) break;
    const waitMs = computeBackoff(attempt + 1, { baseDelayMs, maxDelayMs, jitter });
    await delay(waitMs, null, { signal: opts?.abortSignal });
  }

  return { ok: false, attempts, evidence, label };
}

export { retry };
