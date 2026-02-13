// Normalization for runner warmup/retry budgets.

const DEFAULT_WARMUP = {
  maxTicks: 10,
  maxMs: 60000,
  minViewReadable: true
};

const DEFAULT_RETRY = {
  cooldownMs: 1000,
  backoff: "linear",
  maxAttempts: 0 // 0 = unlimited
};

function normalizeWarmupBudget(b = {}) {
  const maxTicks = Number.isFinite(b.maxTicks) ? b.maxTicks : DEFAULT_WARMUP.maxTicks;
  const maxMs = Number.isFinite(b.maxMs) ? b.maxMs : DEFAULT_WARMUP.maxMs;
  const minViewReadable = b.minViewReadable !== false;
  return { maxTicks, maxMs, minViewReadable };
}

function normalizeRetryPolicy(r = {}) {
  const cooldownMs = Number.isFinite(r.cooldownMs) ? r.cooldownMs : DEFAULT_RETRY.cooldownMs;
  const backoff = r.backoff === "exp" ? "exp" : "linear";
  const maxAttempts = Number.isFinite(r.maxAttempts) ? r.maxAttempts : DEFAULT_RETRY.maxAttempts;
  return { cooldownMs, backoff, maxAttempts };
}

export { normalizeWarmupBudget, normalizeRetryPolicy, DEFAULT_WARMUP, DEFAULT_RETRY };
