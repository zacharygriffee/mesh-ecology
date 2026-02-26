#!/usr/bin/env node
import { access, readFile } from "fs/promises";
import { setTimeout as delay } from "timers/promises";
import path from "path";
import process from "process";
import Hyperswarm from "hyperswarm";
import idEncoding from "hypercore-id-encoding";

import { ensureCorestore } from "../../../src/ensureCorestore.js";
import { ensureConcernSurface, addWriter, getJobView, getPublishView, getRatView } from "../../../src/concern.js";
import { defaultTopics } from "../../../src/util/createKeyPair.js";

const DEFAULT_CONFIG_PATH = "/etc/mesh/concern-host.json";
const DEFAULT_CORESTORE_DIR = "/var/lib/mesh/concern";
const DEFAULT_UPDATE_INTERVAL_MS = 1500;
const DEFAULT_HEARTBEAT_MS = 30_000;
const DEFAULT_TOPIC_Z32 = idEncoding.encode(defaultTopics(1)[0]);

function parseArgs(argv) {
  const out = { configPath: process.env.CONCERN_HOST_CONFIG || DEFAULT_CONFIG_PATH };
  for (let i = 0; i < argv.length; i++) {
    const part = argv[i];
    if (part === "--config") {
      out.configPath = argv[i + 1];
      i += 1;
      continue;
    }
    if (part === "-h" || part === "--help") {
      printHelp();
      process.exit(0);
    }
    throw new Error(`unknown argument: ${part}`);
  }
  return out;
}

function printHelp() {
  console.log([
    "Usage: concern-host [--config /etc/mesh/concern-host.json]",
    "",
    "Environment overrides:",
    "  CORESTORE_DIR=/var/lib/mesh/concern",
    "  CONCERN_KEYS=<z32,z32,...> (mirror mode; one concern max)",
    "  CONCERNS=<z32,z32,...> (legacy alias)",
    "  SWARM_TOPICS=<z32,z32,...>",
    "  SWARM_BOOTSTRAP=<host:port,host:port,...>",
    "  SWARM_SEED_HEX=<64-hex-bytes>",
    "  CONCERN_WRITERS=<z32,z32,...> (optional writer admission)",
    "  VALIDATION=1",
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

  const fileConcerns = toList(
    fileConfig.CONCERN_KEYS ||
    fileConfig.concerns ||
    fileConfig.CONCERNS
  );
  const envConcerns = toList(env.CONCERN_KEYS || env.CONCERNS);
  const concerns = envConcerns.length ? envConcerns : fileConcerns;

  const fileTopics = toList(fileConfig.SWARM_TOPICS || fileConfig.SWARM_TOPIC);
  const envTopics = toList(env.SWARM_TOPICS || env.SWARM_TOPIC);
  const swarmTopics = envTopics.length ? envTopics : (fileTopics.length ? fileTopics : [DEFAULT_TOPIC_Z32]);

  const fileBootstrap = toList(fileConfig.SWARM_BOOTSTRAP);
  const envBootstrap = toList(env.SWARM_BOOTSTRAP);
  const swarmBootstrap = envBootstrap.length ? envBootstrap : fileBootstrap;

  const fileWriters = toList(fileConfig.CONCERN_WRITERS);
  const envWriters = toList(env.CONCERN_WRITERS);
  const concernWriters = envWriters.length ? envWriters : fileWriters;

  const validation = String(env.VALIDATION || fileConfig.VALIDATION || "1").trim();
  const updateIntervalMs = toPositiveInt(env.UPDATE_INTERVAL_MS || fileConfig.UPDATE_INTERVAL_MS, DEFAULT_UPDATE_INTERVAL_MS);
  const heartbeatMs = toPositiveInt(env.HEARTBEAT_MS || fileConfig.HEARTBEAT_MS, DEFAULT_HEARTBEAT_MS);
  const swarmSeed = decodeSeedHex(env.SWARM_SEED_HEX || fileConfig.SWARM_SEED_HEX || "");

  return {
    corestoreDir,
    concerns,
    swarmTopics,
    swarmBootstrap,
    concernWriters,
    validation,
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

async function countViewEntries(view) {
  let count = 0;
  for await (const _entry of view.createReadStream()) count += 1;
  return count;
}

async function applyWriterConfig(base, writers) {
  if (!writers.length) return;
  if (!base.writable) {
    console.warn(`[concern-host] CONCERN_WRITERS ignored for concern=${idEncoding.encode(base.key)} because base is not writable`);
    return;
  }

  const unique = Array.from(new Set(writers));
  for (const writerZ32 of unique) {
    try {
      await addWriter(base, writerZ32);
      console.log(`[concern-host] admitted writer=${writerZ32} concern=${idEncoding.encode(base.key)}`);
    } catch (err) {
      console.warn(`[concern-host] addWriter failed writer=${writerZ32} concern=${idEncoding.encode(base.key)} err=${err?.message || String(err)}`);
    }
  }
}

async function main() {
  const { configPath } = parseArgs(process.argv.slice(2));
  const fileConfig = await loadJsonIfPresent(configPath);
  const config = normalizeConfig({ fileConfig, env: process.env });

  if (config.concerns.length === 0) {
    throw new Error("no concerns configured; provide CONCERN_KEYS (or legacy CONCERNS) in config or env");
  }
  if (config.concerns.length > 1) {
    throw new Error("this host currently supports max 1 concern by default (received > 1)");
  }
  if (config.validation !== "1") {
    console.warn("[concern-host] VALIDATION is not 1; runtime semantics are unchanged and concern.apply still enforces validation");
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
    console.log(`[concern-host] joined topic=${z32} reason=${reason}`);
  };

  for (const topicZ32 of config.swarmTopics) {
    joinTopic(idEncoding.decode(topicZ32), "config");
  }

  const concerns = [];
  for (let i = 0; i < config.concerns.length; i++) {
    const concernZ32 = config.concerns[i];
    const concernBuf = idEncoding.decode(concernZ32);
    const namespace = `mesh-concern-host-${i + 1}`;
    const base = await ensureConcernSurface(corestore.namespace(namespace), swarm, { key: concernBuf });
    joinTopic(concernBuf, "concern-key");
    await applyWriterConfig(base, config.concernWriters);
    concerns.push({ keyZ32: concernZ32, base });
    console.log(`[concern-host] concern=${concernZ32} writable=${base.writable} namespace=${namespace}`);
  }

  for (const handle of joinedTopics.values()) {
    await handle.flushed().catch(() => {});
  }
  await swarm.flush().catch(() => {});
  console.log(`[concern-host] mode=mirror concerns=${config.concerns.join(",")} corestore=${config.corestoreDir}`);

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
      for (const concern of concerns) {
        await concern.base.update({ wait: false }).catch(() => {});
      }
      await delay(config.updateIntervalMs);
    }
  })();

  const heartbeat = (async () => {
    while (!stopped) {
      await delay(config.heartbeatMs);
      if (stopped) break;
      const connCount = swarm.connections?.size ?? 0;
      for (const concern of concerns) {
        const jobs = await countViewEntries(getJobView(concern.base)).catch(() => -1);
        const pubs = await countViewEntries(getPublishView(concern.base)).catch(() => -1);
        const rats = await countViewEntries(getRatView(concern.base)).catch(() => -1);
        console.log(`[concern-host] heartbeat concern=${concern.keyZ32} connections=${connCount} jobs=${jobs} pubs=${pubs} rats=${rats}`);
      }
    }
  })();

  await stopPromise;

  console.log(`[concern-host] stopping signal=${stopReason}`);
  await Promise.allSettled([updater, heartbeat]);

  for (const handle of joinedTopics.values()) {
    await handle.destroy().catch(() => {});
  }
  for (const concern of concerns) {
    await concern.base.close().catch(() => {});
  }
  await closeSwarm(swarm);
  await corestore.close?.().catch(() => {});
}

main().catch((err) => {
  console.error(`[concern-host] fatal: ${err?.stack || err?.message || String(err)}`);
  process.exit(1);
});
