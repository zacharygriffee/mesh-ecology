#!/usr/bin/env node
import path from "path";
import { readdir } from "fs/promises";
import Corestore from "corestore";
import Hyperbee from "hyperbee";

const WORK_PREFIX = "work/";
const WORK_OPEN_PREFIX = "work-open/";
const WORKFLOW_STATE_CORE = "dx-workflow-state";

/**
 * Inspector note:
 * - This reads runner-local workflow persistence (`api.work` journal).
 * - It is not protocol truth; concern acceptance remains derived-view state.
 * - It is diagnostic-only, non-canonical, and not actor precedent.
 * - Do not use this as a pattern for cross-runtime truth acquisition.
 * - Use this to debug local scheduling/backoff and phase progression.
 */

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    printHelp();
    return;
  }

  const storeRoot = path.resolve(args.storeRoot || process.env.ECO_STORE_ROOT || "./store/ecology");
  const nowMs = Number.isFinite(args.nowMs) ? args.nowMs : Date.now();
  const limit = clampInt(args.limit, 1, 10_000, 50);

  const targets = await resolveTargets({ storeRoot, role: args.role, all: args.all });
  if (targets.length === 0) {
    if (args.json) {
      console.log(JSON.stringify({ storeRoot, nowMs, limit, roles: [] }, null, 2));
    } else {
      console.log(`[work] no matching role directories under ${storeRoot}`);
    }
    return;
  }

  const summaries = [];
  for (const target of targets) {
    const summary = await inspectRoleStore({ target, nowMs, limit });
    summaries.push(summary);
  }

  if (args.json) {
    console.log(JSON.stringify({ storeRoot, nowMs, limit, roles: summaries }, null, 2));
    return;
  }

  for (const summary of summaries) {
    printSummary(summary, nowMs, limit);
  }
}

function parseArgs(argv) {
  const out = {
    storeRoot: "",
    role: "",
    all: false,
    limit: 50,
    nowMs: NaN,
    json: false,
    help: false
  };

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--store-root") {
      out.storeRoot = String(argv[++i] || "");
      continue;
    }
    if (arg === "--role") {
      out.role = String(argv[++i] || "");
      continue;
    }
    if (arg === "--all") {
      out.all = true;
      continue;
    }
    if (arg === "--limit") {
      out.limit = Number.parseInt(String(argv[++i] || ""), 10);
      continue;
    }
    if (arg === "--now") {
      out.nowMs = Number.parseInt(String(argv[++i] || ""), 10);
      continue;
    }
    if (arg === "--json") {
      out.json = true;
      continue;
    }
    if (arg === "-h" || arg === "--help") {
      out.help = true;
      continue;
    }
    throw new Error(`unknown arg: ${arg}`);
  }

  if (!out.role && !out.all) out.all = true;
  return out;
}

function printHelp() {
  console.log(
    [
      "Usage: node scripts/inspect-work.js [options]",
      "Diagnostic-only helper for one runtime's local work journal.",
      "Not protocol truth. Not canonical actor precedent.",
      "",
      "Options:",
      "  --store-root <path>  Store root (default: ECO_STORE_ROOT or ./store/ecology)",
      "  --role <name>         Single role dir (e.g. org-B, rat-A)",
      "  --all                 Inspect all known role dirs under store root (default if --role not set)",
      "  --limit <n>           Sample size per role (default: 50)",
      "  --now <ms>            Override current time for due-now checks",
      "  --json                Emit JSON summary",
      "  -h, --help            Show help"
    ].join("\n")
  );
}

async function resolveTargets({ storeRoot, role, all }) {
  if (role) {
    const roleDir = String(role).trim();
    if (!roleDir) return [];
    return [{
      roleDir,
      storePath: path.join(storeRoot, roleDir),
      runnerRole: inferRunnerRole(roleDir)
    }];
  }

  if (!all) return [];

  const entries = await readdir(storeRoot, { withFileTypes: true }).catch(() => []);
  const targets = [];
  for (const entry of entries) {
    if (!entry?.isDirectory?.()) continue;
    const roleDir = String(entry.name || "");
    if (!isKnownRoleDir(roleDir)) continue;
    targets.push({
      roleDir,
      storePath: path.join(storeRoot, roleDir),
      runnerRole: inferRunnerRole(roleDir)
    });
  }
  targets.sort((a, b) => a.roleDir.localeCompare(b.roleDir));
  return targets;
}

function isKnownRoleDir(name) {
  return name === "host" || name === "discovery" || name.startsWith("org-") || name.startsWith("rat-");
}

function inferRunnerRole(roleDir) {
  if (roleDir.startsWith("org-")) return "org";
  if (roleDir.startsWith("rat-")) return "ratifier";
  if (roleDir === "host") return "host";
  if (roleDir === "discovery") return "discovery";
  return null;
}

async function inspectRoleStore({ target, nowMs, limit }) {
  const summary = {
    role: target.roleDir,
    runnerRole: target.runnerRole,
    storePath: target.storePath,
    namespace: target.runnerRole ? `${target.runnerRole}-state` : null,
    workflowCoreName: WORKFLOW_STATE_CORE,
    workflowAvailable: false,
    missingReason: null,
    indexSource: "work-open-index",
    totalWorkKeys: 0,
    totalWorkOpenKeys: 0,
    staleWorkOpenKeys: 0,
    openItems: 0,
    dueNow: 0,
    phases: {},
    nextRunAtMs: { p50: null, p95: null },
    sample: []
  };

  let store = null;
  let bee = null;

  try {
    store = new Corestore(target.storePath);
    await store.ready?.();

    if (!target.runnerRole) {
      summary.missingReason = "unknown-runner-role";
      return summary;
    }

    const nsStore = store.namespace(`${target.runnerRole}-state`);
    await nsStore.ready?.();
    const alias = await store.storage.getAlias({
      name: WORKFLOW_STATE_CORE,
      namespace: nsStore.ns
    }).catch(() => null);

    if (!alias) {
      summary.missingReason = "missing-workflow-state-core";
      return summary;
    }

    const core = nsStore.get({ discoveryKey: alias, createIfMissing: false });
    bee = new Hyperbee(core, { keyEncoding: "utf-8", valueEncoding: "json", extension: false });
    await bee.ready?.();

    summary.workflowAvailable = true;
    const metrics = await collectWorkMetrics({ bee, nowMs, limit });
    Object.assign(summary, metrics);
    return summary;
  } catch (err) {
    summary.missingReason = err?.message || String(err);
    return summary;
  } finally {
    await bee?.close?.().catch(() => {});
    await store?.close?.().catch(() => {});
  }
}

async function collectWorkMetrics({ bee, nowMs, limit }) {
  let totalWorkKeys = 0;
  const fallbackOpen = [];

  for await (const entry of bee.createReadStream({ gte: WORK_PREFIX, lt: `${WORK_PREFIX}\uffff` })) {
    totalWorkKeys += 1;
    const item = normalizeWorkItem(entry?.value ?? entry);
    if (item && item.status === "open") fallbackOpen.push(item);
  }

  let totalWorkOpenKeys = 0;
  let staleWorkOpenKeys = 0;
  let dueNow = 0;
  const openItemsFromIndex = [];
  const phasesFromIndex = {};

  for await (const entry of bee.createReadStream({ gte: WORK_OPEN_PREFIX, lt: `${WORK_OPEN_PREFIX}\uffff` })) {
    totalWorkOpenKeys += 1;
    const parsed = parseOpenKey(entry?.key);
    if (!parsed) {
      staleWorkOpenKeys += 1;
      continue;
    }

    if (parsed.nextRunAtMs <= nowMs) dueNow += 1;
    const node = await bee.get(workKey(parsed));
    const item = normalizeWorkItem(node?.value ?? node);
    if (!item || item.status !== "open") {
      staleWorkOpenKeys += 1;
      continue;
    }

    openItemsFromIndex.push(item);
    phasesFromIndex[item.phase] = (phasesFromIndex[item.phase] || 0) + 1;
  }

  let indexSource = "work-open-index";
  let openItems = openItemsFromIndex;
  let phases = phasesFromIndex;

  if (openItemsFromIndex.length === 0 && fallbackOpen.length > 0) {
    indexSource = "work-scan-fallback";
    openItems = fallbackOpen;
    dueNow = fallbackOpen.filter((x) => x.nextRunAtMs <= nowMs).length;
    phases = countPhases(fallbackOpen);
  }

  openItems.sort(sortWorkItems);
  const nextRunVals = openItems.map((x) => x.nextRunAtMs);

  return {
    indexSource,
    totalWorkKeys,
    totalWorkOpenKeys,
    staleWorkOpenKeys,
    openItems: openItems.length,
    dueNow,
    phases,
    nextRunAtMs: {
      p50: percentile(nextRunVals, 0.5),
      p95: percentile(nextRunVals, 0.95)
    },
    sample: openItems.slice(0, limit).map((item) => ({
      nextRunAtMs: item.nextRunAtMs,
      dueNow: item.nextRunAtMs <= nowMs,
      phase: item.phase,
      attempts: item.attempts,
      concernKey: item.concernKey,
      jobKey: item.jobKey,
      id: item.id
    }))
  };
}

function normalizeWorkItem(raw) {
  if (!raw || typeof raw !== "object") return null;
  const concernKey = String(raw.concernKey || "").trim();
  const jobKey = String(raw.jobKey || "").trim();
  const id = String(raw.id || "").trim();
  if (!concernKey || !jobKey || !id) return null;

  const nextRunAtMs = asMs(raw.nextRunAtMs, 0);
  const attempts = asMs(raw.attempts, 0);
  const phase = String(raw.phase || "unknown");
  const status = String(raw.status || "open");

  return {
    concernKey,
    jobKey,
    id,
    nextRunAtMs,
    attempts,
    phase,
    status
  };
}

function parseOpenKey(key) {
  const raw = String(key || "");
  if (!raw.startsWith(WORK_OPEN_PREFIX)) return null;
  const parts = raw.split("/");
  if (parts.length !== 5) return null;
  const [, nextRunRaw, concernKey, jobKey, id] = parts;
  const nextRunAtMs = Number.parseInt(nextRunRaw, 10);
  if (!Number.isFinite(nextRunAtMs)) return null;
  if (!concernKey || !jobKey || !id) return null;
  return { concernKey, jobKey, id, nextRunAtMs };
}

function workKey(openIdx) {
  return `${WORK_PREFIX}${openIdx.concernKey}/${openIdx.jobKey}/${openIdx.id}`;
}

function sortWorkItems(a, b) {
  if (a.nextRunAtMs !== b.nextRunAtMs) return a.nextRunAtMs - b.nextRunAtMs;
  const ca = `${a.concernKey}/${a.jobKey}/${a.id}`;
  const cb = `${b.concernKey}/${b.jobKey}/${b.id}`;
  return ca.localeCompare(cb);
}

function percentile(values, p) {
  if (!values.length) return null;
  const idx = Math.min(values.length - 1, Math.max(0, Math.floor((values.length - 1) * p)));
  return values[idx];
}

function countPhases(items) {
  const out = {};
  for (const item of items) {
    const phase = item.phase || "unknown";
    out[phase] = (out[phase] || 0) + 1;
  }
  return out;
}

function asMs(input, fallback = 0) {
  const n = Number(input);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(0, Math.trunc(n));
}

function clampInt(input, min, max, fallback) {
  const n = Number.parseInt(String(input ?? ""), 10);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, n));
}

function shortToken(value, head = 6, tail = 6) {
  const raw = String(value || "");
  if (!raw) return "-";
  if (raw.length <= head + tail + 1) return raw;
  return `${raw.slice(0, head)}..${raw.slice(-tail)}`;
}

function formatPhases(phases) {
  const keys = Object.keys(phases || {}).sort();
  if (!keys.length) return "{}";
  const body = keys.map((k) => `${k}:${phases[k]}`).join(",");
  return `{${body}}`;
}

function formatMs(ms) {
  if (!Number.isFinite(ms)) return "-";
  return String(ms);
}

function printSummary(summary, nowMs, limit) {
  if (!summary.workflowAvailable) {
    console.log(
      `[work] role=${summary.role} workflow=missing reason=${summary.missingReason || "n/a"} namespace=${summary.namespace || "n/a"}`
    );
    return;
  }

  console.log(
    `[work] role=${summary.role} openItems=${summary.openItems} dueNow=${summary.dueNow} phases=${formatPhases(summary.phases)} nextRunAt(p50/p95)=${formatMs(summary.nextRunAtMs.p50)}/${formatMs(summary.nextRunAtMs.p95)} totalWork=${summary.totalWorkKeys} totalWorkOpen=${summary.totalWorkOpenKeys} staleOpen=${summary.staleWorkOpenKeys} source=${summary.indexSource}`
  );

  const sample = summary.sample || [];
  if (sample.length === 0) {
    console.log(`[work] role=${summary.role} sample=empty`);
    return;
  }

  console.log(`nextRun\tphase\tattempts\tconcern/job\tid (top ${Math.min(limit, sample.length)})`);
  for (const row of sample) {
    const next = row.nextRunAtMs <= nowMs ? "due" : String(row.nextRunAtMs);
    const concernJob = `${shortToken(row.concernKey)}/${shortToken(row.jobKey)}`;
    const line = `${next}\t${row.phase}\t${row.attempts}\t${concernJob}\t${shortToken(row.id, 8, 4)}`;
    console.log(line);
  }
}

main().catch((err) => {
  console.error("[inspect-work] failed:", err?.stack || err?.message || err);
  process.exitCode = 1;
});
