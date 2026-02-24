import Repl from "repl";
import dot from "dotenv";
import path from "path";
import { access } from "fs/promises";
import { pathToFileURL } from "url";
import idEncoding from "hypercore-id-encoding";
import Hyperswarm from "hyperswarm";
import { createRunner } from "./src/agent/runner.js";
import { createRatifierActor } from "./src/dx/index.js";
import { createKeyPair, defaultTopics } from "./src/util/createKeyPair.js";
import { ensureCorestore } from "./src/ensureCorestore.js";

dot.config();
const DEFAULT_RAT_ACTOR = "fn-rat";
const DEFAULT_FN_RAT_MODULE = path.resolve(process.cwd(), "docs/examples/fn-rat/example.js");

const DISCOVERY_ENV = String(process.env.DISCOVERY_ID || "").trim();
let discoveryIds = DISCOVERY_ENV ? [normalizeDiscoveryId(DISCOVERY_ENV, { fatal: true })] : [];
const keyPair = createKeyPair("ratifier");
const [testTopic] = defaultTopics(1);
const swarm = new Hyperswarm({ keyPair });
swarm.join(testTopic);

const corestore = ensureCorestore("./store/ratifier");
const done = corestore.findingPeers();
swarm.flush().then(done, done);

let warmN = intEnv("RAT_WARM_N", 1, 1, 256);
let loopMs = intEnv("RAT_TICK_MS", 1000, 50, 60_000);
let actorSpec = String(process.env.RAT_ACTOR || DEFAULT_RAT_ACTOR).trim() || DEFAULT_RAT_ACTOR;
if (!process.env.RAT_ACTOR) process.env.RAT_ACTOR = actorSpec;
let fnModuleSpec = String(process.env.FN_RAT_MODULE || "").trim();
if (!fnModuleSpec) {
  fnModuleSpec = DEFAULT_FN_RAT_MODULE;
  process.env.FN_RAT_MODULE = fnModuleSpec;
}
const actorLoaded = await maybeLoadRatifierActor(actorSpec).catch((err) => {
  console.error("[ratifier] failed to load RAT_ACTOR:", err?.message || err);
  process.exitCode = 1;
  process.exit();
});
let actorRef = actorLoaded?.actor || null;
let actorName = actorLoaded?.name || null;
let actorPath = actorLoaded?.resolvedPath || null;

let runner = await buildRunner();
let loopTimer = null;
let loopRunning = false;
let tickPromise = null;
let closePromise = null;
let closed = false;

console.log(
  `[ratifier] discovery=${discoveryIds[0] || "<none>"} warmN=${warmN} actor=${actorName || "none"} fnModule=${fnModuleSpec || "<unset>"}`
);
console.log("[ratifier] use help() for commands");
if (discoveryIds.length === 0) {
  console.warn("[ratifier] warning: no discovery keys configured; runner is idle until addDiscovery(<z32>)");
}

const repl = Repl.start({ prompt: "ratifier> " });
Object.assign(repl.context, {
  help,
  tick,
  debugNextDiscovery: tick,
  start,
  stop,
  status,
  close,
  setWarmN,
  addDiscovery,
  discoveries,
  setActor,
  setFnModule,
  actor,
  fnModule,
  get discoveryId() {
    return discoveryIds[0] || null;
  },
  get actorName() {
    return actorName;
  }
});

process.on("SIGINT", () => {
  void close();
});
process.on("SIGTERM", () => {
  void close();
});

async function buildRunner() {
  const created = await createRunner({
    role: "ratifier",
    corestore,
    swarm,
    discoveryKeys: discoveryIds,
    warmN,
    projector: actorRef ? async (ctx) => actorRef.projector(ctx) : async function noopProjector() {}
  });
  actorRef?.bind({ runner: created, stateBee: created.stateBee });
  return created;
}

async function tick() {
  if (closed) {
    console.error("[ratifier] runner closed");
    return null;
  }
  if (!runner) {
    console.error("[ratifier] runner unavailable");
    return null;
  }
  if (tickPromise) return tickPromise;
  tickPromise = (async () => {
    try {
      await runner.tick();
      return true;
    } catch (err) {
      console.error("[ratifier] tick failed:", err?.stack || err?.message || err);
      return false;
    } finally {
      tickPromise = null;
    }
  })();
  return tickPromise;
}

function start(ms) {
  if (closed) return { running: false, closed: true };
  if (loopRunning) return { running: true, intervalMs: loopMs };
  const parsed = parseMs(ms);
  if (parsed != null) loopMs = parsed;
  loopRunning = true;

  const loop = async () => {
    if (!loopRunning || closed) return;
    await tick();
    if (!loopRunning || closed) return;
    loopTimer = setTimeout(loop, loopMs);
  };

  loopTimer = setTimeout(loop, 0);
  return { running: true, intervalMs: loopMs };
}

function stop() {
  loopRunning = false;
  if (loopTimer) clearTimeout(loopTimer);
  loopTimer = null;
  return { running: false };
}

function status() {
  return {
    closed,
    running: loopRunning,
    intervalMs: loopMs,
    warmN,
    idle: discoveryIds.length === 0,
    discoveryId: discoveryIds[0] || null,
    discoveryIds: [...discoveryIds],
    actorName: actorName || null,
    actorPath: actorPath || null,
    actorSpec: actorSpec || null,
    fnModule: fnModuleSpec || null,
    runner: runner?.getStatus?.() || null
  };
}

async function setWarmN(nextWarmN) {
  let parsed = null;
  try {
    parsed = normalizeWarmN(nextWarmN);
  } catch (err) {
    console.error("[ratifier] setWarmN failed:", err?.message || err);
    return status();
  }
  stop();
  await runner?.close?.().catch((err) => {
    console.error("[ratifier] close during setWarmN failed:", err?.message || err);
  });
  warmN = parsed;
  runner = await buildRunner();
  return status();
}

async function addDiscovery(nextDiscoveryId) {
  if (closed) {
    console.error("[ratifier] runner closed");
    return discoveries();
  }

  let normalized = null;
  try {
    normalized = normalizeDiscoveryId(nextDiscoveryId, { fatal: false });
  } catch {
    return discoveries();
  }

  if (discoveryIds.includes(normalized)) {
    console.log(`[ratifier] discovery already present: ${normalized}`);
    return discoveries();
  }

  stop();
  await runner?.close?.().catch((err) => {
    console.error("[ratifier] close during addDiscovery failed:", err?.message || err);
  });
  discoveryIds = [...discoveryIds, normalized];
  runner = await buildRunner();
  return discoveries();
}

function discoveries() {
  const out = [...discoveryIds];
  console.log(out);
  return out;
}

async function setActor(nameOrPath) {
  if (closed) {
    console.error("[ratifier] runner closed");
    return actor();
  }

  const nextSpec = String(nameOrPath ?? "").trim();
  const prev = {
    actorSpec,
    actorRef,
    actorName,
    actorPath
  };

  stop();
  await runner?.close?.().catch((err) => {
    console.error("[ratifier] close during setActor failed:", err?.message || err);
  });

  try {
    const next = await maybeLoadRatifierActor(nextSpec);
    actorSpec = nextSpec;
    actorRef = next?.actor || null;
    actorName = next?.name || null;
    actorPath = next?.resolvedPath || null;
  } catch (err) {
    console.error("[ratifier] setActor failed:", err?.message || err);
    actorSpec = prev.actorSpec;
    actorRef = prev.actorRef;
    actorName = prev.actorName;
    actorPath = prev.actorPath;
  }

  runner = await buildRunner();
  return actor();
}

async function setFnModule(modulePath) {
  if (closed) {
    console.error("[ratifier] runner closed");
    return fnModule();
  }

  const nextPath = String(modulePath ?? "").trim();
  if (!nextPath) {
    console.error("[ratifier] setFnModule(path) requires a non-empty module path");
    return fnModule();
  }

  const resolvedPath = path.resolve(nextPath);
  try {
    await access(resolvedPath);
  } catch (err) {
    console.error("[ratifier] setFnModule failed:", err?.message || err);
    return fnModule();
  }

  stop();
  await runner?.close?.().catch((err) => {
    console.error("[ratifier] close during setFnModule failed:", err?.message || err);
  });

  process.env.FN_RAT_MODULE = resolvedPath;
  fnModuleSpec = resolvedPath;
  runner = await buildRunner();
  return fnModule();
}

function actor() {
  const out = {
    loaded: !!actorRef,
    name: actorName || null,
    spec: actorSpec || null,
    resolvedPath: actorPath || null,
    fnModule: fnModuleSpec || null
  };
  console.log(out);
  return out;
}

function fnModule() {
  const out = {
    module: fnModuleSpec || null,
    activeActor: actorName || actorSpec || null,
    usedByActiveActor: isFnRatActorLoaded()
  };
  console.log(out);
  return out;
}

async function close() {
  if (closePromise) return closePromise;
  closePromise = (async () => {
    if (closed) return { closed: true };
    stop();
    await runner?.close?.().catch((err) => {
      console.error("[ratifier] runner close failed:", err?.message || err);
    });
    runner = null;
    await swarm.close?.().catch(() => {});
    await corestore.close?.().catch(() => {});
    closed = true;
    return { closed: true };
  })();
  return closePromise;
}

function help() {
  const lines = [
    "Commands:",
    "  help()                Show this help.",
    "  tick()                Run one runner pass.",
    "  debugNextDiscovery()  Alias of tick().",
    "  start(ms?)            Start tick loop (default RAT_TICK_MS or 1000ms).",
    "  stop()                Stop tick loop.",
    "  status()              Show runner + loop status.",
    "  setWarmN(n)           Rebuild runner with new warmN.",
    "  addDiscovery(z32)     Add discovery key and rebuild runner.",
    "  discoveries()         List active discovery keys.",
    "  setActor(nameOrPath)  Load/replace actor and rebuild runner.",
    "  setFnModule(path)     Set FN_RAT_MODULE and rebuild runner.",
    "  actor()               Show current actor resolution + loaded state.",
    "  fnModule()            Show current FN_RAT_MODULE and actor usage.",
    "  close()               Stop loop and close runner/corestore/swarm.",
    "",
    "Env:",
    `  DISCOVERY_ID (optional startup key): ${discoveryIds[0] || "<unset>"}`,
    `  RAT_WARM_N (default 1): ${warmN}`,
    `  RAT_TICK_MS (default 1000): ${loopMs}`,
    `  RAT_ACTOR (default fn-rat): ${actorSpec || "<unset>"}`,
    `  FN_RAT_MODULE (default docs example): ${fnModuleSpec || "<unset>"}`,
    "",
    "Notes:",
    "  - This script is an orientation shell (default actor is fn-rat).",
    "  - If no discovery is configured, tick/start will run idle until addDiscovery(z32).",
    "  - Use scripts/run-ecology.js for full ECO_DEFS/ECO_PACK/ECO_RATIFIERS flows."
  ];
  console.log(lines.join("\n"));
}

function normalizeDiscoveryId(raw, { fatal = true } = {}) {
  try {
    return idEncoding.encode(idEncoding.decode(raw));
  } catch (err) {
    console.error("[ratifier] invalid DISCOVERY_ID; expected z32 Hypercore key");
    console.error("[ratifier] value:", raw);
    console.error("[ratifier] decode error:", err?.message || err);
    if (fatal) {
      process.exitCode = 1;
      process.exit();
    }
    throw err;
  }
}

function parseMs(value) {
  if (value == null) return null;
  const n = Number.parseInt(String(value), 10);
  if (!Number.isFinite(n) || n < 50 || n > 60_000) {
    console.error("[ratifier] interval must be integer between 50 and 60000 ms");
    return null;
  }
  return n;
}

function intEnv(name, fallback, min, max) {
  const parsed = Number.parseInt(String(process.env[name] ?? ""), 10);
  const value = Number.isFinite(parsed) ? parsed : fallback;
  return Math.min(max, Math.max(min, value));
}

function normalizeWarmN(value) {
  const parsed = Number.parseInt(String(value ?? ""), 10);
  if (!Number.isFinite(parsed) || parsed < 1) {
    throw new Error("warmN must be a positive integer");
  }
  return Math.min(256, parsed);
}

function isFnRatActorLoaded() {
  if (actorName === "fn-rat" || actorSpec === "fn-rat") return true;
  return typeof actorPath === "string" && actorPath.endsWith(`${path.sep}fn-rat.js`);
}

async function maybeLoadRatifierActor(spec) {
  if (!spec) return null;
  const filePath = await resolveActorPath({ spec, folder: "ratifiers" });
  const mod = await import(pathToFileURL(filePath).href);
  const definition = mod.default ?? mod.definition ?? mod;
  if (!definition || typeof definition.onTick !== "function") {
    throw new Error(`invalid actor at ${filePath}: missing definition.onTick`);
  }
  const name = String(definition.name || path.basename(filePath, ".js"));
  const actor = createRatifierActor({
    name,
    definition,
    logger: console
  });
  return { actor, name, resolvedPath: filePath };
}

async function resolveActorPath({ spec, folder }) {
  const raw = String(spec || "").trim();
  if (!raw) throw new Error("empty actor spec");

  const asPath = raw.includes("/") || raw.startsWith(".") || raw.endsWith(".js");
  const candidate = asPath
    ? path.resolve(raw)
    : path.resolve(process.cwd(), folder, `${raw}.js`);

  await access(candidate);
  return candidate;
}
