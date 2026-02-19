#!/usr/bin/env node
import crypto from "crypto";
import { runEcologyOrchestrator } from "./ecology-orchestrator.js";

/**
 * CLI wrapper intentionally stays small:
 * - read env
 * - print chosen config
 * - execute orchestrator
 *
 * The heavy logic (readiness, topology, loops, teardown) lives in ecology-orchestrator.js.
 */
async function main() {
  const defsDir = (process.env.ECO_DEFS_DIR || "").trim();
  const defsPack = (process.env.ECO_DEFS_PACK || process.env.ECO_PACK || "").trim();
  const packsDir = (process.env.ECO_DEFS_PACKS_DIR || process.env.ECO_PACKS_DIR || "").trim();
  const organismNames = listEnv("ECO_ORGANISMS");
  const ratifierNames = listEnv("ECO_RATIFIERS");

  const cfg = {
    durationMs: intEnv("ECO_DURATION_MS", 180_000, 1_000, 3_600_000),
    readyMs: intEnv("ECO_READY_MS", 45_000, 1_000, 300_000),
    stableMs: intEnv("ECO_STABLE_MS", 400, 50, 10_000),
    pulseAtRatio: floatEnv("ECO_PULSE_AT_RATIO", 0.6, 0.1, 0.95),
    metricsMs: intEnv("ECO_METRICS_MS", 5_000, 500, 60_000),
    tickMinMs: intEnv("ECO_TICK_MIN_MS", 250, 50, 30_000),
    tickMaxMs: intEnv("ECO_TICK_MAX_MS", 800, 50, 30_000),
    jobsPerConcern: intEnv("ECO_JOBS_PER_CONCERN", 3, 1, 100),
    concerns: intEnv("ECO_CONCERNS", 2, 1, 8),
    orgs: intEnv("ECO_ORGS", 3, 1, 8),
    storeRoot: process.env.ECO_STORE_ROOT || "./store/ecology",
    seedHex: readOrCreateSeed(),
    defsEnabled: boolEnv("ECO_DEFS", false) || Boolean(defsDir || defsPack || organismNames.length || ratifierNames.length),
    defsDir,
    defsPack,
    packsDir,
    organismNames,
    ratifierNames
  };

  console.log("[run-ecology] starting ecology demo");
  console.log("[run-ecology] config=", JSON.stringify(cfg));

  const result = await runEcologyOrchestrator(cfg);
  console.log("[run-ecology] completed", JSON.stringify(result));
}

function readOrCreateSeed() {
  const raw = (process.env.ECO_SEED || "").trim();
  if (/^[0-9a-fA-F]{64}$/.test(raw)) {
    return raw.toLowerCase();
  }
  if (raw) {
    // Non-hex seeds are hashed to fixed 32-byte material for deterministic runs.
    return crypto.createHash("sha256").update(raw).digest("hex");
  }
  const seed = crypto.randomBytes(32).toString("hex");
  console.log(`[run-ecology] ECO_SEED not provided, generated seed=${seed}`);
  return seed;
}

function intEnv(name, fallback, min, max) {
  const parsed = Number.parseInt(String(process.env[name] ?? ""), 10);
  const value = Number.isFinite(parsed) ? parsed : fallback;
  return Math.min(max, Math.max(min, value));
}

function floatEnv(name, fallback, min, max) {
  const parsed = Number.parseFloat(String(process.env[name] ?? ""));
  const value = Number.isFinite(parsed) ? parsed : fallback;
  return Math.min(max, Math.max(min, value));
}

function boolEnv(name, fallback = false) {
  const raw = String(process.env[name] ?? "").trim().toLowerCase();
  if (!raw) return fallback;
  if (raw === "1" || raw === "true" || raw === "yes" || raw === "on") return true;
  if (raw === "0" || raw === "false" || raw === "no" || raw === "off") return false;
  return fallback;
}

function listEnv(name) {
  const raw = String(process.env[name] ?? "").trim();
  if (!raw) return [];
  const items = [];
  for (const part of raw.split(",")) {
    const item = String(part || "").trim();
    if (item) items.push(item);
  }
  return items;
}

main().catch((err) => {
  console.error("[run-ecology] failed:", err?.stack || err?.message || err);
  process.exitCode = 1;
});
