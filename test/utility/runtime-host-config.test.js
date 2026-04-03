import path from "path";
import test from "brittle";
import {
  normalizeConcernHostConfig,
  normalizeDiscoveryHostConfig,
  normalizeOperatorCliConfig
} from "../../src/util/runtime-host-config.js";

const DEFAULT_TOPIC = "topic-z32";

test("discovery host config accepts preferred camelCase JSON keys", (t) => {
  const cfg = normalizeDiscoveryHostConfig({
    fileConfig: {
      corestoreDir: "./var/discovery",
      discoveryKey: "disc-z32",
      discoveryCreate: true,
      swarmTopics: ["topic-a", "topic-b"],
      swarmBootstrap: ["127.0.0.1:49737"],
      discoveryWriters: ["writer-z32"],
      updateIntervalMs: 2000,
      heartbeatMs: 45000,
      swarmSeedHex: "aa".repeat(32)
    },
    env: {},
    defaultCorestoreDir: "/fallback/discovery",
    defaultTopicZ32: DEFAULT_TOPIC,
    defaultUpdateIntervalMs: 1500,
    defaultHeartbeatMs: 30000
  });

  t.is(cfg.corestoreDir, path.resolve("./var/discovery"));
  t.is(cfg.discoveryKey, "disc-z32");
  t.is(cfg.create, true);
  t.alike(cfg.swarmTopics, ["topic-a", "topic-b"]);
  t.alike(cfg.swarmBootstrap, ["127.0.0.1:49737"]);
  t.alike(cfg.discoveryWriters, ["writer-z32"]);
  t.is(cfg.updateIntervalMs, 2000);
  t.is(cfg.heartbeatMs, 45000);
  t.is(cfg.swarmSeed.toString("hex"), "aa".repeat(32));
});

test("discovery host config keeps legacy uppercase keys and env precedence", (t) => {
  const cfg = normalizeDiscoveryHostConfig({
    fileConfig: {
      CORESTORE_DIR: "./legacy/discovery",
      DISCOVERY_KEY: "disc-from-file",
      SWARM_TOPICS: ["topic-file"],
      SWARM_BOOTSTRAP: ["127.0.0.1:1"],
      DISCOVERY_WRITERS: ["writer-file"],
      UPDATE_INTERVAL_MS: 1111,
      HEARTBEAT_MS: 2222
    },
    env: {
      DISCOVERY_KEY: "disc-from-env",
      SWARM_TOPICS: "topic-env-a,topic-env-b",
      DISCOVERY_WRITERS: "writer-env"
    },
    defaultCorestoreDir: "/fallback/discovery",
    defaultTopicZ32: DEFAULT_TOPIC,
    defaultUpdateIntervalMs: 1500,
    defaultHeartbeatMs: 30000
  });

  t.is(cfg.corestoreDir, path.resolve("./legacy/discovery"));
  t.is(cfg.discoveryKey, "disc-from-env");
  t.alike(cfg.swarmTopics, ["topic-env-a", "topic-env-b"]);
  t.alike(cfg.discoveryWriters, ["writer-env"]);
  t.is(cfg.updateIntervalMs, 1111);
  t.is(cfg.heartbeatMs, 2222);
});

test("concern host config prefers concernKeys and still accepts legacy concerns aliases", (t) => {
  const cfg = normalizeConcernHostConfig({
    fileConfig: {
      corestoreDir: "./var/concern",
      concernKeys: ["concern-a"],
      swarmTopics: ["topic-a"],
      concernWriters: ["writer-a"],
      validation: 1,
      updateIntervalMs: 2000,
      heartbeatMs: 45000
    },
    env: {
      CONCERNS: "concern-env"
    },
    defaultCorestoreDir: "/fallback/concern",
    defaultTopicZ32: DEFAULT_TOPIC,
    defaultUpdateIntervalMs: 1500,
    defaultHeartbeatMs: 30000
  });

  t.is(cfg.corestoreDir, path.resolve("./var/concern"));
  t.alike(cfg.concerns, ["concern-env"]);
  t.alike(cfg.swarmTopics, ["topic-a"]);
  t.alike(cfg.concernWriters, ["writer-a"]);
  t.is(cfg.validation, "1");
  t.is(cfg.updateIntervalMs, 2000);
  t.is(cfg.heartbeatMs, 45000);
});

test("operator CLI config accepts preferred camelCase JSON keys and legacy uppercase keys", (t) => {
  const camel = normalizeOperatorCliConfig({
    fileConfig: {
      corestoreDir: "./operator/store",
      swarmTopics: ["topic-a"],
      swarmBootstrap: ["127.0.0.1:3000"],
      timeoutMs: 2222,
      swarmSeedHex: "bb".repeat(32)
    },
    env: {},
    defaultCorestoreDir: "/fallback/operator",
    defaultTopicZ32: DEFAULT_TOPIC,
    defaultTimeoutMs: 15000
  });

  t.is(camel.corestoreDir, path.resolve("./operator/store"));
  t.alike(camel.swarmTopics, ["topic-a"]);
  t.alike(camel.swarmBootstrap, ["127.0.0.1:3000"]);
  t.is(camel.timeoutMs, 2222);
  t.is(camel.swarmSeed.toString("hex"), "bb".repeat(32));

  const legacy = normalizeOperatorCliConfig({
    fileConfig: {
      CORESTORE_DIR: "./legacy/operator",
      SWARM_TOPICS: ["topic-legacy"],
      OPERATOR_TIMEOUT_MS: 3333
    },
    env: {},
    defaultCorestoreDir: "/fallback/operator",
    defaultTopicZ32: DEFAULT_TOPIC,
    defaultTimeoutMs: 15000
  });

  t.is(legacy.corestoreDir, path.resolve("./legacy/operator"));
  t.alike(legacy.swarmTopics, ["topic-legacy"]);
  t.is(legacy.timeoutMs, 3333);
});
