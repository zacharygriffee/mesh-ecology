import path from "path";

function firstPresent(values) {
  for (const value of values) {
    if (value !== undefined && value !== null && value !== "") return value;
  }
  return undefined;
}

function pickValue({ env = {}, fileConfig = {}, envKeys = [], fileKeys = [], fallback = undefined }) {
  const envValues = envKeys.map((key) => env[key]);
  const fileValues = fileKeys.map((key) => fileConfig[key]);
  const found = firstPresent([...envValues, ...fileValues]);
  return found === undefined ? fallback : found;
}

function toList(value) {
  if (!value) return [];
  if (Array.isArray(value)) return value.map((x) => String(x).trim()).filter(Boolean);
  return String(value)
    .split(",")
    .map((x) => x.trim())
    .filter(Boolean);
}

function pickList({ env = {}, fileConfig = {}, envKeys = [], fileKeys = [], fallback = [] }) {
  const envValues = envKeys.map((key) => env[key]);
  for (const value of envValues) {
    const out = toList(value);
    if (out.length) return out;
  }

  const fileValues = fileKeys.map((key) => fileConfig[key]);
  for (const value of fileValues) {
    const out = toList(value);
    if (out.length) return out;
  }

  return [...fallback];
}

function toPositiveInt(value, fallback) {
  const n = Number(value);
  if (!Number.isFinite(n) || n <= 0) return fallback;
  return Math.floor(n);
}

function pickPositiveInt({ env = {}, fileConfig = {}, envKeys = [], fileKeys = [], fallback }) {
  const value = pickValue({ env, fileConfig, envKeys, fileKeys, fallback });
  return toPositiveInt(value, fallback);
}

function toBool(value) {
  if (value == null || value === "") return false;
  const normalized = String(value).trim().toLowerCase();
  return normalized === "1" || normalized === "true" || normalized === "yes" || normalized === "on";
}

function pickBool({ env = {}, fileConfig = {}, envKeys = [], fileKeys = [], fallback = false }) {
  const value = pickValue({ env, fileConfig, envKeys, fileKeys, fallback: undefined });
  if (value === undefined) return fallback;
  return toBool(value);
}

function decodeSeedHex(value) {
  if (!value) return null;
  const normalized = String(value).trim();
  if (!/^[0-9a-fA-F]{64}$/.test(normalized)) {
    throw new Error("SWARM_SEED_HEX must be 64 hex chars");
  }
  return Buffer.from(normalized, "hex");
}

function pickSeedHex({ env = {}, fileConfig = {}, envKeys = [], fileKeys = [] }) {
  const value = pickValue({ env, fileConfig, envKeys, fileKeys, fallback: "" });
  return decodeSeedHex(value);
}

function pickResolvedPath({ env = {}, fileConfig = {}, envKeys = [], fileKeys = [], fallback }) {
  const value = pickValue({ env, fileConfig, envKeys, fileKeys, fallback });
  return path.resolve(String(value));
}

function pickTrimmedString({ env = {}, fileConfig = {}, envKeys = [], fileKeys = [], fallback = null }) {
  const value = pickValue({ env, fileConfig, envKeys, fileKeys, fallback: fallback ?? "" });
  const trimmed = String(value || "").trim();
  return trimmed || null;
}

function normalizeDiscoveryHostConfig({
  fileConfig = {},
  env = {},
  defaultCorestoreDir,
  defaultTopicZ32,
  defaultUpdateIntervalMs,
  defaultHeartbeatMs
}) {
  return {
    corestoreDir: pickResolvedPath({
      env,
      fileConfig,
      envKeys: ["CORESTORE_DIR"],
      fileKeys: ["corestoreDir", "CORESTORE_DIR"],
      fallback: defaultCorestoreDir
    }),
    discoveryKey: pickTrimmedString({
      env,
      fileConfig,
      envKeys: ["DISCOVERY_KEY"],
      fileKeys: ["discoveryKey", "DISCOVERY_KEY"]
    }),
    create: pickBool({
      env,
      fileConfig,
      envKeys: ["DISCOVERY_CREATE"],
      fileKeys: ["discoveryCreate", "DISCOVERY_CREATE", "create"]
    }),
    swarmTopics: pickList({
      env,
      fileConfig,
      envKeys: ["SWARM_TOPICS", "SWARM_TOPIC"],
      fileKeys: ["swarmTopics", "SWARM_TOPICS", "SWARM_TOPIC"],
      fallback: [defaultTopicZ32]
    }),
    swarmBootstrap: pickList({
      env,
      fileConfig,
      envKeys: ["SWARM_BOOTSTRAP"],
      fileKeys: ["swarmBootstrap", "SWARM_BOOTSTRAP"]
    }),
    discoveryWriters: pickList({
      env,
      fileConfig,
      envKeys: ["DISCOVERY_WRITERS"],
      fileKeys: ["discoveryWriters", "DISCOVERY_WRITERS"]
    }),
    updateIntervalMs: pickPositiveInt({
      env,
      fileConfig,
      envKeys: ["UPDATE_INTERVAL_MS"],
      fileKeys: ["updateIntervalMs", "UPDATE_INTERVAL_MS"],
      fallback: defaultUpdateIntervalMs
    }),
    heartbeatMs: pickPositiveInt({
      env,
      fileConfig,
      envKeys: ["HEARTBEAT_MS"],
      fileKeys: ["heartbeatMs", "HEARTBEAT_MS"],
      fallback: defaultHeartbeatMs
    }),
    swarmSeed: pickSeedHex({
      env,
      fileConfig,
      envKeys: ["SWARM_SEED_HEX"],
      fileKeys: ["swarmSeedHex", "SWARM_SEED_HEX"]
    })
  };
}

function normalizeConcernHostConfig({
  fileConfig = {},
  env = {},
  defaultCorestoreDir,
  defaultTopicZ32,
  defaultUpdateIntervalMs,
  defaultHeartbeatMs
}) {
  return {
    corestoreDir: pickResolvedPath({
      env,
      fileConfig,
      envKeys: ["CORESTORE_DIR"],
      fileKeys: ["corestoreDir", "CORESTORE_DIR"],
      fallback: defaultCorestoreDir
    }),
    concerns: pickList({
      env,
      fileConfig,
      envKeys: ["CONCERN_KEYS", "CONCERNS"],
      fileKeys: ["concernKeys", "CONCERN_KEYS", "concerns", "CONCERNS"]
    }),
    swarmTopics: pickList({
      env,
      fileConfig,
      envKeys: ["SWARM_TOPICS", "SWARM_TOPIC"],
      fileKeys: ["swarmTopics", "SWARM_TOPICS", "SWARM_TOPIC"],
      fallback: [defaultTopicZ32]
    }),
    swarmBootstrap: pickList({
      env,
      fileConfig,
      envKeys: ["SWARM_BOOTSTRAP"],
      fileKeys: ["swarmBootstrap", "SWARM_BOOTSTRAP"]
    }),
    concernWriters: pickList({
      env,
      fileConfig,
      envKeys: ["CONCERN_WRITERS"],
      fileKeys: ["concernWriters", "CONCERN_WRITERS"]
    }),
    validation: String(
      pickValue({
        env,
        fileConfig,
        envKeys: ["VALIDATION"],
        fileKeys: ["validation", "VALIDATION"],
        fallback: "1"
      })
    ).trim(),
    updateIntervalMs: pickPositiveInt({
      env,
      fileConfig,
      envKeys: ["UPDATE_INTERVAL_MS"],
      fileKeys: ["updateIntervalMs", "UPDATE_INTERVAL_MS"],
      fallback: defaultUpdateIntervalMs
    }),
    heartbeatMs: pickPositiveInt({
      env,
      fileConfig,
      envKeys: ["HEARTBEAT_MS"],
      fileKeys: ["heartbeatMs", "HEARTBEAT_MS"],
      fallback: defaultHeartbeatMs
    }),
    swarmSeed: pickSeedHex({
      env,
      fileConfig,
      envKeys: ["SWARM_SEED_HEX"],
      fileKeys: ["swarmSeedHex", "SWARM_SEED_HEX"]
    })
  };
}

function normalizeOperatorCliConfig({
  fileConfig = {},
  env = {},
  defaultCorestoreDir,
  defaultTopicZ32,
  defaultTimeoutMs
}) {
  return {
    corestoreDir: pickResolvedPath({
      env,
      fileConfig,
      envKeys: ["CORESTORE_DIR"],
      fileKeys: ["corestoreDir", "CORESTORE_DIR"],
      fallback: defaultCorestoreDir
    }),
    swarmTopics: pickList({
      env,
      fileConfig,
      envKeys: ["SWARM_TOPICS", "SWARM_TOPIC"],
      fileKeys: ["swarmTopics", "SWARM_TOPICS", "SWARM_TOPIC"],
      fallback: [defaultTopicZ32]
    }),
    swarmBootstrap: pickList({
      env,
      fileConfig,
      envKeys: ["SWARM_BOOTSTRAP"],
      fileKeys: ["swarmBootstrap", "SWARM_BOOTSTRAP"]
    }),
    timeoutMs: pickPositiveInt({
      env,
      fileConfig,
      envKeys: ["OPERATOR_TIMEOUT_MS"],
      fileKeys: ["timeoutMs", "OPERATOR_TIMEOUT_MS"],
      fallback: defaultTimeoutMs
    }),
    swarmSeed: pickSeedHex({
      env,
      fileConfig,
      envKeys: ["SWARM_SEED_HEX"],
      fileKeys: ["swarmSeedHex", "SWARM_SEED_HEX"]
    })
  };
}

export {
  normalizeDiscoveryHostConfig,
  normalizeConcernHostConfig,
  normalizeOperatorCliConfig
};
