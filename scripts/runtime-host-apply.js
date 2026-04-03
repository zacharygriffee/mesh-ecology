#!/usr/bin/env node
import { writeSync } from "fs";
import { mkdir, readFile, writeFile } from "fs/promises";
import path from "path";
import process from "process";
import { normalizeRuntimeHostSpec, resolveInstallPath } from "../src/util/runtime-host-spec.js";

function parseArgs(argv) {
  const out = {
    specPath: "",
    rootDir: "/",
    repoRoot: ""
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
    if (part === "--repo-root") {
      out.repoRoot = argv[i + 1] || "";
      i += 1;
      continue;
    }
    if (part === "-h" || part === "--help") {
      writeSync(process.stdout.fd, [
        "Usage: runtime-host-apply --spec <path> [--root /] [--repo-root /path/to/repo]",
        "",
        "Materializes runtime-owned host config, systemd units, and directories.",
        "This is an apply primitive only; it does not run systemctl or perform rollout steps."
      ].join("\n") + "\n");
      process.exit(0);
    }
    throw new Error(`unknown argument: ${part}`);
  }

  if (!out.specPath) throw new Error("--spec is required");
  return out;
}

async function readJson(filePath) {
  const raw = await readFile(filePath, "utf8");
  return JSON.parse(raw);
}

async function renderUnit(repoRoot, relPath) {
  const templatePath = path.resolve(repoRoot, relPath);
  const raw = await readFile(templatePath, "utf8");
  return raw.replace(/__MESH_REPO__/g, repoRoot);
}

async function writeJson(filePath, value) {
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`);
}

async function writeText(filePath, value) {
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(filePath, value);
}

async function ensureDir(filePath) {
  await mkdir(filePath, { recursive: true });
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const raw = await readJson(path.resolve(args.specPath));
  const spec = normalizeRuntimeHostSpec(raw, { repoRoot: args.repoRoot || undefined });

  const summary = {
    ok: true,
    action: "runtime-host-apply",
    version: spec.version,
    rootDir: path.resolve(args.rootDir),
    repoRoot: spec.repoRoot,
    written: {
      dirs: [],
      files: []
    }
  };

  const configDir = resolveInstallPath(args.rootDir, spec.paths.configDir);
  const dataDir = resolveInstallPath(args.rootDir, spec.paths.dataDir);
  const systemdDir = resolveInstallPath(args.rootDir, spec.paths.systemdDir);

  for (const dirPath of [configDir, dataDir, systemdDir]) {
    await ensureDir(dirPath);
    summary.written.dirs.push(dirPath);
  }

  const discoveryDataDir = resolveInstallPath(args.rootDir, path.posix.join(spec.paths.dataDir, "discovery"));
  const concernDataDir = resolveInstallPath(args.rootDir, path.posix.join(spec.paths.dataDir, "concern"));
  for (const dirPath of [discoveryDataDir, concernDataDir]) {
    await ensureDir(dirPath);
    summary.written.dirs.push(dirPath);
  }

  const discoveryUnitPath = resolveInstallPath(args.rootDir, path.posix.join(spec.paths.systemdDir, "mesh-discovery-host.service"));
  const concernUnitPath = resolveInstallPath(args.rootDir, path.posix.join(spec.paths.systemdDir, "mesh-concern-host.service"));
  await writeText(discoveryUnitPath, await renderUnit(spec.repoRoot, "deploy/systemd/mesh-discovery-host.service"));
  await writeText(concernUnitPath, await renderUnit(spec.repoRoot, "deploy/systemd/mesh-concern-host.service"));
  summary.written.files.push(discoveryUnitPath, concernUnitPath);

  if (spec.discoveryHost) {
    const out = {
      corestoreDir: spec.discoveryHost.config.corestoreDir,
      discoveryKey: spec.discoveryHost.config.discoveryKey,
      discoveryCreate: spec.discoveryHost.config.discoveryCreate,
      swarmTopics: spec.discoveryHost.config.swarmTopics,
      swarmBootstrap: spec.discoveryHost.config.swarmBootstrap,
      swarmSeedHex: spec.discoveryHost.config.swarmSeedHex,
      discoveryWriters: spec.discoveryHost.config.discoveryWriters,
      updateIntervalMs: spec.discoveryHost.config.updateIntervalMs,
      heartbeatMs: spec.discoveryHost.config.heartbeatMs
    };
    const target = resolveInstallPath(args.rootDir, spec.discoveryHost.configPath);
    await writeJson(target, out);
    summary.written.files.push(target);
  }

  if (spec.concernHost) {
    const out = {
      corestoreDir: spec.concernHost.config.corestoreDir,
      concernKeys: spec.concernHost.config.concernKeys,
      swarmTopics: spec.concernHost.config.swarmTopics,
      swarmBootstrap: spec.concernHost.config.swarmBootstrap,
      swarmSeedHex: spec.concernHost.config.swarmSeedHex,
      concernWriters: spec.concernHost.config.concernWriters,
      validation: spec.concernHost.config.validation,
      updateIntervalMs: spec.concernHost.config.updateIntervalMs,
      heartbeatMs: spec.concernHost.config.heartbeatMs
    };
    const target = resolveInstallPath(args.rootDir, spec.concernHost.configPath);
    await writeJson(target, out);
    summary.written.files.push(target);
  }

  writeSync(process.stdout.fd, `${JSON.stringify(summary, null, 2)}\n`);
}

main().catch((err) => {
  console.error(`[runtime-host-apply] failed: ${err?.stack || err?.message || err}`);
  process.exitCode = 1;
});
