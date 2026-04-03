#!/usr/bin/env node
import { writeSync } from "fs";
import { access, readFile } from "fs/promises";
import { setTimeout as delay } from "timers/promises";
import path from "path";
import process from "process";
import Hyperswarm from "hyperswarm";
import idEncoding from "hypercore-id-encoding";

import { ensureCorestore } from "../../../src/ensureCorestore.js";
import {
  ensureDiscoverySurface,
  addConcern,
  addDiscovery,
  addWriter as addDiscoveryWriter
} from "../../../src/discovery.js";
import {
  ensureConcernSurface,
  createJob,
  getJobView,
  getPublishView,
  getRatView
} from "../../../src/concern.js";
import { defaultTopics } from "../../../src/util/createKeyPair.js";
import { normalizeOperatorCliConfig } from "../../../src/util/runtime-host-config.js";
import { waitForDurability } from "../lib/waitForDurability.js";

const DEFAULT_CONFIG_PATH = "/etc/mesh/operator-cli.json";
const DEFAULT_CORESTORE_DIR = "./store/operator-cli";
const DEFAULT_TOPIC_Z32 = idEncoding.encode(defaultTopics(1)[0]);
const DEFAULT_TIMEOUT_MS = 15_000;

function printHelp() {
  writeSync(process.stdout.fd, [
    "mesh discovery advertise-concern --discovery <z32> --concern <z32> [--label text] [--wait|--no-wait] [--min-peers n] [--timeout-ms n] [--config path]",
    "mesh discovery advertise-discovery --discovery <z32> --nested <z32> [--label text] [--wait|--no-wait] [--min-peers n] [--timeout-ms n] [--config path]",
    "mesh discovery add-writer --discovery <z32> --writer <z32> [--wait|--no-wait] [--min-peers n] [--timeout-ms n] [--config path]",
    "mesh job submit --concern <z32> --json <path> [--wait|--no-wait] [--min-peers n] [--timeout-ms n] [--config path]",
    "mesh status --concern <z32> [--config path]",
    "",
    "Control-plane note:",
    "  For normal operator workflows, prefer mesh-ecology-packs live:ctl.",
    "  Use this CLI for compatibility and narrow stateless authority writes.",
    "",
    "Write durability flags:",
    "  --wait / --no-wait          default: --wait",
    "  --min-peers <n>             default: 1",
    "  --timeout-ms <n>            default: OPERATOR_TIMEOUT_MS/config timeout",
    "",
    "Environment overrides:",
    "  CORESTORE_DIR=./store/operator-cli",
    "  SWARM_TOPICS=<z32,z32,...>",
    "  SWARM_BOOTSTRAP=<host:port,host:port,...>",
    "  SWARM_SEED_HEX=<64-hex-bytes>",
    "  OPERATOR_TIMEOUT_MS=15000"
  ].join("\n") + "\n");
}

function parseArgs(argv) {
  if (argv.length === 0 || argv[0] === "-h" || argv[0] === "--help") {
    return { command: "help", flags: {} };
  }

  let command = "";
  let rest = [];
  if (argv[0] === "discovery" && argv[1] === "advertise-concern") {
    command = "discovery advertise-concern";
    rest = argv.slice(2);
  } else if (argv[0] === "discovery" && argv[1] === "advertise-discovery") {
    command = "discovery advertise-discovery";
    rest = argv.slice(2);
  } else if (argv[0] === "discovery" && argv[1] === "add-writer") {
    command = "discovery add-writer";
    rest = argv.slice(2);
  } else if (argv[0] === "job" && argv[1] === "submit") {
    command = "job submit";
    rest = argv.slice(2);
  } else if (argv[0] === "status") {
    command = "status";
    rest = argv.slice(1);
  } else {
    throw new Error(`unsupported command: ${argv.join(" ")}`);
  }

  const flags = {};

  for (let i = 0; i < rest.length; i++) {
    const part = rest[i];
    if (!part.startsWith("--")) throw new Error(`unexpected argument: ${part}`);
    if (part === "--wait") {
      flags.wait = true;
      continue;
    }
    if (part === "--no-wait") {
      flags.wait = false;
      continue;
    }
    const key = part.slice(2);
    const value = rest[i + 1];
    if (value == null || value.startsWith("--")) throw new Error(`missing value for --${key}`);
    flags[key] = value;
    i += 1;
  }

  return { command, flags };
}

async function loadJsonIfPresent(filePath) {
  if (!filePath) return {};
  try {
    await access(filePath);
  } catch {
    return {};
  }
  const raw = await readFile(filePath, "utf8");
  if (!raw.trim()) return {};
  const parsed = JSON.parse(raw);
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error(`config must be an object: ${filePath}`);
  }
  return parsed;
}

function toPositiveInt(value, fallback) {
  const n = Number(value);
  if (!Number.isFinite(n) || n <= 0) return fallback;
  return Math.floor(n);
}

function normalizeConfig({ fileConfig, env }) {
  return normalizeOperatorCliConfig({
    fileConfig,
    env,
    defaultCorestoreDir: DEFAULT_CORESTORE_DIR,
    defaultTopicZ32: DEFAULT_TOPIC_Z32,
    defaultTimeoutMs: DEFAULT_TIMEOUT_MS
  });
}

async function createSwarm(config) {
  const swarmOptions = {};
  if (config.swarmSeed) swarmOptions.seed = config.swarmSeed;

  if (config.swarmBootstrap.length > 0) {
    const mod = await import("hyperdht");
    const DHT = mod.default;
    swarmOptions.dht = new DHT({ bootstrap: config.swarmBootstrap });
  }

  return new Hyperswarm(swarmOptions);
}

async function closeSwarm(swarm) {
  if (!swarm) return;
  if (typeof swarm.close === "function") {
    await swarm.close().catch(() => {});
    return;
  }
  if (typeof swarm.destroy === "function") {
    const out = swarm.destroy();
    if (out && typeof out.then === "function") {
      await out.catch(() => {});
    }
  }
}

async function waitForSync(base, timeoutMs) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    await base.update({ wait: false }).catch(() => {});
    await delay(250);
  }
}

async function waitUntilWritable(base, timeoutMs) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    await base.update({ wait: false }).catch(() => {});
    if (base.writable) return true;
    await delay(250);
  }
  return !!base.writable;
}

function resolveDurabilityOptions(flags, config) {
  return {
    wait: flags.wait !== false,
    minPeers: toPositiveInt(flags["min-peers"], 1),
    timeoutMs: toPositiveInt(flags["timeout-ms"], config.timeoutMs)
  };
}

async function runDurabilityBarrier(core, targetLength, options) {
  if (!options.wait) {
    console.log("durability: skipped");
    return { met: false, skipped: true };
  }

  try {
    const status = await waitForDurability(core, targetLength, options);
    console.log("durability: met");
    return status;
  } catch (err) {
    if (err?.code === "DURABILITY_TIMEOUT") {
      console.log("durability: timeout");
    }
    throw err;
  }
}

async function countView(view) {
  let count = 0;
  for await (const _entry of view.createReadStream()) count += 1;
  return count;
}

async function withRuntime(config, fn) {
  const corestore = ensureCorestore(config.corestoreDir);
  if (typeof corestore.ready === "function") await corestore.ready();
  const swarm = await createSwarm(config);

  const joined = new Map();
  const joinTopic = (topicBuf, reason) => {
    const z32 = idEncoding.encode(topicBuf);
    if (joined.has(z32)) return;
    joined.set(z32, swarm.join(topicBuf, { server: true, client: true }));
    console.error(`[mesh] joined topic=${z32} reason=${reason}`);
  };

  try {
    for (const topicZ32 of config.swarmTopics) {
      joinTopic(idEncoding.decode(topicZ32), "config");
    }
    await fn({ corestore, swarm, joinTopic });
  } finally {
    for (const handle of joined.values()) {
      await handle.destroy().catch(() => {});
    }
    await closeSwarm(swarm);
    await corestore.close?.().catch(() => {});
  }
}

async function cmdAdvertiseConcern({ flags, config }) {
  const discoveryKey = flags.discovery;
  const concernKey = flags.concern;
  const label = flags.label || "";
  const durability = resolveDurabilityOptions(flags, config);

  if (!discoveryKey) throw new Error("--discovery is required");
  if (!concernKey) throw new Error("--concern is required");

  await withRuntime(config, async ({ corestore, swarm, joinTopic }) => {
    const discoveryKeyBuf = idEncoding.decode(discoveryKey);
    joinTopic(discoveryKeyBuf, "discovery-key");

    const discovery = await ensureDiscoverySurface(
      corestore.namespace("mesh-operator-discovery"),
      { key: discoveryKeyBuf },
      swarm
    );

    await waitUntilWritable(discovery, config.timeoutMs);

    if (!discovery.writable) {
      const writer = idEncoding.encode(discovery.local.key);
      throw new Error(
        `discovery is not writable from this operator corestore. local writer=${writer} (admit this key on writable discovery host via DISCOVERY_WRITERS)`
      );
    }

    await addConcern(discovery, concernKey, label);
    await discovery.update({ wait: true }).catch(() => {});
    const targetLength = discovery.local.length;
    await runDurabilityBarrier(discovery.local, targetLength, durability);

    console.log(JSON.stringify({
      ok: true,
      action: "advertise-concern",
      discovery: idEncoding.encode(discovery.key),
      concern: concernKey,
      label,
      targetLength
    }, null, 2));

    await discovery.close().catch(() => {});
  });
}

async function cmdAdvertiseDiscovery({ flags, config }) {
  const discoveryKey = flags.discovery;
  const nestedKey = flags.nested;
  const label = flags.label || "";
  const durability = resolveDurabilityOptions(flags, config);

  if (!discoveryKey) throw new Error("--discovery is required");
  if (!nestedKey) throw new Error("--nested is required");

  await withRuntime(config, async ({ corestore, swarm, joinTopic }) => {
    const discoveryKeyBuf = idEncoding.decode(discoveryKey);
    joinTopic(discoveryKeyBuf, "discovery-key");

    const discovery = await ensureDiscoverySurface(
      corestore.namespace("mesh-operator-discovery"),
      { key: discoveryKeyBuf },
      swarm
    );

    await waitUntilWritable(discovery, config.timeoutMs);

    if (!discovery.writable) {
      const writer = idEncoding.encode(discovery.local.key);
      throw new Error(
        `discovery is not writable from this operator corestore. local writer=${writer} (admit this key on writable discovery host via DISCOVERY_WRITERS)`
      );
    }

    await addDiscovery(discovery, nestedKey, label);
    await discovery.update({ wait: true }).catch(() => {});
    const targetLength = discovery.local.length;
    await runDurabilityBarrier(discovery.local, targetLength, durability);

    console.log(JSON.stringify({
      ok: true,
      action: "advertise-discovery",
      discovery: idEncoding.encode(discovery.key),
      nested: nestedKey,
      label,
      targetLength
    }, null, 2));

    await discovery.close().catch(() => {});
  });
}

async function cmdDiscoveryAddWriter({ flags, config }) {
  const discoveryKey = flags.discovery;
  const writerKey = flags.writer;
  const durability = resolveDurabilityOptions(flags, config);

  if (!discoveryKey) throw new Error("--discovery is required");
  if (!writerKey) throw new Error("--writer is required");

  await withRuntime(config, async ({ corestore, swarm, joinTopic }) => {
    const discoveryKeyBuf = idEncoding.decode(discoveryKey);
    joinTopic(discoveryKeyBuf, "discovery-key");

    const discovery = await ensureDiscoverySurface(
      corestore.namespace("mesh-operator-discovery"),
      { key: discoveryKeyBuf },
      swarm
    );

    await waitUntilWritable(discovery, config.timeoutMs);

    if (!discovery.writable) {
      const writer = idEncoding.encode(discovery.local.key);
      throw new Error(
        `discovery is not writable from this operator corestore. local writer=${writer} (admit this key on writable discovery host via DISCOVERY_WRITERS)`
      );
    }

    await addDiscoveryWriter(discovery, writerKey);
    await discovery.update({ wait: true }).catch(() => {});
    const targetLength = discovery.local.length;
    await runDurabilityBarrier(discovery.local, targetLength, durability);

    console.log(JSON.stringify({
      ok: true,
      action: "discovery-add-writer",
      discovery: idEncoding.encode(discovery.key),
      writer: writerKey,
      targetLength
    }, null, 2));

    await discovery.close().catch(() => {});
  });
}

function shapeJobPayload(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return {
      cap: "cap/operator/submit",
      in: value
    };
  }

  if (typeof value.cap === "string" && Object.prototype.hasOwnProperty.call(value, "in")) {
    return {
      cap: value.cap,
      in: value.in
    };
  }

  return {
    cap: typeof value.cap === "string" ? value.cap : "cap/operator/submit",
    in: value
  };
}

async function cmdJobSubmit({ flags, config }) {
  const concernKey = flags.concern;
  const jsonPath = flags.json;
  const durability = resolveDurabilityOptions(flags, config);
  if (!concernKey) throw new Error("--concern is required");
  if (!jsonPath) throw new Error("--json is required");

  const jsonRaw = await readFile(path.resolve(jsonPath), "utf8");
  const parsed = JSON.parse(jsonRaw);
  const payload = shapeJobPayload(parsed);

  await withRuntime(config, async ({ corestore, swarm, joinTopic }) => {
    const concernKeyBuf = idEncoding.decode(concernKey);
    joinTopic(concernKeyBuf, "concern-key");

    const concern = await ensureConcernSurface(
      corestore.namespace("mesh-operator-concern"),
      swarm,
      { key: concernKeyBuf }
    );

    await waitUntilWritable(concern, config.timeoutMs);

    if (!concern.writable) {
      const writer = idEncoding.encode(concern.local.key);
      throw new Error(
        `concern is not writable from this operator corestore. local writer=${writer} (admit this key on writable concern host via CONCERN_WRITERS)`
      );
    }

    const jobKey = await createJob(concern, payload.cap, payload.in);
    await concern.update({ wait: true }).catch(() => {});
    const targetLength = concern.local.length;
    await runDurabilityBarrier(concern.local, targetLength, durability);

    console.log(JSON.stringify({
      ok: true,
      action: "job-submit",
      concern: concernKey,
      cap: payload.cap,
      jobKey: idEncoding.encode(jobKey),
      targetLength
    }, null, 2));

    await concern.close().catch(() => {});
  });
}

async function cmdStatus({ flags, config }) {
  const concernKey = flags.concern;
  if (!concernKey) throw new Error("--concern is required");

  await withRuntime(config, async ({ corestore, swarm, joinTopic }) => {
    const concernKeyBuf = idEncoding.decode(concernKey);
    joinTopic(concernKeyBuf, "concern-key");

    const concern = await ensureConcernSurface(
      corestore.namespace("mesh-operator-concern"),
      swarm,
      { key: concernKeyBuf }
    );

    await waitForSync(concern, config.timeoutMs);

    const jobs = await countView(getJobView(concern));
    const pubs = await countView(getPublishView(concern));
    const rats = await countView(getRatView(concern));

    console.log(JSON.stringify({
      ok: true,
      action: "status",
      concern: concernKey,
      writable: !!concern.writable,
      swarmConnections: swarm.connections?.size ?? 0,
      counts: {
        jobs,
        publish: pubs,
        ratify: rats
      }
    }, null, 2));

    await concern.close().catch(() => {});
  });
}

async function main() {
  const { command, flags } = parseArgs(process.argv.slice(2));
  if (command === "help") {
    printHelp();
    return;
  }
  const configPath = flags.config || process.env.MESH_OPERATOR_CONFIG || DEFAULT_CONFIG_PATH;
  const fileConfig = await loadJsonIfPresent(configPath);
  const config = normalizeConfig({ fileConfig, env: process.env });

  if (command === "discovery advertise-concern") {
    await cmdAdvertiseConcern({ flags, config });
    return;
  }

  if (command === "discovery advertise-discovery") {
    await cmdAdvertiseDiscovery({ flags, config });
    return;
  }

  if (command === "discovery add-writer") {
    await cmdDiscoveryAddWriter({ flags, config });
    return;
  }

  if (command === "job submit") {
    await cmdJobSubmit({ flags, config });
    return;
  }

  if (command === "status") {
    await cmdStatus({ flags, config });
    return;
  }

  throw new Error(`unsupported command: ${command}`);
}

main().catch((err) => {
  console.error(`[mesh] fatal: ${err?.message || String(err)}`);
  process.exit(1);
});
