#!/usr/bin/env node
import { spawn } from "child_process";
import { once } from "events";
import { mkdtemp, writeFile } from "fs/promises";
import os from "os";
import path from "path";
import crypto from "crypto";
import process from "process";
import Autobase from "autobase";
import idEncoding from "hypercore-id-encoding";

import { ensureCorestore } from "../src/ensureCorestore.js";
import { ensureConcernSurface } from "../src/concern.js";

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function createLineReader(prefix, onLine) {
  let carry = "";
  return (chunk) => {
    carry += chunk.toString("utf8");
    const lines = carry.split(/\r?\n/);
    carry = lines.pop() || "";
    for (const line of lines) {
      if (!line.trim()) continue;
      console.log(`${prefix} ${line}`);
      onLine?.(line);
    }
  };
}

function spawnService(label, args, env, onStdoutLine) {
  const child = spawn("node", args, {
    env,
    stdio: ["ignore", "pipe", "pipe"]
  });

  child.stdout.on("data", createLineReader(`[${label}]`, onStdoutLine));
  child.stderr.on("data", createLineReader(`[${label}:err]`));

  child.on("exit", (code, signal) => {
    console.log(`[${label}] exited code=${code} signal=${signal}`);
  });

  return child;
}

async function stopService(child, label) {
  if (!child || child.exitCode != null) return;
  child.kill("SIGTERM");
  const raced = await Promise.race([
    once(child, "exit").then(() => true),
    sleep(4_000).then(() => false)
  ]);
  if (!raced) {
    child.kill("SIGKILL");
    await once(child, "exit");
  }
  console.log(`[${label}] stopped`);
}

async function runCommand(args, env) {
  const child = spawn("node", args, { env, stdio: ["ignore", "pipe", "pipe"] });
  let stdout = "";
  let stderr = "";
  child.stdout.on("data", (d) => {
    stdout += d.toString("utf8");
  });
  child.stderr.on("data", (d) => {
    stderr += d.toString("utf8");
  });
  const [code] = await once(child, "exit");
  if (code !== 0) {
    throw new Error(`command failed: node ${args.join(" ")}\nstdout:\n${stdout}\nstderr:\n${stderr}`);
  }
  return { stdout, stderr };
}

async function prepareConcernStore(concernStoreDir) {
  const cs = ensureCorestore(concernStoreDir);
  await cs.ready?.();
  const swarm = {
    connections: new Set(),
    on() {},
    off() {}
  };
  const concern = await ensureConcernSurface(cs.namespace("mesh-concern-host-1"), swarm, {});
  const keyZ32 = idEncoding.encode(concern.key);
  await concern.close().catch(() => {});
  await cs.close?.().catch(() => {});
  return keyZ32;
}

async function getOperatorWriters(operatorStoreDir) {
  const cs = ensureCorestore(operatorStoreDir);
  await cs.ready?.();
  const discoveryWriter = await Autobase.getLocalKey(cs.namespace("mesh-operator-discovery"));
  const concernWriter = await Autobase.getLocalKey(cs.namespace("mesh-operator-concern"));
  await cs.close?.().catch(() => {});
  return {
    discoveryWriter: idEncoding.encode(discoveryWriter),
    concernWriter: idEncoding.encode(concernWriter)
  };
}

async function main() {
  const tmpRoot = await mkdtemp(path.join(os.tmpdir(), "mesh-smoke-"));
  const discoveryStore = path.join(tmpRoot, "discovery-store");
  const concernStore = path.join(tmpRoot, "concern-store");
  const operatorStore = path.join(tmpRoot, "operator-store");
  const observerStore = path.join(tmpRoot, "observer-store");
  const discoveryConfigPath = path.join(tmpRoot, "discovery-host.json");
  const concernConfigPath = path.join(tmpRoot, "concern-host.json");
  const topicZ32 = idEncoding.encode(crypto.randomBytes(32));

  const concernKeyZ32 = await prepareConcernStore(concernStore);
  const writers = await getOperatorWriters(operatorStore);

  console.log(`[smoke] tmpRoot=${tmpRoot}`);
  console.log(`[smoke] topic=${topicZ32}`);
  console.log(`[smoke] concern=${concernKeyZ32}`);

  let discoveryKeyZ32 = null;
  const discoveryHost = spawnService(
    "discovery-host",
    ["packages/hetzner-discovery-host/bin/discovery-host.js", "--create", "--config", discoveryConfigPath],
    {
      ...process.env,
      CORESTORE_DIR: discoveryStore,
      DISCOVERY_HOST_CONFIG: discoveryConfigPath,
      SWARM_TOPICS: topicZ32,
      DISCOVERY_WRITERS: writers.discoveryWriter,
      HEARTBEAT_MS: "10000"
    },
    (line) => {
      if (line.startsWith("DISCOVERY_KEY=")) {
        discoveryKeyZ32 = line.slice("DISCOVERY_KEY=".length).trim();
      }
    }
  );

  const startedAt = Date.now();
  while (!discoveryKeyZ32 && Date.now() - startedAt < 15_000) {
    await sleep(100);
  }
  if (!discoveryKeyZ32) throw new Error("discovery host did not publish DISCOVERY_KEY");

  const concernHost = spawnService(
    "concern-host",
    ["packages/hetzner-concern-host/bin/concern-host.js"],
    {
      ...process.env,
      CORESTORE_DIR: concernStore,
      CONCERN_HOST_CONFIG: concernConfigPath,
      CONCERNS: concernKeyZ32,
      SWARM_TOPICS: topicZ32,
      CONCERN_WRITERS: writers.concernWriter,
      HEARTBEAT_MS: "10000"
    }
  );

  await sleep(1500);

  const advertise = await runCommand(
    [
      "packages/mesh-operator-cli/bin/mesh.js",
      "discovery",
      "advertise-concern",
      "--discovery",
      discoveryKeyZ32,
      "--concern",
      concernKeyZ32,
      "--label",
      "smoke-concern"
    ],
    {
      ...process.env,
      CORESTORE_DIR: operatorStore,
      SWARM_TOPICS: topicZ32,
      OPERATOR_TIMEOUT_MS: "6000"
    }
  );
  console.log(`[smoke] advertise output:\n${advertise.stdout.trim()}`);

  const jobJsonPath = path.join(tmpRoot, "job.json");
  await writeFile(jobJsonPath, JSON.stringify({ cap: "cap/smoke/job", in: { hello: "mesh" } }, null, 2));

  const submit = await runCommand(
    [
      "packages/mesh-operator-cli/bin/mesh.js",
      "job",
      "submit",
      "--concern",
      concernKeyZ32,
      "--json",
      jobJsonPath
    ],
    {
      ...process.env,
      CORESTORE_DIR: operatorStore,
      SWARM_TOPICS: topicZ32,
      OPERATOR_TIMEOUT_MS: "6000"
    }
  );
  console.log(`[smoke] submit output:\n${submit.stdout.trim()}`);

  await sleep(2000);

  const status = await runCommand(
    [
      "packages/mesh-operator-cli/bin/mesh.js",
      "status",
      "--concern",
      concernKeyZ32
    ],
    {
      ...process.env,
      CORESTORE_DIR: observerStore,
      SWARM_TOPICS: topicZ32,
      OPERATOR_TIMEOUT_MS: "8000"
    }
  );
  console.log(`[smoke] status output:\n${status.stdout.trim()}`);

  const statusJson = JSON.parse(status.stdout);
  if (!(statusJson?.counts?.jobs > 0)) {
    throw new Error(`expected jobs > 0, got: ${status.stdout}`);
  }

  console.log("[smoke] PASS");

  await stopService(concernHost, "concern-host");
  await stopService(discoveryHost, "discovery-host");
}

main().catch(async (err) => {
  console.error(`[smoke] FAIL: ${err?.stack || err?.message || String(err)}`);
  process.exit(1);
});
