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
const CALL_FOR_RESPONSES_CAP = "cap/concern/call-for-responses/v1";
const SUPPORTED_RESPONDER_CAPS = new Set([
  CALL_FOR_RESPONSES_CAP
]);
const CALL_FOR_RESPONSES_REQUEST_KIND = "mesh_concern_call_for_responses";
const CALL_FOR_RESPONSES_RESPONSE_MODE = "plural_response_evidence";
const CALL_FOR_RESPONSES_REQUIRED_NON_CLAIMS = new Set([
  "no_actor_selection",
  "no_actor_obligation",
  "no_completion_claim",
  "no_device_truth",
  "no_mesh_truth"
]);
const CALL_FOR_RESPONSES_ALLOWED_INPUT_KEYS = new Set([
  "requestKind",
  "profile",
  "needRef",
  "producer",
  "responseMode",
  "subject",
  "nonClaimsRequired",
  "operatorRef"
]);
const CALL_FOR_RESPONSES_ALLOWED_PRODUCER_KEYS = new Set(["repo", "surface"]);
const CALL_FOR_RESPONSES_ALLOWED_SUBJECT_KEYS = new Set(["kind", "summary", "constraints"]);

function printHelp() {
  writeSync(process.stdout.fd, [
    "mesh concern setup --purpose <purpose> --root <path> [--json]",
    "mesh discovery advertise-concern --discovery <z32> --concern <z32> [--label text] [--wait|--no-wait] [--min-peers n] [--timeout-ms n] [--config path]",
    "mesh discovery advertise-discovery --discovery <z32> --nested <z32> [--label text] [--wait|--no-wait] [--min-peers n] [--timeout-ms n] [--config path]",
    "mesh discovery add-writer --discovery <z32> --writer <z32> [--wait|--no-wait] [--min-peers n] [--timeout-ms n] [--config path]",
    "mesh job submit --concern <z32> --json <path> [--wait|--no-wait] [--min-peers n] [--timeout-ms n] [--config path]",
    "mesh responder run --concern <z32> --config <path> --cap <supported-cap> --once --json",
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
      byCapCounts: {},
      latestByCap: {},
      latest: null
    };
    const cap = pub.cap || meta.cap || null;
    row.handled += 1;
    if (cap) row.byCap[cap] = (row.byCap[cap] || 0) + 1;
    if (cap && !row.byCapCounts[cap]) {
      row.byCapCounts[cap] = { handled: 0, skipped: 0 };
    }
    if (cap) {
      row.byCapCounts[cap].handled += 1;
      row.byCapCounts[cap].skipped += Number.isSafeInteger(meta.skipped)
        ? meta.skipped
        : Number.isSafeInteger(meta.response?.skipped) ? meta.response.skipped : 0;
    }
    const latest = {
      concernKey: meta.concernKey || null,
      jobKey: pub.ref?.k ? idEncoding.encode(pub.ref.k) : meta.jobKey || null,
      cap,
      requestKind: meta.response?.requestKind || null,
      profile: meta.response?.profile || null,
      needRef: meta.response?.needRef || null,
      producer: meta.response?.producer || null,
      subject: meta.response?.subject || null,
      responseKey: pub.ref?.a ? idEncoding.encode(pub.ref.a) : meta.responseKey || null,
      responderId,
      handledBy: meta.handledBy || responderId,
      message: meta.response?.message || null,
      actorGroup: meta.response?.actorGroup || null,
      selectorKind: meta.response?.selectorKind || null,
      expectedResultMode: meta.response?.expectedResultMode || null,
      responseMode: meta.response?.responseMode || null,
      responsesReturned: Array.isArray(meta.response?.responses) ? meta.response.responses.length : null,
      admissionState: meta.response?.admissionState || null,
      reasonCodes: Array.isArray(meta.response?.reasonCodes) ? meta.response.reasonCodes : null,
      posture: meta.posture || meta.response?.posture || null,
      response: meta.response || null
    };
    row.latest = latest;
    if (cap) row.latestByCap[cap] = latest;
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
          callForResponsesResponderRunOnceWithConfig: `node packages/mesh-operator-cli/bin/mesh.js responder run --concern ${concernKey} --config ${shellQuote(configPath)} --cap ${CALL_FOR_RESPONSES_CAP} --once --json`
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

function callForResponsesPosture() {
  return {
    summary: "generic concern-local call-for-responses evidence",
    nonClaims: [
      "does not select actors",
      "does not assign actor obligation",
      "does not claim completion",
      "does not claim physical device truth",
      "does not claim Mesh truth",
      "does not claim adjacent repo truth",
      "does not provide a global capability registry",
      "does not schedule work",
      "does not search discovery",
      "does not mutate devices",
      "does not execute shell commands"
    ]
  };
}

function callForResponsesNonClaims() {
  return {
    actorSelectionClaimed: false,
    actorObligationClaimed: false,
    completionClaimed: false,
    physicalDeviceTruthClaimed: false,
    meshTruthClaimed: false,
    adjacentRepoTruthClaimed: false,
    globalCapabilityRegistryClaimed: false,
    discoverySearchClaimed: false,
    schedulingClaimed: false,
    deviceMutationAttempted: false,
    networkSideEffectAttempted: false,
    shellCommandExecuted: false
  };
}

function hasOnlyAllowedKeys(value, allowed) {
  return Object.keys(value || {}).every((key) => allowed.has(key));
}

function hasForbiddenCallForResponsesWording(input) {
  const fragments = [
    input?.subject?.kind,
    input?.subject?.summary,
    JSON.stringify(input?.subject?.constraints || {})
  ].filter((value) => typeof value === "string").join(" ").toLowerCase();

  return [
    "global registry",
    "capability registry",
    "global capability",
    "global search",
    "discovery search",
    "search discovery",
    "discovery scheduling",
    "schedule work",
    "scheduler",
    "select actor",
    "actor selection",
    "assign actor",
    "actor obligation",
    "winner",
    "completion proof",
    "job completion",
    "device truth",
    "mesh truth",
    "adjacent repo truth",
    "shell execution",
    "execute shell",
    "device mutation",
    "mutate device"
  ].some((needle) => fragments.includes(needle));
}

function validateCallForResponsesInput(input) {
  const reasonCodes = [];
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    return { ok: false, reasonCodes: ["invalid_payload"] };
  }

  if (!hasOnlyAllowedKeys(input, CALL_FOR_RESPONSES_ALLOWED_INPUT_KEYS)) {
    reasonCodes.push("unsupported_payload_field");
  }
  if (input.requestKind !== CALL_FOR_RESPONSES_REQUEST_KIND) reasonCodes.push("invalid_request_kind");
  if (!isNonEmptyString(input.profile)) reasonCodes.push("missing_profile");
  if (!isNonEmptyString(input.needRef)) reasonCodes.push("missing_need_ref");
  if (!input.producer || typeof input.producer !== "object" || Array.isArray(input.producer)) {
    reasonCodes.push("invalid_producer");
  } else {
    if (!hasOnlyAllowedKeys(input.producer, CALL_FOR_RESPONSES_ALLOWED_PRODUCER_KEYS)) {
      reasonCodes.push("unsupported_payload_field");
    }
    if (!isNonEmptyString(input.producer.repo)) reasonCodes.push("missing_producer_repo");
    if (!isNonEmptyString(input.producer.surface)) reasonCodes.push("missing_producer_surface");
  }
  if (input.responseMode !== CALL_FOR_RESPONSES_RESPONSE_MODE) reasonCodes.push("invalid_response_mode");
  if (!input.subject || typeof input.subject !== "object" || Array.isArray(input.subject)) {
    reasonCodes.push("invalid_subject");
  } else {
    if (!hasOnlyAllowedKeys(input.subject, CALL_FOR_RESPONSES_ALLOWED_SUBJECT_KEYS)) {
      reasonCodes.push("unsupported_payload_field");
    }
    if (!isNonEmptyString(input.subject.kind)) reasonCodes.push("missing_subject_kind");
    if (!isNonEmptyString(input.subject.summary)) reasonCodes.push("missing_subject_summary");
    if (
      Object.prototype.hasOwnProperty.call(input.subject, "constraints") &&
      (!input.subject.constraints || typeof input.subject.constraints !== "object" || Array.isArray(input.subject.constraints))
    ) {
      reasonCodes.push("invalid_subject_constraints");
    }
  }
  if (!Array.isArray(input.nonClaimsRequired)) {
    reasonCodes.push("missing_required_non_claims");
  } else {
    for (const required of CALL_FOR_RESPONSES_REQUIRED_NON_CLAIMS) {
      if (!input.nonClaimsRequired.includes(required)) reasonCodes.push("missing_required_non_claims");
    }
  }
  if (
    Object.prototype.hasOwnProperty.call(input, "operatorRef") &&
    input.operatorRef != null &&
    !isNonEmptyString(input.operatorRef)
  ) {
    reasonCodes.push("invalid_operator_ref");
  }
  if (hasForbiddenCallForResponsesWording(input)) reasonCodes.push("forbidden_claim");

  return {
    ok: reasonCodes.length === 0,
    reasonCodes: [...new Set(reasonCodes)]
  };
}

function callForResponsesResponse(input, context) {
  const validation = validateCallForResponsesInput(input);
  const common = {
    cap: CALL_FOR_RESPONSES_CAP,
    requestKind: input?.requestKind === CALL_FOR_RESPONSES_REQUEST_KIND
      ? input.requestKind
      : CALL_FOR_RESPONSES_REQUEST_KIND,
    profile: isNonEmptyString(input?.profile) ? input.profile : null,
    needRef: isNonEmptyString(input?.needRef) ? input.needRef : null,
    producer: input?.producer && typeof input.producer === "object" && !Array.isArray(input.producer)
      ? {
          repo: isNonEmptyString(input.producer.repo) ? input.producer.repo : null,
          surface: isNonEmptyString(input.producer.surface) ? input.producer.surface : null
        }
      : null,
    responseMode: CALL_FOR_RESPONSES_RESPONSE_MODE,
    handledBy: GENERIC_RESPONDER_ID,
    responderId: GENERIC_RESPONDER_ID,
    concernKey: context.concernKey,
    jobKey: context.jobKey,
    responseKey: context.responseKey,
    receiptKey: context.responseKey,
    handled: 1,
    skipped: context.skipped,
    posture: callForResponsesPosture(),
    ...callForResponsesNonClaims()
  };

  if (!validation.ok) {
    return {
      ok: false,
      ...common,
      reasonCodes: validation.reasonCodes
    };
  }

  return {
    ok: true,
    ...common,
    producer: {
      repo: input.producer.repo,
      surface: input.producer.surface
    },
    subject: {
      kind: input.subject.kind,
      summary: input.subject.summary,
      constraints: input.subject.constraints && typeof input.subject.constraints === "object"
        ? input.subject.constraints
        : {}
    },
    operatorRef: isNonEmptyString(input.operatorRef) ? input.operatorRef : null,
    responses: [
      {
        responderRef: GENERIC_RESPONDER_ID,
        observed: true,
        eligibility: "eligible"
      }
    ]
  };
}

function isNonEmptyString(value) {
  return typeof value === "string" && value.trim().length > 0;
}

function isResponderJobMatch(job, cap) {
  if (job?.cap !== cap) return false;
  if (cap === CALL_FOR_RESPONSES_CAP) return true;
  return false;
}

function buildResponderResponse(cap, job, context) {
  if (cap === CALL_FOR_RESPONSES_CAP) return callForResponsesResponse(job.in, context);
  throw new Error(`unsupported responder cap: ${cap}`);
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
    if (!isResponderJobMatch(job, cap)) {
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
  if (!SUPPORTED_RESPONDER_CAPS.has(cap)) throw new Error(`unsupported --cap for generic responder: ${cap}`);
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
    const jobKey = found.jobKey;
    const jobKeyZ32 = idEncoding.encode(jobKey);
    const responseKey = idEncoding.encode(attempt);
    const response = buildResponderResponse(cap, found.job, {
      concernKey,
      jobKey: jobKeyZ32,
      responseKey,
      skipped: found.skipped
    });
    const posture = response.posture || null;

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
        handled: 1,
        skipped: found.skipped,
        response,
        posture,
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
      ...(cap === CALL_FOR_RESPONSES_CAP ? {
        requestKind: response.requestKind,
        profile: response.profile,
        needRef: response.needRef,
        producer: response.producer,
        subject: response.subject || null,
        operatorRef: response.operatorRef || null,
        responseMode: response.responseMode,
        responses: response.responses || [],
        reasonCodes: response.reasonCodes || null,
        handledBy: response.handledBy,
        posture
      } : {}),
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
