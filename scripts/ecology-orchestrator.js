import crypto from "crypto";
import path from "path";
import { mkdir, access, readFile } from "fs/promises";
import { setTimeout as sleep } from "timers/promises";
import { pathToFileURL } from "url";
import Corestore from "corestore";
import Hyperswarm from "hyperswarm";
import Autobase from "autobase";
import b4a from "b4a";
import idEncoding from "hypercore-id-encoding";

import {
  ensureDiscoverySurface,
  addConcern,
  addWriter as addDiscoveryWriter
} from "../src/discovery.js";
import {
  ensureConcernSurface,
  createJob,
  getJobView,
  getPublishView,
  getRatView,
  OP
} from "../src/concern.js";
import { createRunner } from "../src/agent/runner.js";
import { createOrganismActor, createRatifierActor } from "../src/dx/index.js";
import { waitForSwarmConnections, flushDiscovery } from "../src/util/waiters/swarm.js";
import { waitForCorePeers } from "../src/util/waiters/core.js";

const DEFAULTS = {
  durationMs: 180_000,
  readyMs: 45_000,
  stableMs: 400,
  pulseAtRatio: 0.6,
  metricsMs: 5_000,
  tickMinMs: 250,
  tickMaxMs: 800,
  jobsPerConcern: 3,
  concerns: 2,
  orgs: 3,
  storeRoot: "./store/ecology",
  defsEnabled: false,
  defsDir: "",
  defsPack: "",
  packsDir: "",
  organismNames: [],
  ratifierNames: []
};

const ORG_LABELS = "ABCDEFGHIJKLMNOPQRSTUVWXYZ".split("");
const RAT_LABELS = ["A", "B"];
const MAX_TRANSPORT_ERROR_SAMPLES = 5;

/**
 * The normalizer intentionally lives in the orchestration module so this file can be imported
 * directly by other scripts without duplicating parsing logic. The CLI wrapper can pass raw
 * values, and this function enforces bounded values before any swarms/corestores are created.
 */
function normalizeConfig(input = {}) {
  const cfg = {
    durationMs: intOr(input.durationMs, DEFAULTS.durationMs, 1_000, 3_600_000),
    readyMs: intOr(input.readyMs, DEFAULTS.readyMs, 1_000, 300_000),
    stableMs: intOr(input.stableMs, DEFAULTS.stableMs, 50, 10_000),
    pulseAtRatio: numOr(input.pulseAtRatio, DEFAULTS.pulseAtRatio, 0.1, 0.95),
    metricsMs: intOr(input.metricsMs, DEFAULTS.metricsMs, 500, 60_000),
    tickMinMs: intOr(input.tickMinMs, DEFAULTS.tickMinMs, 50, 30_000),
    tickMaxMs: intOr(input.tickMaxMs, DEFAULTS.tickMaxMs, 50, 30_000),
    jobsPerConcern: intOr(input.jobsPerConcern, DEFAULTS.jobsPerConcern, 1, 100),
    concerns: intOr(input.concerns, DEFAULTS.concerns, 1, 8),
    orgs: intOr(input.orgs, DEFAULTS.orgs, 1, 8),
    storeRoot: String(input.storeRoot || DEFAULTS.storeRoot),
    seedHex: String(input.seedHex || "").trim(),
    defsEnabled: boolOr(input.defsEnabled, DEFAULTS.defsEnabled),
    defsDir: String(input.defsDir || DEFAULTS.defsDir || "").trim(),
    defsPack: String(input.defsPack || input.packName || DEFAULTS.defsPack || "").trim(),
    packsDir: String(input.packsDir || DEFAULTS.packsDir || "").trim(),
    organismNames: listOr(input.organismNames || input.orgActorNames || DEFAULTS.organismNames),
    ratifierNames: listOr(input.ratifierNames || input.ratActorNames || DEFAULTS.ratifierNames)
  };

  if (cfg.tickMaxMs < cfg.tickMinMs) {
    const tmp = cfg.tickMinMs;
    cfg.tickMinMs = cfg.tickMaxMs;
    cfg.tickMaxMs = tmp;
  }
  if (cfg.orgs > ORG_LABELS.length) cfg.orgs = ORG_LABELS.length;

  // Seed is used for deterministic topic/scheduler derivation so runs can be repeated.
  if (cfg.seedHex && /^[0-9a-fA-F]{64}$/.test(cfg.seedHex)) {
    cfg.seed = Buffer.from(cfg.seedHex, "hex");
  } else if (cfg.seedHex) {
    cfg.seed = crypto.createHash("sha256").update(cfg.seedHex).digest().subarray(0, 32);
    cfg.seedHex = cfg.seed.toString("hex");
  } else {
    cfg.seed = crypto.randomBytes(32);
    cfg.seedHex = cfg.seed.toString("hex");
  }

  cfg.storeRoot = path.resolve(cfg.storeRoot);
  if (cfg.packsDir) cfg.packsDir = path.resolve(cfg.packsDir);
  return cfg;
}

/**
 * The exported orchestrator is intentionally script-focused (not a protocol API).
 * It demonstrates ecology behavior while preserving v0 boundaries:
 * - acceptance is derived-view materialization
 * - discovery is advertisement only
 * - ratifier selectivity lives in edge projector policy
 */
async function runEcologyOrchestrator(input = {}) {
  const cfg = normalizeConfig(input);
  const runtime = {
    phase: "bringup",
    publishEnabled: false,
    stopRequested: false,
    stopReason: null,
    transportErrors: { count: 0, samples: [] }
  };
  const resources = {
    swarms: [],
    swarmErrorDetachers: [],
    joins: [],
    corestores: [],
    runnersOrg: [],
    runnersRat: [],
    concerns: [],
    discovery: null
  };
  const inFlight = new Set();
  const loops = [];
  const signalHandlers = [];

  let runError = null;
  let stopResolve = null;
  const stopPromise = new Promise((resolve) => {
    stopResolve = resolve;
  });

  function requestStop(reason) {
    if (runtime.stopRequested) return;
    runtime.stopRequested = true;
    runtime.stopReason = reason;
    stopResolve?.(reason);
  }

  installSignal("SIGINT", requestStop, signalHandlers);
  installSignal("SIGTERM", requestStop, signalHandlers);

  try {
    await mkdir(cfg.storeRoot, { recursive: true });
    logConfig(cfg);

    // Shared topic is the intentional "ecology arena": every role joins as both client/server.
    const sharedTopic = deriveSeed(cfg.seed, "topic:ecology-shared");

    // Corestore isolation is explicit and path-based here. Each role identity has exactly one
    // corestore instance and never shares that object with another role.
    const discoveryStore = await openRoleCorestore(cfg.storeRoot, "discovery", resources.corestores);
    const hostStore = await openRoleCorestore(cfg.storeRoot, "host", resources.corestores);
    const orgActors = [];
    for (let i = 0; i < cfg.orgs; i++) {
      const label = ORG_LABELS[i];
      const store = await openRoleCorestore(cfg.storeRoot, `org-${label}`, resources.corestores);
      orgActors.push({ label, store });
    }
    const ratActors = [];
    for (const label of RAT_LABELS) {
      const store = await openRoleCorestore(cfg.storeRoot, `rat-${label}`, resources.corestores);
      ratActors.push({ label, store });
    }

    // Each role gets its own Hyperswarm instance to keep role boundaries visible.
    const discoverySwarm = openRoleSwarm({
      role: "discovery",
      cfg,
      runtime,
      swarms: resources.swarms,
      detachers: resources.swarmErrorDetachers
    });
    const hostSwarm = openRoleSwarm({
      role: "host",
      cfg,
      runtime,
      swarms: resources.swarms,
      detachers: resources.swarmErrorDetachers
    });
    for (const actor of orgActors) {
      actor.swarm = openRoleSwarm({
        role: `org-${actor.label}`,
        cfg,
        runtime,
        swarms: resources.swarms,
        detachers: resources.swarmErrorDetachers
      });
    }
    for (const actor of ratActors) {
      actor.swarm = openRoleSwarm({
        role: `rat-${actor.label}`,
        cfg,
        runtime,
        swarms: resources.swarms,
        detachers: resources.swarmErrorDetachers
      });
    }

    // Join all swarms to the same arena topic. We keep join handles to flush and to destroy later.
    const allRoleSwarms = [discoverySwarm, hostSwarm, ...orgActors.map((x) => x.swarm), ...ratActors.map((x) => x.swarm)];
    for (const swarm of allRoleSwarms) {
      const handle = swarm.join(sharedTopic, { server: true, client: true });
      resources.joins.push({ label: `${swarm.__role}:shared`, swarm, handle });
    }

    // Discovery is used as advertisement only; no scheduling semantics are introduced here.
    const discovery = await ensureDiscoverySurface(discoveryStore.namespace("discovery-host"), {}, discoverySwarm);
    resources.discovery = discovery;
    await addDiscoveryWriter(discovery, discovery.local.key);
    await discovery.update({ wait: true });
    console.log(`[bringup] discovery key=${idEncoding.encode(discovery.key)}`);

    // Also join the discovery-key topic for every swarm. This gives discovery roam an explicit path.
    for (const swarm of allRoleSwarms) {
      const handle = swarm.join(discovery.key, { server: true, client: true });
      resources.joins.push({ label: `${swarm.__role}:discovery-key`, swarm, handle });
    }

    // Host opens multiple concerns from one host corestore via namespaces.
    // This keeps one corestore per role while still separating concern surfaces.
    const concerns = [];
    for (let i = 0; i < cfg.concerns; i++) {
      const concernId = `concern-${i + 1}`;
      const base = await ensureConcernSurface(hostStore.namespace(`concern-host-${i + 1}`), hostSwarm);
      await base.append(
        { op: OP.STATE, v: 1, econ: { mode: 0, attemptBurn: 0, ratBurn: 0 } },
        { optimistic: false }
      );
      await base.update({ wait: true });

      const jobKeys = [];
      for (let j = 0; j < cfg.jobsPerConcern; j++) {
        const jobKey = await createJob(base, `cap/ecology/job/${i + 1}`, {
          concern: concernId,
          ordinal: j + 1,
          createdAt: Date.now()
        });
        jobKeys.push(jobKey);
      }

      // Verify host-side job leaves exist before ecology loops begin.
      const jobView = getJobView(base);
      for (const jobKey of jobKeys) {
        const leaf = await jobView.get(jobKey).catch(() => null);
        if (!leaf) throw new Error(`host job leaf missing for ${concernId}`);
      }

      await addConcern(discovery, idEncoding.encode(base.key), concernId);
      await discovery.update({ wait: true });

      concerns.push({
        id: concernId,
        base,
        key: base.key,
        keyHex: b4a.toString(base.key, "hex"),
        jobKeys,
        jobView,
        publishView: getPublishView(base),
        ratView: getRatView(base)
      });
      console.log(`[bringup] ${concernId} key=${idEncoding.encode(base.key)} jobs=${jobKeys.length}`);
    }
    resources.concerns = concerns;

    const discoveryKey = idEncoding.encode(discovery.key);
    const prng = createPrng(deriveSeed(cfg.seed, "scheduler"));
    const defs = await maybeLoadEcologyDefinitions({ cfg, orgCount: cfg.orgs });
    const selectedOrganismNames = defs?.selectedOrganisms || [];
    const selectedRatifierNames = defs?.selectedRatifiers || [];

    // Per-organism projector state and deterministic attempt generation.
    for (let i = 0; i < orgActors.length; i++) {
      const actor = orgActors[i];
      const selectedName = selectNameForIndex(selectedOrganismNames, i);
      const definition = selectedName ? defs?.organisms?.get(selectedName) : null;

      if (definition) {
        actor.dx = createOrganismActor({
          name: selectedName,
          definition,
          logger: console
        });
        actor.projector = async (ctx) => {
          if (!runtime.publishEnabled) return;
          await actor.dx.projector(ctx);
        };
      } else if (selectedName) {
        console.warn(`[defs] missing organism definition '${selectedName}' for org-${actor.label}; using built-in projector`);
      }

      if (!actor.projector) {
        const policy = actor.label === "C"
          ? { minGapMs: 1600, maxGapMs: 3200, publishChance: 0.35 }
          : { minGapMs: 500, maxGapMs: 1400, publishChance: 0.75 };
        const attemptFactory = createAttemptTokenFactory(cfg.seed, `org-${actor.label}`);
        actor.projector = createOrganismProjector({
          label: actor.label,
          policy,
          runtime,
          prng,
          nextAttemptToken: attemptFactory
        });
      }

      if (selectedName && definition) {
        console.log(`[defs] org-${actor.label} -> ${selectedName}`);
      }

      actor.runner = await createRunner({
        role: "org",
        corestore: actor.store,
        swarm: actor.swarm,
        discoveryKeys: [discoveryKey],
        warmN: cfg.concerns,
        warmupBudget: { maxTicks: 0, maxMs: 0, minViewReadable: true },
        projector: actor.projector
      });
      actor.dx?.bind({ runner: actor.runner, stateBee: actor.runner.stateBee });
      resources.runnersOrg.push(actor.runner);
    }

    // RatA: default ratify-all. RatB: selective projector policy ("keep" only).
    const ratA = ratActors.find((x) => x.label === "A");
    const ratB = ratActors.find((x) => x.label === "B");
    const ratifierSelectionProvided = Array.isArray(selectedRatifierNames) && selectedRatifierNames.length > 0;
    const ratAName = selectedRatifierNames[0] || null;
    const ratBName = selectedRatifierNames[1] || null;
    const ratADefinition = ratAName ? defs?.ratifiers?.get(ratAName) : null;
    const ratBDefinition = ratBName ? defs?.ratifiers?.get(ratBName) : null;

    if (ratADefinition) {
      ratA.dx = createRatifierActor({
        name: ratAName,
        definition: ratADefinition,
        logger: console
      });
      console.log(`[defs] rat-A -> ${ratAName}`);
    } else if (ratAName) {
      console.warn(`[defs] missing ratifier definition '${ratAName}' for rat-A; using built-in behavior`);
    }
    ratA.runner = await createRunner({
      role: "ratifier",
      corestore: ratA.store,
      swarm: ratA.swarm,
      discoveryKeys: [discoveryKey],
      warmN: cfg.concerns,
      warmupBudget: { maxTicks: 0, maxMs: 0, minViewReadable: true },
      projector: ratA.dx
        ? async (ctx) => {
          if (!runtime.publishEnabled) return;
          await ratA.dx.projector(ctx);
        }
        : undefined
    });
    ratA.dx?.bind({ runner: ratA.runner, stateBee: ratA.runner.stateBee });
    resources.runnersRat.push(ratA.runner);

    if (ratBDefinition) {
      ratB.dx = createRatifierActor({
        name: ratBName,
        definition: ratBDefinition,
        logger: console
      });
      console.log(`[defs] rat-B -> ${ratBName}`);
    } else if (ratBName) {
      console.warn(`[defs] missing ratifier definition '${ratBName}' for rat-B; using built-in behavior`);
    }
    ratB.runner = await createRunner({
      role: "ratifier",
      corestore: ratB.store,
      swarm: ratB.swarm,
      discoveryKeys: [discoveryKey],
      warmN: cfg.concerns,
      warmupBudget: { maxTicks: 0, maxMs: 0, minViewReadable: true },
      projector: ratB.dx
        ? async (ctx) => {
          if (!runtime.publishEnabled) return;
          await ratB.dx.projector(ctx);
        }
        : ratifierSelectionProvided
          ? async function noopRatBProjector() {}
          : createSelectiveRatifierProjector("B")
    });
    ratB.dx?.bind({ runner: ratB.runner, stateBee: ratB.runner.stateBee });
    resources.runnersRat.push(ratB.runner);

    // Ratifier keys are concern-specific because each concern replica uses a distinct namespace.
    // We precompute them so metrics can count rat leaves under exact derived-view paths.
    const ratifierKeysByConcern = {
      A: new Map(),
      B: new Map()
    };
    for (const concern of concerns) {
      ratifierKeysByConcern.A.set(
        concern.id,
        await Autobase.getLocalKey(ratA.store.namespace(`concern-${concern.keyHex}`))
      );
      ratifierKeysByConcern.B.set(
        concern.id,
        await Autobase.getLocalKey(ratB.store.namespace(`concern-${concern.keyHex}`))
      );
    }

    runtime.phase = "ready";
    await waitForEcologyReadiness({
      cfg,
      runtime,
      joins: resources.joins,
      swarms: allRoleSwarms,
      concerns,
      discovery,
      runners: [...resources.runnersOrg, ...resources.runnersRat],
      updateHostConcerns: () => updateConcernHosts(concerns)
    });
    console.log("[ready] readiness gate passed; enabling publishing/ratification loops");

    runtime.publishEnabled = true;
    runtime.phase = "execute";

    // Runner loops are role-local and jittered. The jitter intentionally avoids lockstep behavior
    // that can hide timing issues in ecology demos.
    for (const actor of orgActors) {
      loops.push(createRunnerLoop({
        label: `org-${actor.label}`,
        runner: actor.runner,
        cfg,
        runtime,
        inFlight,
        prng
      }));
    }
    for (const actor of ratActors) {
      loops.push(createRunnerLoop({
        label: `rat-${actor.label}`,
        runner: actor.runner,
        cfg,
        runtime,
        inFlight,
        prng
      }));
    }

    // Host concern updater loop keeps derived views current while other roles append optimistically.
    loops.push(createPeriodicLoop({
      label: "host-update",
      runtime,
      inFlight,
      prng,
      minMs: 200,
      maxMs: 350,
      task: async () => {
        await updateConcernHosts(concerns);
      }
    }));

    // Metrics are derived-view only by design. We do not inspect append success as acceptance proof.
    loops.push(createPeriodicLoop({
      label: "metrics",
      runtime,
      inFlight,
      prng,
      minMs: cfg.metricsMs,
      maxMs: cfg.metricsMs,
      task: async () => {
        const snapshot = await collectMetrics({ concerns, ratifierKeysByConcern });
        printMetrics({ runtime, snapshot });
      }
    }));

    const durationPromise = sleep(cfg.durationMs).then(() => "duration-elapsed");
    const reason = await Promise.race([stopPromise, durationPromise]);
    requestStop(reason || "unknown-stop");
  } catch (err) {
    if (err?.code === "ERR_ECO_STOP_REQUESTED") {
      runError = null;
    } else {
      runError = err;
    }
  } finally {
    runtime.phase = "teardown";
    runtime.publishEnabled = false;
    requestStop(runtime.stopReason || "teardown");

    // Stop loops first so no new work is scheduled while closing resources.
    for (const loop of loops) loop.stop();
    await Promise.allSettled(loops.map((loop) => loop.done));
    await Promise.allSettled(Array.from(inFlight));

    // Emit one final snapshot before closing views.
    if (resources.concerns.length > 0) {
      try {
        const ratifierKeysByConcern = await rebuildRatifierKeyMap(resources);
        const snapshot = await collectMetrics({
          concerns: resources.concerns,
          ratifierKeysByConcern
        });
        console.log("[final] final derived-view snapshot:");
        printMetrics({ runtime, snapshot });
      } catch (err) {
        console.error("[final] failed to produce final metrics:", err?.message || err);
      }
    }

    // Close in requested order: ratifiers -> organisms -> concern/discovery -> corestores -> swarms.
    await closeMany(resources.runnersRat);
    await closeMany(resources.runnersOrg);
    await closeMany(resources.concerns.map((x) => x.base));
    await closeMaybe(resources.discovery);
    await closeMany(resources.joins.map((x) => x.handle), destroyJoinHandle);
    await closeMany(resources.corestores);
    for (const detach of resources.swarmErrorDetachers) {
      try {
        detach();
      } catch {}
    }
    await closeMany(resources.swarms, closeSwarm);

    uninstallSignals(signalHandlers);
  }

  if (runError) throw runError;
  return {
    ok: true,
    seedHex: cfg.seedHex,
    stopReason: runtime.stopReason || "duration-elapsed",
    transportErrors: runtime.transportErrors
  };
}

function createOrganismProjector({ label, policy, runtime, prng, nextAttemptToken }) {
  const nextPublishAtByConcern = new Map();
  const keepRatio = 0.5;
  return async function organismProjector(ctx) {
    // Publishing is runtime-gated so readiness/warmup can run without mutating concern state.
    if (!runtime.publishEnabled) return;

    const concernHex = b4a.toString(ctx.concern.key, "hex");
    const now = Date.now();
    const nextAllowedAt = nextPublishAtByConcern.get(concernHex) || 0;
    if (now < nextAllowedAt) return;

    const jobs = [];
    for await (const job of ctx.jobs()) {
      // Some streams can surface sparse/non-leaf entries; only true job leaves are publish targets.
      if (!job?.key || !b4a.isBuffer(job.key)) continue;
      jobs.push(job);
    }
    if (jobs.length === 0) return;

    if (prng() > policy.publishChance) {
      nextPublishAtByConcern.set(concernHex, now + jitterRange(policy.minGapMs, policy.maxGapMs, prng));
      return;
    }

    const idx = Math.min(jobs.length - 1, Math.floor(prng() * jobs.length));
    const chosen = jobs[idx];
    if (!chosen?.key || !b4a.isBuffer(chosen.key)) {
      nextPublishAtByConcern.set(concernHex, now + jitterRange(policy.minGapMs, policy.maxGapMs, prng));
      return;
    }
    const keep = prng() < keepRatio;
    const tag = keep ? "keep" : "skip";
    const cap = keep ? "cap/ecology/keep" : "cap/ecology/skip";
    const attemptToken = nextAttemptToken();

    // Acceptance is still decided by concern.apply; this is proposal-only behavior.
    await ctx.publish.publishPub({
      cap,
      ref: {
        t: "result",
        k: chosen.key,
        a: attemptToken
      },
      meta: {
        tag,
        org: label,
        issuedAt: now
      }
    });

    nextPublishAtByConcern.set(concernHex, now + jitterRange(policy.minGapMs, policy.maxGapMs, prng));
  };
}

function createSelectiveRatifierProjector(label) {
  return async function selectiveRatifierProjector(ctx) {
    for await (const pub of ctx.pubs()) {
      const metaTag = pub?.value?.meta?.tag;
      const cap = String(pub?.value?.cap || "");
      const keep = metaTag === "keep" || cap.includes("/keep");
      if (!keep) continue;

      // This is edge policy divergence, not concern physics. Concern.apply still validates/accepts.
      await ctx.publish.publishRat({
        jobKey: pub.jobKey,
        orgKey: pub.value.oK,
        attemptToken: pub.attempt,
        determination: 1,
        tier: 1,
        cap: cap || "cap/ecology/rat",
        ref: pub.value.ref,
        note: `selective-ratifier-${label}-keep-only`
      });
    }
  };
}

async function waitForEcologyReadiness({
  cfg,
  runtime,
  joins,
  swarms,
  concerns,
  discovery,
  runners,
  updateHostConcerns
}) {
  const startedAt = Date.now();
  const deadline = startedAt + cfg.readyMs;
  const pulseAt = startedAt + Math.floor(cfg.readyMs * cfg.pulseAtRatio);
  let pulseUsed = false;

  console.log("[ready] phase 1/4: join+flush");
  for (const { label, swarm, handle } of joins) {
    if (runtime.stopRequested) throw stopRequestedError("join+flush");
    const remaining = Math.max(250, deadline - Date.now());
    const timeoutMs = Math.min(2_500, remaining);
    const result = await flushDiscovery({ swarm: null, discovery: handle, timeoutMs });
    const failed = result.evidence?.find((x) => x.ok === false);
    if (failed) throw new Error(`readiness flush failed at ${label}: ${failed.error}`);
  }
  for (const swarm of swarms) {
    if (runtime.stopRequested) throw stopRequestedError("join+flush");
    const remaining = Math.max(250, deadline - Date.now());
    const timeoutMs = Math.min(2_500, remaining);
    const result = await flushDiscovery({ swarm, discovery: null, timeoutMs });
    const failed = result.evidence?.find((x) => x.ok === false);
    if (failed) throw new Error(`readiness swarm flush failed at ${swarm.__role}: ${failed.error}`);
  }

  console.log("[ready] phase 2/4: min connections per swarm");
  for (const swarm of swarms) {
    while (Date.now() < deadline) {
      if (runtime.stopRequested) throw stopRequestedError("connection phase");
      const remaining = deadline - Date.now();
      if (remaining <= 0) break;
      const timeoutMs = Math.min(1_000, remaining);
      const res = await waitForSwarmConnections(swarm, {
        min: 1,
        timeoutMs
      });
      if (res.reached) break;
    }
    if ((swarm.connections?.size ?? 0) < 1) {
      throw new Error(`swarm did not reach min connections: ${swarm.__role}`);
    }
  }

  console.log("[ready] phase 3/4: warm runners without publishing");
  while (Date.now() < deadline) {
    if (runtime.stopRequested) throw stopRequestedError("warmup phase");
    await runAllRunnersOnce(runners);
    await updateHostConcerns();
    if (areAllRunnersWarmed(runners, cfg.concerns)) break;
    await sleep(100);
  }
  if (!areAllRunnersWarmed(runners, cfg.concerns)) {
    throw new Error("readiness failed: runners did not warm all concerns before timeout");
  }

  // Required cores for this demo are discovery + each host concern view core.
  const requiredCores = [
    { label: "discovery-view", core: discovery?.view, minPeers: 1 },
    ...concerns.map((concern) => ({
      label: `${concern.id}-view`,
      core: concern.base?.view?.core,
      minPeers: 1
    }))
  ];

  console.log("[ready] phase 4/4: core peers + stability window");
  for (const req of requiredCores) {
    if (!req.core) throw new Error(`readiness missing required core: ${req.label}`);
    while (Date.now() < deadline) {
      if (runtime.stopRequested) throw stopRequestedError("core-peers phase");
      const remaining = deadline - Date.now();
      if (remaining <= 0) break;
      const timeoutMs = Math.min(1_000, remaining);
      const res = await waitForCorePeers(req.core, { min: req.minPeers, timeoutMs });
      if (res.reached) break;
    }
    const peers = Array.isArray(req.core?.peers) ? req.core.peers.length : 0;
    if (peers < req.minPeers) throw new Error(`core did not reach min peers: ${req.label}`);
  }

  let stableSince = 0;
  while (Date.now() < deadline) {
    if (runtime.stopRequested) throw stopRequestedError("stability phase");
    const now = Date.now();
    await updateHostConcerns();
    const snap = snapshotReadiness({ swarms, requiredCores, runners, requiredWarmCount: cfg.concerns });

    if (snap.ok) {
      if (stableSince === 0) stableSince = now;
      if (now - stableSince >= cfg.stableMs) {
        const elapsed = now - startedAt;
        console.log(`[ready] stable for ${cfg.stableMs}ms (elapsed=${elapsed}ms pulseUsed=${pulseUsed ? "yes" : "no"})`);
        return;
      }
    } else {
      stableSince = 0;
    }

    // One pulse only: flush swarms and refresh discovery handle (if available) to nudge slow tails.
    if (!pulseUsed && now >= pulseAt) {
      pulseUsed = true;
      console.log("[ready] pulse triggered at 60% budget to nudge late DHT/peer convergence");
      for (const swarm of swarms) {
        await swarm.flush?.().catch(() => {});
      }
      for (const { handle } of joins) {
        if (typeof handle?.refresh === "function") {
          await Promise.resolve(handle.refresh()).catch(() => {});
        }
      }
      await runAllRunnersOnce(runners);
    }

    await sleep(100);
  }

  const detail = snapshotReadiness({ swarms, requiredCores, runners, requiredWarmCount: cfg.concerns });
  if (detail.ok) {
    console.log("[ready] reached readiness conditions at deadline boundary; continuing");
    return;
  }
  throw new Error(`readiness timeout after ${cfg.readyMs}ms; pulseUsed=${pulseUsed} detail=${JSON.stringify(detail)}`);
}

function stopRequestedError(phase) {
  const err = new Error(`stop requested during readiness (${phase})`);
  err.code = "ERR_ECO_STOP_REQUESTED";
  return err;
}

function snapshotReadiness({ swarms, requiredCores, runners, requiredWarmCount }) {
  const connections = Object.fromEntries(
    swarms.map((swarm) => [swarm.__role, swarm.connections?.size ?? 0])
  );
  const peers = Object.fromEntries(
    requiredCores.map((req) => [req.label, Array.isArray(req.core?.peers) ? req.core.peers.length : null])
  );
  const warm = runners.map((runner) => {
    const status = runner.getStatus?.();
    const warmed = status?.warm?.filter((x) => x.status === "warmed").length || 0;
    return warmed;
  });

  const connectionsOk = Object.values(connections).every((count) => count >= 1);
  const peersOk = Object.entries(peers).every(([, count]) => typeof count === "number" && count >= 1);
  const warmOk = warm.every((count) => count >= requiredWarmCount);
  return { ok: connectionsOk && peersOk && warmOk, connections, peers, warm };
}

async function runAllRunnersOnce(runners) {
  for (const runner of runners) {
    await runner.tick().catch(() => {});
  }
}

function areAllRunnersWarmed(runners, requiredWarmCount) {
  for (const runner of runners) {
    const warmed = runner.getStatus?.().warm?.filter((x) => x.status === "warmed").length || 0;
    if (warmed < requiredWarmCount) return false;
  }
  return true;
}

function createRunnerLoop({ label, runner, cfg, runtime, inFlight, prng }) {
  return createPeriodicLoop({
    label,
    runtime,
    inFlight,
    prng,
    minMs: cfg.tickMinMs,
    maxMs: cfg.tickMaxMs,
    task: async () => {
      await runner.tick();
    }
  });
}

function createPeriodicLoop({ label, runtime, inFlight, prng, minMs, maxMs, task }) {
  let stopped = false;
  const done = (async () => {
    while (!stopped && !runtime.stopRequested) {
      const p = Promise.resolve().then(task).catch((err) => {
        console.error(`[loop:${label}]`, err?.message || err);
      });
      inFlight.add(p);
      try {
        await p;
      } finally {
        inFlight.delete(p);
      }
      if (stopped || runtime.stopRequested) break;
      await sleep(jitterRange(minMs, maxMs, prng));
    }
  })();
  return {
    stop() {
      stopped = true;
    },
    done
  };
}

async function collectMetrics({ concerns, ratifierKeysByConcern }) {
  const perConcern = [];
  for (const concern of concerns) {
    await concern.base.update({ wait: true }).catch(() => {});
    let totalPub = 0;
    let totalRatA = 0;
    let totalRatB = 0;
    const ratAKey = ratifierKeysByConcern.A.get(concern.id);
    const ratBKey = ratifierKeysByConcern.B.get(concern.id);

    for (const jobKey of concern.jobKeys) {
      totalPub += await countPubLeavesForJob(concern.publishView, jobKey);
      totalRatA += await countRatLeavesForJobRatifier(concern.ratView, jobKey, ratAKey);
      totalRatB += await countRatLeavesForJobRatifier(concern.ratView, jobKey, ratBKey);
    }

    perConcern.push({
      concernId: concern.id,
      jobs: concern.jobKeys.length,
      pubs: totalPub,
      ratA: totalRatA,
      ratB: totalRatB,
      divergence: totalRatA - totalRatB
    });
  }
  return { concerns: perConcern };
}

function printMetrics({ runtime, snapshot }) {
  const totalPub = snapshot.concerns.reduce((acc, x) => acc + x.pubs, 0);
  const totalRatA = snapshot.concerns.reduce((acc, x) => acc + x.ratA, 0);
  const totalRatB = snapshot.concerns.reduce((acc, x) => acc + x.ratB, 0);
  console.log(
    `[metrics] phase=${runtime.phase} pubs=${totalPub} ratA=${totalRatA} ratB=${totalRatB} divergence=${totalRatA - totalRatB}`
  );
  for (const c of snapshot.concerns) {
    console.log(
      `[metrics] ${c.concernId} jobs=${c.jobs} pubs=${c.pubs} ratA=${c.ratA} ratB=${c.ratB} divergence=${c.divergence}`
    );
  }
  const errors = runtime.transportErrors;
  const last = errors.samples[errors.samples.length - 1] || null;
  if (last) {
    console.log(
      `[metrics] transportErrors=${errors.count} last={phase:${last.phase}, code:${last.code || "n/a"}, msg:${last.message}}`
    );
  } else {
    console.log(`[metrics] transportErrors=${errors.count}`);
  }
}

async function countPubLeavesForJob(publishView, jobKey) {
  let count = 0;
  const jobSub = publishView.sub(jobKey);
  for await (const orgEntry of jobSub.createReadStream()) {
    if (!orgEntry?.key) continue;
    for await (const _attempt of jobSub.sub(orgEntry.key).createReadStream()) count += 1;
  }
  return count;
}

async function countRatLeavesForJobRatifier(ratView, jobKey, ratifierKey) {
  if (!ratifierKey) return 0;
  let count = 0;
  const ratSub = ratView.sub(jobKey).sub(ratifierKey);
  for await (const orgEntry of ratSub.createReadStream()) {
    if (!orgEntry?.key) continue;
    for await (const _attempt of ratSub.sub(orgEntry.key).createReadStream()) count += 1;
  }
  return count;
}

async function updateConcernHosts(concerns) {
  for (const concern of concerns) {
    await concern.base.update({ wait: true }).catch(() => {});
  }
}

async function rebuildRatifierKeyMap(resources) {
  const map = {
    A: new Map(),
    B: new Map()
  };
  const ratAStore = resources.corestores.find((x) => x.__role === "rat-A");
  const ratBStore = resources.corestores.find((x) => x.__role === "rat-B");
  if (!ratAStore || !ratBStore) return map;
  for (const concern of resources.concerns) {
    map.A.set(concern.id, await Autobase.getLocalKey(ratAStore.namespace(`concern-${concern.keyHex}`)));
    map.B.set(concern.id, await Autobase.getLocalKey(ratBStore.namespace(`concern-${concern.keyHex}`)));
  }
  return map;
}

async function openRoleCorestore(storeRoot, role, tracked) {
  const dir = path.join(storeRoot, role);
  await mkdir(dir, { recursive: true });
  const store = new Corestore(dir);
  store.__role = role;
  await store.ready?.();
  tracked.push(store);
  return store;
}

function openRoleSwarm({ role, cfg, runtime, swarms, detachers }) {
  const swarm = new Hyperswarm({
    seed: deriveSeed(cfg.seed, `swarm:${role}`)
  });
  swarm.__role = role;
  swarms.push(swarm);
  detachers.push(
    attachConnectionErrorSink({
      swarm,
      runtime,
      label: role
    })
  );
  return swarm;
}

function attachConnectionErrorSink({ swarm, runtime, label }) {
  const onConnection = (stream, info) => {
    if (!stream || typeof stream.on !== "function") return;
    const peer = formatPeer(info);
    stream.on("error", (err) => {
      const errors = runtime.transportErrors;
      errors.count += 1;
      if (errors.samples.length >= MAX_TRANSPORT_ERROR_SAMPLES) return;
      errors.samples.push({
        when: Date.now(),
        phase: runtime.phase,
        code: err?.code || null,
        message: err?.message || String(err),
        peer,
        label
      });
    });
  };
  swarm.on("connection", onConnection);
  return () => {
    if (typeof swarm.off === "function") {
      swarm.off("connection", onConnection);
    } else if (typeof swarm.removeListener === "function") {
      swarm.removeListener("connection", onConnection);
    }
  };
}

function formatPeer(info) {
  const raw = info?.publicKey || info?.id || null;
  if (!raw) return null;
  if (typeof raw === "string") return raw;
  if (Buffer.isBuffer(raw)) return raw.toString("hex");
  if (raw?.buffer && Buffer.isBuffer(raw.buffer)) return raw.buffer.toString("hex");
  return String(raw);
}

async function closeMany(items, closeFn = closeMaybe) {
  for (const item of items || []) {
    await closeFn(item).catch(() => {});
  }
}

async function closeMaybe(obj) {
  await obj?.close?.();
}

async function destroyJoinHandle(handle) {
  await handle?.destroy?.();
}

async function closeSwarm(swarm) {
  if (!swarm) return;
  if (swarm.connections && typeof swarm.connections.values === "function") {
    for (const conn of swarm.connections.values()) {
      conn?.destroy?.();
      conn?.socket?.destroy?.();
    }
  }
  await swarm.close?.().catch(() => {});
  swarm.destroy?.();
}

function installSignal(name, requestStop, bag) {
  const handler = () => requestStop(name);
  process.on(name, handler);
  bag.push({ name, handler });
}

function uninstallSignals(bag) {
  for (const { name, handler } of bag) {
    process.off(name, handler);
  }
}

function deriveSeed(seed, label) {
  return crypto
    .createHash("sha256")
    .update(seed)
    .update(String(label))
    .digest()
    .subarray(0, 32);
}

function createAttemptTokenFactory(seed, label) {
  let counter = 0;
  return function nextAttemptToken() {
    counter += 1;
    return deriveSeed(seed, `attempt:${label}:${counter}`);
  };
}

async function maybeLoadEcologyDefinitions({ cfg, orgCount }) {
  const enabled = Boolean(
    cfg.defsEnabled ||
    cfg.defsDir ||
    cfg.defsPack ||
    cfg.packsDir ||
    (Array.isArray(cfg.organismNames) && cfg.organismNames.length > 0) ||
    (Array.isArray(cfg.ratifierNames) && cfg.ratifierNames.length > 0)
  );
  if (!enabled) return null;

  const { organismsDir, ratifiersDir } = resolveDefinitionDirs(cfg.defsDir);
  const packsDir = resolvePacksDir({ packsDirRaw: cfg.packsDir, defsDirRaw: cfg.defsDir });
  const pack = await loadPackMaybe({ packsDir, packName: cfg.defsPack });
  const selectedOrganisms = chooseDefinitionNames({
    explicit: cfg.organismNames,
    fromPack: pack?.organisms,
    fallback: buildDefaultOrganismSelection(orgCount)
  });
  const selectedRatifiers = chooseDefinitionNames({
    explicit: cfg.ratifierNames,
    fromPack: pack?.ratifiers,
    fallback: ["ratify-all", "selective"]
  });

  const defs = {
    organisms: new Map(),
    ratifiers: new Map(),
    selectedOrganisms,
    selectedRatifiers,
    packName: pack?.name || null
  };

  for (const name of uniqueList(selectedOrganisms)) {
    const def = await loadDefinitionMaybe(resolveDefinitionFile(organismsDir, name));
    if (def) defs.organisms.set(name, def);
  }

  for (const name of uniqueList(selectedRatifiers)) {
    const def = await loadDefinitionMaybe(resolveDefinitionFile(ratifiersDir, name));
    if (def) defs.ratifiers.set(name, def);
  }

  console.log(
    `[defs] enabled organismsDir=${organismsDir} ratifiersDir=${ratifiersDir} packsDir=${packsDir} pack=${defs.packName || "none"} selectedOrg=${selectedOrganisms.join(",") || "none"} selectedRat=${selectedRatifiers.join(",") || "none"} loadedOrg=${Array.from(defs.organisms.keys()).join(",") || "none"} loadedRat=${Array.from(defs.ratifiers.keys()).join(",") || "none"}`
  );

  return defs;
}

function resolveDefinitionDirs(defsDirRaw) {
  const baseDir = path.resolve(defsDirRaw || process.cwd());
  const leaf = path.basename(baseDir);

  if (leaf === "organisms") {
    return {
      organismsDir: baseDir,
      ratifiersDir: path.resolve(baseDir, "..", "ratifiers")
    };
  }
  if (leaf === "ratifiers") {
    return {
      organismsDir: path.resolve(baseDir, "..", "organisms"),
      ratifiersDir: baseDir
    };
  }
  return {
    organismsDir: path.join(baseDir, "organisms"),
    ratifiersDir: path.join(baseDir, "ratifiers")
  };
}

function resolvePacksDir({ packsDirRaw, defsDirRaw }) {
  if (packsDirRaw) return path.resolve(packsDirRaw);

  const baseDir = path.resolve(defsDirRaw || process.cwd());
  const leaf = path.basename(baseDir);
  if (leaf === "organisms" || leaf === "ratifiers") {
    return path.resolve(baseDir, "..", "packs");
  }
  return path.join(baseDir, "packs");
}

async function loadPackMaybe({ packsDir, packName }) {
  const resolvedName = String(packName || "").trim();
  if (!resolvedName) return null;

  const filePath = path.join(packsDir, resolvedName, "pack.json");
  let raw = "";
  try {
    raw = await readFile(filePath, "utf8");
  } catch (err) {
    if (err?.code === "ENOENT") {
      throw new Error(`pack not found: ${resolvedName} (expected ${filePath})`);
    }
    throw err;
  }

  let parsed = null;
  try {
    parsed = JSON.parse(raw);
  } catch (err) {
    throw new Error(`invalid pack JSON at ${filePath}: ${err?.message || err}`);
  }

  return {
    name: String(parsed?.name || resolvedName).trim() || resolvedName,
    organisms: normalizeNameList(parsed?.organisms),
    ratifiers: normalizeNameList(parsed?.ratifiers)
  };
}

function chooseDefinitionNames({ explicit, fromPack, fallback }) {
  const explicitNames = normalizeNameList(explicit);
  if (explicitNames.length > 0) return explicitNames;

  const packNames = normalizeNameList(fromPack);
  if (packNames.length > 0) return packNames;

  return normalizeNameList(fallback);
}

function buildDefaultOrganismSelection(orgCount) {
  const names = [];
  for (let i = 0; i < orgCount; i++) {
    const label = ORG_LABELS[i];
    names.push(label === "B" ? "worker-B" : "opportunist-A");
  }
  return names;
}

function resolveDefinitionFile(baseDir, name) {
  const normalized = normalizeActorName(name);
  if (!normalized) return null;
  return path.join(baseDir, `${normalized}.js`);
}

async function loadDefinitionMaybe(filePath) {
  if (!filePath) return null;
  try {
    await access(filePath);
  } catch {
    return null;
  }

  const mod = await import(pathToFileURL(filePath).href);
  const definition = mod.default ?? mod.definition ?? mod;
  if (!definition || typeof definition.onTick !== "function") {
    console.warn(`[defs] skipped ${filePath}: missing definition.onTick`);
    return null;
  }
  return definition;
}

function uniqueList(items) {
  const out = [];
  const seen = new Set();
  for (const item of items || []) {
    const name = normalizeActorName(item);
    if (!name || seen.has(name)) continue;
    seen.add(name);
    out.push(name);
  }
  return out;
}

function normalizeNameList(value) {
  if (Array.isArray(value)) {
    return uniqueList(value);
  }
  if (typeof value === "string") {
    return uniqueList(value.split(","));
  }
  return [];
}

function normalizeActorName(name) {
  const raw = String(name ?? "").trim();
  if (!raw) return "";
  if (raw.endsWith(".js")) return raw.slice(0, -3);
  return raw;
}

function selectNameForIndex(names, index) {
  if (!Array.isArray(names) || names.length === 0) return null;
  const idx = index % names.length;
  return names[idx] || null;
}

function createPrng(seed) {
  // Lightweight deterministic PRNG for jitter/probabilities. This is not cryptographic;
  // it is only used to make demo behavior reproducible from ECO_SEED.
  let x = seed.readUInt32LE(0) ^ seed.readUInt32LE(4) ^ seed.readUInt32LE(8) ^ seed.readUInt32LE(12);
  if (x === 0) x = 0x9e3779b9;
  return function next() {
    x ^= x << 13;
    x ^= x >>> 17;
    x ^= x << 5;
    return ((x >>> 0) & 0xffffffff) / 0x100000000;
  };
}

function jitterRange(minMs, maxMs, prng) {
  if (maxMs <= minMs) return minMs;
  return Math.floor(minMs + prng() * (maxMs - minMs));
}

function intOr(value, fallback, min, max) {
  const n = Number.parseInt(String(value ?? ""), 10);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, n));
}

function numOr(value, fallback, min, max) {
  const n = Number.parseFloat(String(value ?? ""));
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, n));
}

function boolOr(value, fallback = false) {
  if (typeof value === "boolean") return value;
  const raw = String(value ?? "").trim().toLowerCase();
  if (!raw) return fallback;
  if (raw === "1" || raw === "true" || raw === "yes" || raw === "on") return true;
  if (raw === "0" || raw === "false" || raw === "no" || raw === "off") return false;
  return fallback;
}

function listOr(value, fallback = []) {
  const parsed = normalizeNameList(value);
  if (parsed.length > 0) return parsed;
  return normalizeNameList(fallback);
}

function logConfig(cfg) {
  console.log("[config]", JSON.stringify({
    durationMs: cfg.durationMs,
    readyMs: cfg.readyMs,
    stableMs: cfg.stableMs,
    pulseAtRatio: cfg.pulseAtRatio,
    metricsMs: cfg.metricsMs,
    tickMinMs: cfg.tickMinMs,
    tickMaxMs: cfg.tickMaxMs,
    jobsPerConcern: cfg.jobsPerConcern,
    concerns: cfg.concerns,
    orgs: cfg.orgs,
    storeRoot: cfg.storeRoot,
    seedHex: cfg.seedHex,
    defsEnabled: cfg.defsEnabled,
    defsDir: cfg.defsDir || null,
    defsPack: cfg.defsPack || null,
    packsDir: cfg.packsDir || null,
    organismNames: cfg.organismNames,
    ratifierNames: cfg.ratifierNames
  }));
}

export {
  runEcologyOrchestrator,
  normalizeConfig
};
