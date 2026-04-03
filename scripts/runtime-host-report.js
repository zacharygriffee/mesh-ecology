#!/usr/bin/env node
import { writeSync } from "fs";
import { access, readFile } from "fs/promises";
import path from "path";
import process from "process";
import idEncoding from "hypercore-id-encoding";
import { ensureCorestore } from "../src/ensureCorestore.js";
import { ensureDiscoverySurface } from "../src/discovery.js";
import { ensureConcernSurface, getJobView, getPublishView, getRatView } from "../src/concern.js";
import { normalizeRuntimeHostSpec, resolveInstallPath } from "../src/util/runtime-host-spec.js";

const NULL_SWARM = {
  connections: [],
  on() {},
  off() {}
};

function parseArgs(argv) {
  const out = {
    specPath: "",
    rootDir: "/"
  };

  for (let i = 0; i < argv.length; i++) {
    const part = argv[i];
    if (part === "--spec") {
      out.specPath = argv[i + 1] || "";
      i += 1;
      continue;
    }
    if (part === "--root") {
      out.rootDir = argv[i + 1] || "/";
      i += 1;
      continue;
    }
    if (part === "-h" || part === "--help") {
      writeSync(process.stdout.fd, [
        "Usage: runtime-host-report --spec <path> [--root /]",
        "",
        "Emits machine-readable runtime host facts from the supported host spec.",
        "Reports bounded runtime facts only; no remediation or rollout guidance."
      ].join("\n") + "\n");
      process.exit(0);
    }
    throw new Error(`unknown argument: ${part}`);
  }

  if (!out.specPath) throw new Error("--spec is required");
  return out;
}

async function exists(filePath) {
  try {
    await access(filePath);
    return true;
  } catch {
    return false;
  }
}

async function readJsonIfPresent(filePath) {
  if (!(await exists(filePath))) return null;
  const raw = await readFile(filePath, "utf8");
  return JSON.parse(raw);
}

async function countEntries(view) {
  let count = 0;
  for await (const _entry of view.createReadStream()) count += 1;
  return count;
}

async function inspectDiscoveryHost(spec, rootDir) {
  const configPath = resolveInstallPath(rootDir, spec.discoveryHost.configPath);
  const unitPath = resolveInstallPath(rootDir, spec.discoveryHost.unitPath);
  const config = await readJsonIfPresent(configPath);
  const dataDir = resolveInstallPath(rootDir, spec.discoveryHost.config.corestoreDir);

  const report = {
    configured: true,
    configPath,
    unitPath,
    dataDir,
    configPresent: !!config,
    unitPresent: await exists(unitPath),
    mode: config?.discoveryKey ? "mirror" : (config?.discoveryCreate ? "create" : "unknown"),
    configuredKey: config?.discoveryKey || null,
    configuredWriters: config?.discoveryWriters || [],
    readinessState: "not_checked",
    visibilityState: "unavailable",
    writable: null,
    localEntries: null,
    localKey: null
  };

  if (!config) return report;

  const corestore = ensureCorestore(dataDir);
  try {
    await corestore.ready?.();
    const discovery = await ensureDiscoverySurface(corestore.namespace("mesh-discovery-host"), config.discoveryKey ? {
      key: idEncoding.decode(config.discoveryKey)
    } : {});
    await discovery.update().catch(() => {});

    report.readinessState = "opened";
    report.visibilityState = "opened";
    report.writable = !!discovery.writable;
    report.localEntries = await countEntries(discovery.view);
    report.localKey = idEncoding.encode(discovery.key);

    await discovery.close().catch(() => {});
  } catch (err) {
    const message = err?.message || String(err);
    report.readinessState = /locked/i.test(message) ? "store_locked" : "open_error";
    report.openError = err?.message || String(err);
  } finally {
    await corestore.close?.().catch(() => {});
  }

  return report;
}

async function inspectConcernHost(spec, rootDir) {
  const configPath = resolveInstallPath(rootDir, spec.concernHost.configPath);
  const unitPath = resolveInstallPath(rootDir, spec.concernHost.unitPath);
  const config = await readJsonIfPresent(configPath);
  const dataDir = resolveInstallPath(rootDir, spec.concernHost.config.corestoreDir);

  const report = {
    configured: true,
    configPath,
    unitPath,
    dataDir,
    configPresent: !!config,
    unitPresent: await exists(unitPath),
    readinessState: "not_checked",
    configuredKeys: config?.concernKeys || [],
    configuredWriters: config?.concernWriters || [],
    concerns: []
  };

  if (!config) return report;

  const corestore = ensureCorestore(dataDir);
  try {
    await corestore.ready?.();
    report.readinessState = "opened";
    for (let i = 0; i < config.concernKeys.length; i++) {
      const concernKey = config.concernKeys[i];
      const item = {
        concernKey,
        readinessState: "not_checked",
        visibilityState: "unavailable",
        writable: null,
        counts: null
      };
      try {
        const concern = await ensureConcernSurface(
          corestore.namespace(`mesh-concern-host-${i + 1}`),
          NULL_SWARM,
          { key: idEncoding.decode(concernKey) }
        );
        await concern.update({ wait: false }).catch(() => {});
        item.readinessState = "opened";
        item.visibilityState = "opened";
        item.writable = !!concern.writable;
        item.counts = {
          jobs: await countEntries(getJobView(concern)),
          publish: await countEntries(getPublishView(concern)),
          ratify: await countEntries(getRatView(concern))
        };
        await concern.close().catch(() => {});
      } catch (err) {
        item.readinessState = "open_error";
        item.openError = err?.message || String(err);
      }
      report.concerns.push(item);
    }
  } catch (err) {
    const message = err?.message || String(err);
    report.readinessState = /locked/i.test(message) ? "store_locked" : "open_error";
    report.openError = message;
  } finally {
    await corestore.close?.().catch(() => {});
  }

  return report;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const raw = JSON.parse(await readFile(path.resolve(args.specPath), "utf8"));
  const spec = normalizeRuntimeHostSpec(raw);

  const out = {
    ok: true,
    action: "runtime-host-report",
    version: spec.version,
    rootDir: path.resolve(args.rootDir),
    repoRoot: spec.repoRoot,
    paths: spec.paths,
    discoveryHost: spec.discoveryHost ? await inspectDiscoveryHost(spec, args.rootDir) : { configured: false },
    concernHost: spec.concernHost ? await inspectConcernHost(spec, args.rootDir) : { configured: false }
  };

  writeSync(process.stdout.fd, `${JSON.stringify(out, null, 2)}\n`);
}

main().catch((err) => {
  console.error(`[runtime-host-report] failed: ${err?.stack || err?.message || err}`);
  process.exitCode = 1;
});
