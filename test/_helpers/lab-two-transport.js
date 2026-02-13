import crypto from "crypto";
import { mkdir, writeFile } from "fs/promises";
import path from "path";
import Corestore from "corestore";
import Hyperswarm from "hyperswarm";
import createFakeSwarm from "fakeswarm";
import { mkTemp } from "./fs.js";
import { createLabResources } from "./lab-resources.js";
import { waitForReplicationReady } from "./lab-ready.js";
import { getLabBudgets } from "./lab-budgets.js";
import { attachSwarmConnectionErrorSink } from "./swarm-errors.js";

class ConvergenceTimeoutError extends Error {
  constructor(message, detail) {
    super(message);
    this.name = "ConvergenceTimeoutError";
    this.code = "ERR_LAB_CONVERGENCE_TIMEOUT";
    this.detail = detail || null;
  }
}

async function runLabTwoTransport(t, { name, scenario, opts = {} }) {
  if (typeof scenario !== "function") throw new Error("scenario must be a function");

  const labBudgets = opts.labBudgets || getLabBudgets();
  const seed = opts.seed || crypto.randomBytes(32);
  const budgets = mergeBudgets(opts.budgets || {}, labBudgets);
  const strict = opts.strict ?? labBudgets.strict;
  const realEnabled = opts.realEnabled ?? labBudgets.realEnabled;
  const calibrate = opts.calibrate ?? labBudgets.calibrate;
  const samples = opts.samples ?? labBudgets.samples;

  const fake = await runSingleTransport(t, {
    name,
    transportKind: "fakeswarm",
    scenario,
    seed,
    budgets: budgets.fakeswarm
  });

  if (!fake.ok) {
    const err = new Error(`${name} fake transport failed`);
    err.code = "ERR_LAB_FAIL_SEMANTICS";
    err.detail = { verdict: "FAIL_SEMANTICS", fake };
    throw err;
  }

  if (!realEnabled) {
    return { verdict: "PASS", fake, real: null, skippedReal: true, strict };
  }

  if (calibrate) {
    return runCalibrationMode(t, {
      name,
      scenario,
      seed,
      strict,
      samples,
      fake,
      budgets
    });
  }

  const real = await runSingleTransport(t, {
    name,
    transportKind: "hyperswarm",
    scenario,
    seed,
    budgets: budgets.hyperswarm
  });

  const verdict = real.ok ? "PASS" : classifyRealFailure(real);

  if (verdict === "FLAKE_TRANSPORT") {
    logFlakeEvidence(t, real);
    if (strict) {
      const err = new Error(`${name} hyperswarm flake treated as failure (strict mode)`);
      err.code = "ERR_LAB_STRICT_FLAKE";
      err.detail = { verdict, fake, real };
      throw err;
    }
  }

  if (verdict === "FAIL_SEMANTICS") {
    const err = new Error(`${name} hyperswarm semantic failure`);
    err.code = "ERR_LAB_FAIL_SEMANTICS";
    err.detail = { verdict, fake, real };
    throw err;
  }

  return { verdict, fake, real, strict };
}

async function runCalibrationMode(t, { name, scenario, seed, strict, samples, fake, budgets }) {
  const realSamples = [];
  let firstFlake = null;
  let firstSemanticFailure = null;

  for (let i = 0; i < samples; i++) {
    const sampleSeed = deriveSeed(seed, `calibration:${i + 1}`);
    const real = await runSingleTransport(t, {
      name,
      transportKind: "hyperswarm",
      scenario,
      seed: sampleSeed,
      budgets: budgets.hyperswarm
    });

    const verdict = real.ok ? "PASS" : classifyRealFailure(real);
    realSamples.push({ index: i + 1, verdict, run: real });

    if (verdict === "FLAKE_TRANSPORT" && !firstFlake) firstFlake = { index: i + 1, run: real };
    if (verdict === "FAIL_SEMANTICS" && !firstSemanticFailure) {
      firstSemanticFailure = { index: i + 1, run: real };
      break;
    }
  }

  const summary = buildCalibrationSummary(name, realSamples);
  printCalibrationSummary(t, summary);
  await maybeWriteCalibrationArtifact({ name, summary, samples: realSamples });

  if (firstSemanticFailure) {
    const err = new Error(`${name} hyperswarm semantic failure during calibration sample ${firstSemanticFailure.index}`);
    err.code = "ERR_LAB_FAIL_SEMANTICS";
    err.detail = {
      verdict: "FAIL_SEMANTICS",
      fake,
      sample: firstSemanticFailure.index,
      real: firstSemanticFailure.run,
      summary
    };
    throw err;
  }

  if (firstFlake) {
    logFlakeEvidence(t, firstFlake.run);
    if (strict) {
      const err = new Error(`${name} hyperswarm flake treated as failure (strict mode)`);
      err.code = "ERR_LAB_STRICT_FLAKE";
      err.detail = {
        verdict: "FLAKE_TRANSPORT",
        fake,
        sample: firstFlake.index,
        real: firstFlake.run,
        summary
      };
      throw err;
    }
    return {
      verdict: "FLAKE_TRANSPORT",
      fake,
      real: firstFlake.run,
      realSamples,
      calibration: summary,
      strict,
      calibrate: true
    };
  }

  return {
    verdict: "PASS",
    fake,
    real: realSamples[realSamples.length - 1]?.run || null,
    realSamples,
    calibration: summary,
    strict,
    calibrate: true
  };
}

async function runSingleTransport(t, { name, transportKind, scenario, seed, budgets }) {
  const started = Date.now();
  const readinessPhases = [];
  const assertions = [];
  const errors = [];
  let errorCode = null;
  let readinessSummary = null;
  let readinessStarted = false;
  let readinessOk = false;
  let assertionsStarted = false;
  let semanticFailureAfterReadiness = false;
  let tReadyMs = null;
  let tAcceptMs = null;
  let readyStartedAt = 0;
  let assertStartedAt = 0;
  let resourcesSummary = { opened: 0, closed: 0, leaked: 0 };
  let prepared = null;
  let phase = "bringup";
  const evidence = { transportErrors: { count: 0, samples: [] } };

  const runSeed = deriveSeed(seed, `${name}:${transportKind}`);
  const temp = mkTemp(`lab-${transportKind}-`);
  const resources = createLabResources();
  resources.track("tempdir", temp, async (x) => x.cleanup());

  const perRoleCorestores = new Map();
  const perRoleSwarms = new Map();
  const fakeTopics = transportKind === "fakeswarm" ? new Map() : null;

  const context = {
    name,
    transportKind,
    seed: runSeed,
    budgets,
    resources,
    createRoleCorestore(role) {
      if (perRoleCorestores.has(role)) {
        throw new Error(`corestore already created for role: ${role}`);
      }
      const store = resources.trackCorestore(new Corestore(path.join(temp.dir, `store-${role}`)));
      perRoleCorestores.set(role, store);
      return store;
    },
    createRoleSwarm(role) {
      if (perRoleSwarms.has(role)) {
        throw new Error(`swarm already created for role: ${role}`);
      }
      const swarm = transportKind === "fakeswarm"
        ? createFakeSwarm({ topics: fakeTopics })
        : new Hyperswarm({ seed: deriveSeed(runSeed, `swarm:${role}`) });
      if (transportKind === "hyperswarm") {
        const detach = attachSwarmConnectionErrorSink({
          swarm,
          evidence,
          getPhase: () => phase,
          label: role
        });
        resources.track("swarm-error-sink", { detach }, async (entry) => {
          entry?.detach?.();
        });
      }
      resources.trackSwarm(swarm);
      perRoleSwarms.set(role, swarm);
      return swarm;
    },
    topicFor(topicName) {
      return deriveSeed(runSeed, `topic:${topicName}`);
    },
    recordAssertion(assertion) {
      assertions.push(assertion);
    }
  };

  try {
    prepared = await scenario(context);
    const swarms = prepared?.swarms || [];
    const discoveries = prepared?.discoveries || [];
    const bases = prepared?.bases || [];

    phase = "ready";
    readinessStarted = true;
    readyStartedAt = Date.now();
    const readyResult = await waitForReplicationReady({
      label: `${name}:${transportKind}`,
      swarms,
      discoveries,
      bases,
      budgets: budgets.ready,
      evidence: readinessPhases
    });
    readinessSummary = readyResult?.summary || null;
    readinessOk = true;
    tReadyMs = Date.now() - readyStartedAt;

    if (typeof prepared?.assert === "function") {
      assertionsStarted = true;
      assertStartedAt = Date.now();
      phase = "execute";
      const assertPromise = prepared.assert({ ...context, prepared });
      phase = "converge";
      const value = await withConvergenceTimeout(
        assertPromise,
        budgets.convergeMs,
        `${name}:${transportKind}`
      );
      tAcceptMs = Date.now() - assertStartedAt;
      if (Array.isArray(value)) assertions.push(...value);
      if (Array.isArray(value?.assertions)) assertions.push(...value.assertions);
    }
  } catch (err) {
    errorCode = err?.code || "ERR_LAB_RUN";
    if (!readinessSummary && err?.detail?.summary) readinessSummary = err.detail.summary;
    if (readinessStarted && tReadyMs === null) tReadyMs = Date.now() - readyStartedAt;
    if (assertionsStarted && tAcceptMs === null) tAcceptMs = Date.now() - assertStartedAt;
    if (readinessOk && errorCode !== "ERR_LAB_CONVERGENCE_TIMEOUT") semanticFailureAfterReadiness = true;
    errors.push({
      code: err?.code || "ERR_LAB_RUN",
      message: err?.message || String(err)
    });
  } finally {
    phase = "teardown";
    resourcesSummary = await resources.cleanup();
  }

  return {
    transportKind,
    seed: runSeed.toString("hex"),
    budgets,
    readinessPhases,
    transportErrors: evidence.transportErrors,
    assertions,
    errors,
    errorCode,
    readinessSummary,
    readinessStarted,
    readinessOk,
    assertionsStarted,
    semanticFailureAfterReadiness,
    tReadyMs,
    tAcceptMs,
    resourcesSummary,
    lastViewSeqs: collectViewSeqs(prepared?.bases || []),
    elapsedMs: Date.now() - started,
    ok: errors.length === 0
  };
}

async function withConvergenceTimeout(promise, timeoutMs, label) {
  let timer = null;
  try {
    return await Promise.race([
      promise,
      new Promise((_, reject) => {
        timer = setTimeout(() => {
          reject(new ConvergenceTimeoutError(`convergence timeout after ${timeoutMs}ms`, { label }));
        }, timeoutMs);
      })
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

function collectViewSeqs(bases) {
  return bases
    .map((desc) => {
      const baseLike = desc?.base || desc;
      const label = desc?.label || "base";
      const len = baseLike?.view?.core?.length;
      if (typeof len !== "number") return null;
      return { label, seq: len };
    })
    .filter(Boolean);
}

function logFlakeEvidence(t, real) {
  if (!t?.comment) return;

  const summary = real.readinessSummary || getReadinessSummaryFromPhases(real.readinessPhases);
  if (summary) {
    t.comment(
      `[FLAKE_TRANSPORT] elapsed=${summary.elapsedMs}ms pulse=${summary.pulseUsed ? "yes" : "no"} stable=${summary.stabilizationSucceeded ? "yes" : "no"}`
    );
    t.comment(`connections=${JSON.stringify(summary.observedConnections)} peers=${JSON.stringify(summary.observedPeers)}`);
  } else {
    t.comment("[FLAKE_TRANSPORT] readiness/convergence issue (summary unavailable)");
  }
  const transportErrors = real?.transportErrors || { count: 0, samples: [] };
  t.comment(`transportErrors=${transportErrors.count} samples=${JSON.stringify(transportErrors.samples)}`);
  t.comment(`viewSeqs=${JSON.stringify(real.lastViewSeqs)} errors=${JSON.stringify(real.errors)}`);
}

function mergeBudgets(custom, labBudgets) {
  const readyMs = labBudgets?.readyMs ?? 30000;
  const convergeMs = labBudgets?.convergeMs ?? 45000;
  const defaultBudgets = {
    fakeswarm: {
      ready: {
        flushMs: 1500,
        connectMs: 1500,
        peerMs: 2000,
        minConnections: 1,
        minPeers: 1
      },
      convergeMs: Math.max(3000, Math.floor(convergeMs / 8))
    },
    hyperswarm: {
      ready: {
        flushMs: Math.min(12000, Math.max(2000, Math.floor(readyMs * 0.4))),
        connectMs: readyMs,
        peerMs: readyMs,
        minConnections: 1,
        minPeers: 1
      },
      convergeMs
    }
  };

  return {
    fakeswarm: {
      ...defaultBudgets.fakeswarm,
      ...(custom.fakeswarm || {}),
      ready: {
        ...defaultBudgets.fakeswarm.ready,
        ...(custom.fakeswarm?.ready || {})
      }
    },
    hyperswarm: {
      ...defaultBudgets.hyperswarm,
      ...(custom.hyperswarm || {}),
      ready: {
        ...defaultBudgets.hyperswarm.ready,
        ...(custom.hyperswarm?.ready || {})
      }
    }
  };
}

function deriveSeed(seed, label) {
  return crypto.createHash("sha256")
    .update(seed)
    .update(String(label))
    .digest()
    .subarray(0, 32);
}

function classifyRealFailure(real) {
  const readinessNotMet = real?.readinessStarted === true && real?.readinessOk !== true;
  const convergenceTimedOut = real?.errorCode === "ERR_LAB_CONVERGENCE_TIMEOUT";
  const semanticAfterReadiness = real?.semanticFailureAfterReadiness === true;

  if ((readinessNotMet || convergenceTimedOut) && !semanticAfterReadiness) return "FLAKE_TRANSPORT";
  return "FAIL_SEMANTICS";
}

function buildCalibrationSummary(name, samples) {
  const ready = samples.map((s) => s.run.tReadyMs).filter((n) => Number.isFinite(n));
  const accept = samples.map((s) => s.run.tAcceptMs).filter((n) => Number.isFinite(n));
  const total = samples.map((s) => s.run.elapsedMs).filter((n) => Number.isFinite(n));
  const flakeCount = samples.filter((s) => s.verdict === "FLAKE_TRANSPORT").length;
  const semanticCount = samples.filter((s) => s.verdict === "FAIL_SEMANTICS").length;
  const passCount = samples.filter((s) => s.verdict === "PASS").length;
  const pulseCount = samples.filter((s) => s.run.readinessSummary?.pulseUsed === true).length;

  return {
    name,
    samples: samples.length,
    counts: { pass: passCount, flake: flakeCount, semanticFail: semanticCount },
    pulse: { used: pulseCount, unused: samples.length - pulseCount },
    readyMs: summarizePercentiles(ready),
    acceptMs: summarizePercentiles(accept),
    totalMs: summarizePercentiles(total)
  };
}

function summarizePercentiles(values) {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  return {
    p50: percentile(sorted, 0.5),
    p90: percentile(sorted, 0.9),
    p95: percentile(sorted, 0.95),
    max: sorted[sorted.length - 1]
  };
}

function percentile(sorted, p) {
  const idx = Math.min(sorted.length - 1, Math.max(0, Math.ceil(sorted.length * p) - 1));
  return sorted[idx];
}

function printCalibrationSummary(t, summary) {
  if (!t?.comment) return;
  t.comment(`Lab: ${summary.name}`);
  t.comment(`Samples: ${summary.samples} (pass=${summary.counts.pass}, flake=${summary.counts.flake}, semanticFail=${summary.counts.semanticFail})`);
  t.comment(`Pulse  used=${summary.pulse.used} unused=${summary.pulse.unused}`);
  t.comment(`Ready  ${formatStats(summary.readyMs)}`);
  t.comment(`Accept ${formatStats(summary.acceptMs)}`);
  t.comment(`Total  ${formatStats(summary.totalMs)}`);
}

function formatStats(stats) {
  if (!stats) return "n/a";
  return `p50=${stats.p50}ms p90=${stats.p90}ms p95=${stats.p95}ms max=${stats.max}ms`;
}

async function maybeWriteCalibrationArtifact({ name, summary, samples }) {
  if (!envTrue("LAB_CALIBRATE_ARTIFACT")) return;
  const outDir = path.join(process.cwd(), "test", "_artifacts");
  const ts = new Date().toISOString().replace(/[:.]/g, "-");
  const safeName = String(name || "lab").replace(/[^a-zA-Z0-9._-]/g, "_");
  const outPath = path.join(outDir, `${safeName}-${ts}.json`);
  const payload = {
    at: new Date().toISOString(),
    summary,
    samples: samples.map((s) => ({
      index: s.index,
      verdict: s.verdict,
      tReadyMs: s.run.tReadyMs,
      tAcceptMs: s.run.tAcceptMs,
      totalMs: s.run.elapsedMs,
      errorCode: s.run.errorCode,
      errors: s.run.errors
    }))
  };
  await mkdir(outDir, { recursive: true });
  await writeFile(outPath, JSON.stringify(payload, null, 2));
}

function envTrue(name) {
  const v = process.env[name];
  if (!v) return false;
  const n = String(v).trim().toLowerCase();
  return n === "1" || n === "true" || n === "yes" || n === "on";
}

function getReadinessSummaryFromPhases(phases = []) {
  const found = phases.find((p) => p.phase === "READINESS_SUMMARY");
  return found || null;
}

export { runLabTwoTransport };
