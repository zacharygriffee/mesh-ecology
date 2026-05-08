#!/usr/bin/env node
import { writeSync } from "fs";
import { access, mkdir, readFile, writeFile } from "fs/promises";
import { createHash } from "crypto";
import { EventEmitter } from "events";
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
  getRatView,
  publishJobWork
} from "../../../src/concern.js";
import { defaultTopics } from "../../../src/util/createKeyPair.js";
import { random32 } from "../../../src/util/random32.js";
import { normalizeOperatorCliConfig } from "../../../src/util/runtime-host-config.js";
import { waitForDurability } from "../lib/waitForDurability.js";

const DEFAULT_CONFIG_PATH = "/etc/mesh/operator-cli.json";
const DEFAULT_CORESTORE_DIR = "./store/operator-cli";
const DEFAULT_TOPIC_Z32 = idEncoding.encode(defaultTopics(1)[0]);
const DEFAULT_TIMEOUT_MS = 15_000;
const GENERIC_RESPONDER_ID = "mesh-v0-2.generic-responder";
const HELLO_STATUS_CAP = "cap/edge/control-panel/hello-status";

function printHelp() {
  writeSync(process.stdout.fd, [
    "mesh concern setup --purpose <purpose> --root <path> [--json]",
    "mesh discovery advertise-concern --discovery <z32> --concern <z32> [--label text] [--wait|--no-wait] [--min-peers n] [--timeout-ms n] [--config path]",
    "mesh discovery advertise-discovery --discovery <z32> --nested <z32> [--label text] [--wait|--no-wait] [--min-peers n] [--timeout-ms n] [--config path]",
    "mesh discovery add-writer --discovery <z32> --writer <z32> [--wait|--no-wait] [--min-peers n] [--timeout-ms n] [--config path]",
    "mesh job submit --concern <z32> --json <path> [--wait|--no-wait] [--min-peers n] [--timeout-ms n] [--config path]",
    "mesh responder run --concern <z32> --config <path> --cap cap/edge/control-panel/hello-status --once --json",
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
  if (argv[0] === "concern" && argv[1] === "setup") {
    command = "concern setup";
    rest = argv.slice(2);
  } else if (argv[0] === "discovery" && argv[1] === "advertise-concern") {
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
  } else if (argv[0] === "responder" && argv[1] === "run") {
    command = "responder run";
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
    if ((command === "concern setup" || command === "responder run") && part === "--json") {
      flags.json = true;
      continue;
    }
    if (command === "responder run" && part === "--once") {
      flags.once = true;
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

function createLocalSwarm() {
  const swarm = new EventEmitter();
  swarm.connections = new Set();
  swarm.close = async () => {};
  return swarm;
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

async function collectConcernStatus(concern, swarm) {
  const jobs = await countView(getJobView(concern));
  const pubs = await countView(getPublishView(concern));
  const rats = await countView(getRatView(concern));
  const responders = await collectResponderEvidence(getPublishView(concern));

  return {
    ok: true,
    action: "status",
    concern: idEncoding.encode(concern.key),
    writable: !!concern.writable,
    swarmConnections: swarm.connections?.size ?? 0,
    counts: {
      jobs,
      publish: pubs,
      ratify: rats
    },
    responders
  };
}

async function collectResponderEvidence(publishView) {
  const byId = {};
  for await (const entry of publishView.createReadStream({ valueEncoding: publishView.valueEncoding })) {
    const pub = entry.value;
    const meta = pub?.meta;
    const responderId = meta?.responderId || meta?.handledBy;
    if (!responderId) continue;

    const row = byId[responderId] || {
      handled: 0,
      byCap: {},
      latest: null
    };
    const cap = pub.cap || meta.cap || null;
    row.handled += 1;
    if (cap) row.byCap[cap] = (row.byCap[cap] || 0) + 1;
    row.latest = {
      concernKey: meta.concernKey || null,
      jobKey: pub.ref?.k ? idEncoding.encode(pub.ref.k) : meta.jobKey || null,
      cap,
      responseKey: pub.ref?.a ? idEncoding.encode(pub.ref.a) : meta.responseKey || null,
      responderId,
      handledBy: meta.handledBy || responderId,
      message: meta.response?.message || null
    };
    byId[responderId] = row;
  }
  return byId;
}

function purposeSlug(purpose) {
  const trimmed = String(purpose || "").trim();
  const slug = trimmed
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 64) || "concern";
  const hash = createHash("sha256").update(trimmed).digest("hex").slice(0, 12);
  return `${slug}-${hash}`;
}

function discoveryLabelForPurpose(purpose) {
  const value = String(purpose || "").trim();
  if (value.length <= 128) return value;
  const hash = createHash("sha256").update(value).digest("hex").slice(0, 10);
  return `${value.slice(0, 117)}-${hash}`;
}

function shellQuote(value) {
  return `'${String(value).replace(/'/g, "'\\''")}'`;
}

async function writeSetupConfig(configPath, config) {
  await mkdir(path.dirname(configPath), { recursive: true });
  const body = {
    corestoreDir: config.corestoreDir,
    swarmTopics: config.swarmTopics,
    swarmBootstrap: config.swarmBootstrap,
    timeoutMs: config.timeoutMs
  };
  await writeFile(configPath, `${JSON.stringify(body, null, 2)}\n`);
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

async function withLocalRuntime(corestoreDir, fn) {
  await mkdir(corestoreDir, { recursive: true });
  const corestore = ensureCorestore(corestoreDir);
  if (typeof corestore.ready === "function") await corestore.ready();
  const swarm = createLocalSwarm();

  try {
    await fn({ corestore, swarm });
  } finally {
    await closeSwarm(swarm);
    await corestore.close?.().catch(() => {});
  }
}

async function cmdConcernSetup({ flags, config }) {
  const purpose = String(flags.purpose || "").trim();
  const root = flags.root ? path.resolve(String(flags.root)) : "";
  const wantsJson = flags.json === true;

  if (!purpose) throw new Error("--purpose is required");
  if (!root) throw new Error("--root is required");

  const purposeDir = path.join(root, "concerns", purposeSlug(purpose));
  const storeDir = path.join(purposeDir, "store");
  const configPath = path.join(purposeDir, "operator-cli.json");
  const setupConfig = {
    ...config,
    corestoreDir: storeDir
  };

  await mkdir(purposeDir, { recursive: true });
  await writeSetupConfig(configPath, setupConfig);

  let result = null;
  await withLocalRuntime(storeDir, async ({ corestore, swarm }) => {
    const concern = await ensureConcernSurface(
      corestore.namespace("mesh-operator-concern"),
      swarm
    );
    const discovery = await ensureDiscoverySurface(
      corestore.namespace("mesh-operator-discovery"),
      {},
      swarm
    );

    try {
      await Promise.all([
        waitUntilWritable(concern, setupConfig.timeoutMs),
        waitUntilWritable(discovery, setupConfig.timeoutMs)
      ]);

      const concernKey = idEncoding.encode(concern.key);
      const discoveryKey = idEncoding.encode(discovery.key);
      if (discovery.writable) {
        await addConcern(discovery, concernKey, discoveryLabelForPurpose(purpose));
        await discovery.update({ wait: true }).catch(() => {});
      }
      await concern.update({ wait: true }).catch(() => {});

      const concernLocalWriterKey = idEncoding.encode(concern.local.key);
      const discoveryLocalWriterKey = idEncoding.encode(discovery.local.key);

      const status = await collectConcernStatus(concern, swarm);

      result = {
        ok: true,
        action: "concern-setup",
        purpose,
        concernKey,
        discoveryKey,
        concernStore: {
          path: storeDir,
          namespace: "mesh-operator-concern",
          ref: `${storeDir}#mesh-operator-concern`
        },
        discoveryStore: {
          path: storeDir,
          namespace: "mesh-operator-discovery",
          ref: `${storeDir}#mesh-operator-discovery`
        },
        operatorStore: {
          path: storeDir,
          ref: storeDir
        },
        configPath,
        configRefs: {
          operatorCli: configPath
        },
        writer: {
          posture: concern.writable ? "local-writer" : "local-readonly",
          concernWritable: !!concern.writable,
          concernLocalWriterKey,
          discoveryWritable: !!discovery.writable,
          discoveryLocalWriterKey
        },
        status,
        posture: {
          summary: "local persistent concern opened",
          nonClaims: [
            "does not claim canonical truth",
            "does not claim actor response",
            "does not claim job completion",
            "does not claim production readiness"
          ]
        },
        nextCommands: {
          submitJob: `CORESTORE_DIR=${shellQuote(storeDir)} node packages/mesh-operator-cli/bin/mesh.js job submit --concern ${concernKey} --json <job.json> --no-wait`,
          status: `CORESTORE_DIR=${shellQuote(storeDir)} node packages/mesh-operator-cli/bin/mesh.js status --concern ${concernKey}`,
          submitJobWithConfig: `node packages/mesh-operator-cli/bin/mesh.js job submit --concern ${concernKey} --json <job.json> --no-wait --config ${shellQuote(configPath)}`,
          statusWithConfig: `node packages/mesh-operator-cli/bin/mesh.js status --concern ${concernKey} --config ${shellQuote(configPath)}`,
          responderRunOnceWithConfig: `node packages/mesh-operator-cli/bin/mesh.js responder run --concern ${concernKey} --config ${shellQuote(configPath)} --cap ${HELLO_STATUS_CAP} --once --json`
        }
      };
    } finally {
      await discovery.close().catch(() => {});
      await concern.close().catch(() => {});
    }
  });

  if (wantsJson) {
    console.log(JSON.stringify(result, null, 2));
    return;
  }

  console.log(`purpose: ${result.purpose}`);
  console.log(`concernKey: ${result.concernKey}`);
  console.log(`discoveryKey: ${result.discoveryKey}`);
  console.log(`operatorStore: ${result.operatorStore.path}`);
  console.log(`configPath: ${result.configPath}`);
  console.log(`status: ${result.nextCommands.status}`);
  console.log(`submit: ${result.nextCommands.submitJob}`);
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

function helloStatusResponse() {
  return {
    ok: true,
    cap: HELLO_STATUS_CAP,
    message: "hello from mesh responder",
    handledBy: GENERIC_RESPONDER_ID
  };
}

async function hasResponderPubForJob(publishView, jobKey, cap, responderId) {
  const jobPubs = publishView.sub(jobKey, { valueEncoding: publishView.valueEncoding });
  for await (const entry of jobPubs.createReadStream({ valueEncoding: publishView.valueEncoding })) {
    const pub = entry.value;
    const meta = pub?.meta;
    if (pub?.cap !== cap) continue;
    if (meta?.responderId === responderId || meta?.handledBy === responderId) return true;
  }
  return false;
}

async function findNextResponderJob(concern, cap, responderId) {
  const jobView = getJobView(concern);
  const publishView = getPublishView(concern);
  let skipped = 0;

  for await (const entry of jobView.createReadStream({ valueEncoding: jobView.valueEncoding })) {
    const jobKey = entry.key;
    const job = entry.value;
    if (job?.cap !== cap) {
      skipped += 1;
      continue;
    }
    if (await hasResponderPubForJob(publishView, jobKey, cap, responderId)) {
      skipped += 1;
      continue;
    }
    return { jobKey, job, skipped };
  }

  return { jobKey: null, job: null, skipped };
}

async function cmdResponderRun({ flags, config }) {
  const concernKey = flags.concern;
  const cap = flags.cap;
  const responderId = GENERIC_RESPONDER_ID;

  if (!concernKey) throw new Error("--concern is required");
  if (!cap) throw new Error("--cap is required");
  if (cap !== HELLO_STATUS_CAP) throw new Error(`unsupported --cap for generic responder: ${cap}`);
  if (flags.once !== true) throw new Error("--once is required; responder daemon behavior is not implemented");

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

    await concern.update({ wait: true }).catch(() => {});
    const statusBefore = await collectConcernStatus(concern, swarm);
    const found = await findNextResponderJob(concern, cap, responderId);

    if (!found.jobKey) {
      const out = {
        ok: false,
        action: "responder-run",
        state: "no_match",
        reason: "no matching pending job",
        concernKey,
        cap,
        responderId,
        handled: 0,
        skipped: found.skipped,
        statusBefore,
        statusAfter: statusBefore
      };
      console.log(JSON.stringify(out, null, 2));
      process.exitCode = 2;
      await concern.close().catch(() => {});
      return;
    }

    const attempt = random32();
    const response = helloStatusResponse();
    const jobKey = found.jobKey;
    const jobKeyZ32 = idEncoding.encode(jobKey);
    const responseKey = idEncoding.encode(attempt);

    await publishJobWork(
      concern,
      jobKey,
      cap,
      { t: "response", k: jobKey, a: attempt },
      {
        responderId,
        handledBy: responderId,
        concernKey,
        jobKey: jobKeyZ32,
        cap,
        responseKey,
        response,
        issuedAtMs: Date.now()
      }
    );
    await concern.update({ wait: true }).catch(() => {});

    const statusAfter = await collectConcernStatus(concern, swarm);
    console.log(JSON.stringify({
      ok: true,
      action: "responder-run",
      state: "handled",
      concernKey,
      jobKey: jobKeyZ32,
      cap,
      responseKey,
      receiptKey: responseKey,
      responderId,
      handled: 1,
      skipped: found.skipped,
      response,
      statusBefore,
      statusAfter
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

    console.log(JSON.stringify(await collectConcernStatus(concern, swarm), null, 2));

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

  if (command === "concern setup") {
    await cmdConcernSetup({ flags, config });
    return;
  }

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

  if (command === "responder run") {
    await cmdResponderRun({ flags, config });
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
