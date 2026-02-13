const DEFAULT_READY_MS = 45_000;
const DEFAULT_CONVERGE_MS = 45_000;
const DEFAULT_OUTER_TIMEOUT_MS = 120_000;
const DEFAULT_CALIBRATE_SAMPLES = 10;

function getLabBudgets() {
  const ci = envTruthy("CI");
  const strictOverride = envBool("LAB_REAL_STRICT");
  const realOverride = envBool("LAB_REAL");

  const readyMs = intEnv("LAB_READY_MS", DEFAULT_READY_MS, { min: 1_000, max: 300_000 });
  const convergeMs = intEnv("LAB_CONVERGE_MS", DEFAULT_CONVERGE_MS, { min: 1_000, max: 300_000 });
  const calibrate = envBool("LAB_CALIBRATE") === true;
  const samples = intEnv("LAB_CALIBRATE_SAMPLES", DEFAULT_CALIBRATE_SAMPLES, { min: 1, max: 100 });

  const strict = strictOverride ?? ci;
  const realEnabled = ci ? true : (realOverride ?? true);

  const calibrateTimeoutFloor = (readyMs + convergeMs) * (samples + 1) + 30_000;
  const outerFallback = calibrate ? Math.max(DEFAULT_OUTER_TIMEOUT_MS, calibrateTimeoutFloor) : DEFAULT_OUTER_TIMEOUT_MS;
  const outerTimeoutMs = intEnv("LAB_TIMEOUT_MS", outerFallback, { min: 5_000, max: 3_600_000 });

  return {
    readyMs,
    convergeMs,
    outerTimeoutMs,
    strict,
    calibrate,
    samples,
    realEnabled
  };
}

function envTruthy(name) {
  const v = process.env[name];
  if (!v) return false;
  const n = String(v).trim().toLowerCase();
  return n === "1" || n === "true" || n === "yes" || n === "on";
}

function envBool(name) {
  const v = process.env[name];
  if (v == null || String(v).trim() === "") return undefined;
  const n = String(v).trim().toLowerCase();
  if (n === "1" || n === "true" || n === "yes" || n === "on") return true;
  if (n === "0" || n === "false" || n === "no" || n === "off") return false;
  return undefined;
}

function intEnv(name, fallback, { min = Number.MIN_SAFE_INTEGER, max = Number.MAX_SAFE_INTEGER } = {}) {
  const raw = process.env[name];
  const parsed = Number.parseInt(String(raw ?? ""), 10);
  const value = Number.isFinite(parsed) ? parsed : fallback;
  return Math.min(max, Math.max(min, value));
}

export { getLabBudgets };
