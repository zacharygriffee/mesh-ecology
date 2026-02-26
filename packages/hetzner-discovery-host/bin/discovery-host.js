#!/usr/bin/env node
import { access, readFile } from "fs/promises";
import { setTimeout as delay } from "timers/promises";
import path from "path";
import process from "process";
import Hyperswarm from "hyperswarm";
import idEncoding from "hypercore-id-encoding";

import { ensureCorestore } from "../../../src/ensureCorestore.js";
import { ensureDiscoverySurface, addWriter } from "../../../src/discovery.js";
import { defaultTopics } from "../../../src/util/createKeyPair.js";

const DEFAULT_CONFIG_PATH = "/etc/mesh/discovery-host.json";
const DEFAULT_CORESTORE_DIR = "/var/lib/mesh/discovery";
const DEFAULT_UPDATE_INTERVAL_MS = 1500;
const DEFAULT_HEARTBEAT_MS = 30_000;
const DEFAULT_TOPIC_Z32 = idEncoding.encode(defaultTopics(1)[0]);

function parseArgs(argv) {
  const out = {
    configPath: process.env.DISCOVERY_HOST_CONFIG || DEFAULT_CONFIG_PATH,
    create: false
  };
  for (let i = 0; i < argv.length; i++) {
    const part = argv[i];
    if (part === "--config") {
      out.configPath = argv[i + 1];
      i += 1;
      continue;
    }
    if (part === "--create") {
      out.create = true;
      continue;
    }
    if (part === "-h" || part === "--help") {
      printHelp();
      process.exit(0);
    }
    throw new Error(`unknown argument: ${part}`);
  }
  if (!out.configPath) out.configPath = DEFAULT_CONFIG_PATH;
  return out;
}

function printHelp() {
  console.log([
    "Usage: discovery-host [--config /etc/mesh/discovery-host.json]",
    "       discovery-host --create [--config /etc/mesh/discovery-host.json]",
    "",
    "Environment overrides:",
    "  CORESTORE_DIR=/var/lib/mesh/discovery",
    "  DISCOVERY_KEY=<z32> (mirror mode; required unless --create / DISCOVERY_CREATE=1)",
    "  DISCOVERY_CREATE=1 (explicitly allow create mode)",
    "  SWARM_TOPICS=<z32,z32,...>",
    "  SWARM_BOOTSTRAP=<host:port,host:port,...>",
    "  SWARM_SEED_HEX=<64-hex-bytes>",
    "  DISCOVERY_WRITERS=<z32,z32,...>",
    "  UPDATE_INTERVAL_MS=1500",
    "  HEARTBEAT_MS=30000"
  ].join("\n"));
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

async function fileExists(filePath) {
  if (!filePath) return false;
  try {
    await access(filePath);
    return true;
  } catch {
    return false;
  }
}

function toList(value) {
  if (!value) return [];
  if (Array.isArray(value)) return value.map((x) => String(x).trim()).filter(Boolean);
  return String(value)
    .split(",")
    .map((x) => x.trim())
    .filter(Boolean);
}

function toPositiveInt(value, fallback) {
  const n = Number(value);
  if (!Number.isFinite(n) || n <= 0) return fallback;
  return Math.floor(n);
}

function toBool(value) {
  if (value == null || value === "") return false;
  const normalized = String(value).trim().toLowerCase();
  return normalized === "1" || normalized === "true" || normalized === "yes" || normalized === "on";
}

function decodeSeedHex(value) {
  if (!value) return null;
  const normalized = String(value).trim();
  if (!/^[0-9a-fA-F]{64}$/.test(normalized)) {
    throw new Error("SWARM_SEED_HEX must be 64 hex chars");
  }
  return Buffer.from(normalized, "hex");
}

function normalizeConfig({ fileConfig, env }) {
  const corestoreDir = path.resolve(String(env.CORESTORE_DIR || fileConfig.CORESTORE_DIR || DEFAULT_CORESTORE_DIR));
  const discoveryKey = String(
    env.DISCOVERY_KEY ||
    fileConfig.DISCOVERY_KEY ||
    fileConfig.discoveryKey ||
    ""
  ).trim() || null;

  const fileTopics = toList(fileConfig.SWARM_TOPICS || fileConfig.SWARM_TOPIC);
  const envTopics = toList(env.SWARM_TOPICS || env.SWARM_TOPIC);
  const swarmTopics = envTopics.length ? envTopics : (fileTopics.length ? fileTopics : [DEFAULT_TOPIC_Z32]);

  const fileBootstrap = toList(fileConfig.SWARM_BOOTSTRAP);
  const envBootstrap = toList(env.SWARM_BOOTSTRAP);
  const swarmBootstrap = envBootstrap.length ? envBootstrap : fileBootstrap;

  const fileWriters = toList(fileConfig.DISCOVERY_WRITERS);
  const envWriters = toList(env.DISCOVERY_WRITERS);
  const discoveryWriters = envWriters.length ? envWriters : fileWriters;

  const updateIntervalMs = toPositiveInt(env.UPDATE_INTERVAL_MS || fileConfig.UPDATE_INTERVAL_MS, DEFAULT_UPDATE_INTERVAL_MS);
  const heartbeatMs = toPositiveInt(env.HEARTBEAT_MS || fileConfig.HEARTBEAT_MS, DEFAULT_HEARTBEAT_MS);
  const swarmSeed = decodeSeedHex(env.SWARM_SEED_HEX || fileConfig.SWARM_SEED_HEX || "");
  const create = toBool(env.DISCOVERY_CREATE || fileConfig.DISCOVERY_CREATE || fileConfig.create);

  return {
    corestoreDir,
    discoveryKey,
    create,
    swarmTopics,
    swarmBootstrap,
    discoveryWriters,
    updateIntervalMs,
    heartbeatMs,
    swarmSeed
  };
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

function installSignalHandlers(onStop) {
  const onSigInt = () => onStop("SIGINT");
  const onSigTerm = () => onStop("SIGTERM");
  process.on("SIGINT", onSigInt);
  process.on("SIGTERM", onSigTerm);
  return () => {
    process.off("SIGINT", onSigInt);
    process.off("SIGTERM", onSigTerm);
  };
}

async function applyWriterConfig(discovery, writers) {
  if (!writers.length) return;
  if (!discovery.writable) {
    console.warn("[discovery-host] DISCOVERY_WRITERS ignored because discovery is not writable in this process");
    return;
  }

  const unique = Array.from(new Set(writers));
  for (const writerZ32 of unique) {
    try {
      await addWriter(discovery, writerZ32);
      console.log(`[discovery-host] admitted writer=${writerZ32}`);
    } catch (err) {
      console.warn(`[discovery-host] addWriter failed writer=${writerZ32} err=${err?.message || String(err)}`);
    }
  }
}

async function main() {
  const { configPath, create: createArg } = parseArgs(process.argv.slice(2));
  const fileConfig = await loadJsonIfPresent(configPath);
  const config = normalizeConfig({ fileConfig, env: process.env });
  const configFileExists = await fileExists(configPath);
  let createMode = Boolean(createArg || config.create);

  if (!config.discoveryKey && !createMode && !configFileExists) {
    createMode = true;
    console.warn("[discovery-host] DISCOVERY_KEY not set and config file is missing; defaulting to mode=create for local bootstrap compatibility");
  }

  if (!config.discoveryKey && !createMode) {
    throw new Error(
      "DISCOVERY_KEY is required in mirror mode. Set DISCOVERY_KEY (or discoveryKey) to mirror an authority-provided discovery, or pass --create / DISCOVERY_CREATE=1 for explicit create mode."
    );
  }

  const corestore = ensureCorestore(config.corestoreDir);
  if (typeof corestore.ready === "function") await corestore.ready();

  const swarm = await createSwarm(config);
  const joinedTopics = new Map();

  const joinTopic = (topicBuf, reason) => {
    const z32 = idEncoding.encode(topicBuf);
    if (joinedTopics.has(z32)) return;
    const handle = swarm.join(topicBuf, { server: true, client: true });
    joinedTopics.set(z32, handle);
    console.log(`[discovery-host] joined topic=${z32} reason=${reason}`);
  };

  for (const topicZ32 of config.swarmTopics) {
    joinTopic(idEncoding.decode(topicZ32), "config");
  }

  const discoveryConfig = {};
  let mode = "create";
  if (config.discoveryKey) {
    discoveryConfig.key = idEncoding.decode(config.discoveryKey);
    mode = "mirror";
  }

  const discovery = await ensureDiscoverySurface(corestore.namespace("mesh-discovery-host"), discoveryConfig, swarm);
  const discoveryKeyZ32 = idEncoding.encode(discovery.key);
  joinTopic(discovery.key, "discovery-key");

  await applyWriterConfig(discovery, config.discoveryWriters);

  for (const handle of joinedTopics.values()) {
    await handle.flushed().catch(() => {});
  }
  await swarm.flush().catch(() => {});

  console.log(`DISCOVERY_KEY=${discoveryKeyZ32}`);
  console.log(`[discovery-host] mode=${mode} discovery=${discoveryKeyZ32} writable=${discovery.writable} corestore=${config.corestoreDir}`);

  let stopReason = null;
  let stopped = false;
  const stopPromise = new Promise((resolve) => {
    const detach = installSignalHandlers((signal) => {
      if (stopped) return;
      stopped = true;
      stopReason = signal;
      detach();
      resolve();
    });
  });

  const updater = (async () => {
    while (!stopped) {
      await discovery.update({ wait: false }).catch(() => {});
      await delay(config.updateIntervalMs);
    }
  })();

  const heartbeat = (async () => {
    while (!stopped) {
      await delay(config.heartbeatMs);
      if (stopped) break;
      const connCount = swarm.connections?.size ?? 0;
      console.log(`[discovery-host] heartbeat connections=${connCount} topics=${joinedTopics.size}`);
    }
  })();

  await stopPromise;

  console.log(`[discovery-host] stopping signal=${stopReason}`);
  await Promise.allSettled([updater, heartbeat]);

  for (const handle of joinedTopics.values()) {
    await handle.destroy().catch(() => {});
  }
  await discovery.close().catch(() => {});
  await closeSwarm(swarm);
  await corestore.close?.().catch(() => {});
}

main().catch((err) => {
  console.error(`[discovery-host] fatal: ${err?.stack || err?.message || String(err)}`);
  process.exit(1);
});
