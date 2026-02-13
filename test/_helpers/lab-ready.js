const DEFAULT_BUDGETS = {
  flushMs: 10000,
  connectMs: 30000,
  peerMs: 30000,
  readyMs: null,
  minConnections: 1,
  minPeers: 1,
  stableMs: 400,
  pulseAtRatio: 0.6
};

class ReplicationReadyError extends Error {
  constructor(message, { phase, code, detail } = {}) {
    super(message);
    this.name = "ReplicationReadyError";
    this.phase = phase || "unknown";
    this.code = code || "ERR_LAB_READY";
    this.detail = detail || null;
  }
}

async function waitForReplicationReady({ label = "lab", swarms = [], discoveries = [], bases = [], budgets = {}, evidence = [] }) {
  const cfg = { ...DEFAULT_BUDGETS, ...budgets };
  const normalizedSwarms = swarms.map((desc) => normalizeSwarm(desc, cfg.minConnections));
  const normalizedDiscoveries = discoveries.map((desc) => normalizeDiscovery(desc));
  const normalizedBases = bases.map((desc) => normalizeBase(desc, cfg.minPeers));

  await phaseJoinAndFlush({
    label,
    swarms: normalizedSwarms,
    discoveries: normalizedDiscoveries,
    cfg,
    evidence
  });

  const summary = await phaseReadyWithStability({
    label,
    swarms: normalizedSwarms,
    discoveries: normalizedDiscoveries,
    bases: normalizedBases,
    cfg,
    evidence
  });

  return { ok: true, readinessPhases: evidence, summary };
}

async function phaseJoinAndFlush({ label, swarms, discoveries, cfg, evidence }) {
  const phase = "JOIN_FLUSH";
  const started = Date.now();

  for (const desc of discoveries) {
    const { target, targetLabel } = desc;
    if (!target?.flushed) continue;
    try {
      await withTimeout(target.flushed(), cfg.flushMs, `${phase}:${targetLabel}`);
      evidence.push({
        phase,
        label: targetLabel,
        ok: true,
        elapsedMs: Date.now() - started
      });
    } catch (err) {
      evidence.push({
        phase,
        label: targetLabel,
        ok: false,
        error: err?.message || String(err),
        elapsedMs: Date.now() - started
      });
      throw new ReplicationReadyError(`join/flush failed (${label}): ${targetLabel}`, {
        phase,
        code: "ERR_LAB_READY_TIMEOUT",
        detail: { target: targetLabel, error: err?.message || String(err) }
      });
    }
  }

  for (const desc of swarms) {
    const { swarm, swarmLabel } = desc;
    if (!swarm?.flush) continue;
    try {
      await withTimeout(swarm.flush(), cfg.flushMs, `${phase}:${swarmLabel}`);
      evidence.push({
        phase,
        label: swarmLabel,
        ok: true,
        elapsedMs: Date.now() - started
      });
    } catch (err) {
      evidence.push({
        phase,
        label: swarmLabel,
        ok: false,
        error: err?.message || String(err),
        elapsedMs: Date.now() - started
      });
      throw new ReplicationReadyError(`swarm flush failed (${label}): ${swarmLabel}`, {
        phase,
        code: "ERR_LAB_READY_TIMEOUT",
        detail: { swarm: swarmLabel, error: err?.message || String(err) }
      });
    }
  }
}

async function phaseReadyWithStability({ label, swarms, discoveries, bases, cfg, evidence }) {
  const started = Date.now();
  const readyTimeoutMs = resolveReadyTimeoutMs(cfg);
  const pollStableWindow = Math.max(cfg.stableMs, 50);
  const pollCountTarget = Math.max(1, Math.ceil(pollStableWindow / 50));
  const pulseAtMs = Math.max(0, Math.floor(readyTimeoutMs * cfg.pulseAtRatio));

  let pulseUsed = false;
  let pulseErrors = [];
  let stableSince = 0;
  let stablePolls = 0;
  let stabilizationSucceeded = false;
  let stabilizationEverSucceeded = false;

  let latestConnections = {};
  let latestPeers = {};

  while (Date.now() - started <= readyTimeoutMs) {
    const elapsedMs = Date.now() - started;
    latestConnections = snapshotConnections(swarms);
    latestPeers = snapshotPeers(bases);

    const connectionsOk = allConnectionsReady(swarms, latestConnections);
    const peersCheck = allPeersReady(bases, latestPeers);

    if (peersCheck.missingRequiredBase) {
      const summary = buildReadinessSummary({
        label,
        ok: false,
        elapsedMs,
        readyTimeoutMs,
        pulseUsed,
        pulseAtMs: pulseUsed ? pulseAtMs : null,
        pulseErrors,
        stableWindowMs: pollStableWindow,
        observedConnections: latestConnections,
        observedPeers: latestPeers,
        stabilizationSucceeded: false,
        stabilizationEverSucceeded
      });
      recordFinalEvidence({ swarms, bases, summary, evidence });
      throw new ReplicationReadyError(`core not resolvable (${label}): ${peersCheck.missingRequiredBase}`, {
        phase: "CORE_PEERS",
        code: "ERR_LAB_READY_TIMEOUT",
        detail: { base: peersCheck.missingRequiredBase, summary }
      });
    }

    const peersOk = peersCheck.ready;

    if (connectionsOk && peersOk) {
      if (stableSince === 0) stableSince = Date.now();
      stablePolls += 1;
      if (Date.now() - stableSince >= pollStableWindow && stablePolls >= pollCountTarget) {
        stabilizationSucceeded = true;
        stabilizationEverSucceeded = true;
        const summary = buildReadinessSummary({
          label,
          ok: true,
          elapsedMs,
          readyTimeoutMs,
          pulseUsed,
          pulseAtMs: pulseUsed ? pulseAtMs : null,
          pulseErrors,
          stableWindowMs: pollStableWindow,
          observedConnections: latestConnections,
          observedPeers: latestPeers,
          stabilizationSucceeded,
          stabilizationEverSucceeded
        });
        recordFinalEvidence({ swarms, bases, summary, evidence });
        return summary;
      }
    } else {
      stableSince = 0;
      stablePolls = 0;
    }

    if (!pulseUsed && elapsedMs >= pulseAtMs) {
      pulseUsed = true;
      pulseErrors = await runReadinessPulse({ swarms, discoveries, cfg, evidence, elapsedMs, label });
    }

    await sleep(pollCadenceMs(elapsedMs));
  }

  const summary = buildReadinessSummary({
    label,
    ok: false,
    elapsedMs: Date.now() - started,
    readyTimeoutMs,
    pulseUsed,
    pulseAtMs: pulseUsed ? pulseAtMs : null,
    pulseErrors,
    stableWindowMs: pollStableWindow,
    observedConnections: latestConnections,
    observedPeers: latestPeers,
    stabilizationSucceeded,
    stabilizationEverSucceeded
  });
  recordFinalEvidence({ swarms, bases, summary, evidence });

  throw new ReplicationReadyError(`readiness thresholds not reached (${label})`, {
    phase: "READINESS",
    code: "ERR_LAB_READY_TIMEOUT",
    detail: { summary }
  });
}

async function runReadinessPulse({ swarms, discoveries, cfg, evidence, elapsedMs, label }) {
  const phase = "READINESS_PULSE";
  const pulseErrors = [];
  const actions = [];

  for (const { target, targetLabel } of discoveries) {
    if (typeof target?.refresh !== "function") continue;
    try {
      await withTimeout(Promise.resolve(target.refresh()), cfg.flushMs, `${phase}:refresh:${targetLabel}`);
      actions.push({ action: "refresh", label: targetLabel, ok: true });
    } catch (err) {
      const error = err?.message || String(err);
      pulseErrors.push({ action: "refresh", label: targetLabel, error });
      actions.push({ action: "refresh", label: targetLabel, ok: false, error });
    }
  }

  for (const { swarm, swarmLabel } of swarms) {
    if (typeof swarm?.flush !== "function") continue;
    try {
      await withTimeout(Promise.resolve(swarm.flush()), cfg.flushMs, `${phase}:flush:${swarmLabel}`);
      actions.push({ action: "swarm.flush", label: swarmLabel, ok: true });
    } catch (err) {
      const error = err?.message || String(err);
      pulseErrors.push({ action: "swarm.flush", label: swarmLabel, error });
      actions.push({ action: "swarm.flush", label: swarmLabel, ok: false, error });
    }
  }

  evidence.push({
    phase,
    label,
    atMs: elapsedMs,
    ok: pulseErrors.length === 0,
    actions
  });

  return pulseErrors;
}

function recordFinalEvidence({ swarms, bases, summary, evidence }) {
  for (const { swarmLabel, minConnections } of swarms) {
    const connections = summary.observedConnections[swarmLabel] ?? 0;
    evidence.push({
      phase: "CONNECTIONS",
      label: swarmLabel,
      ok: connections >= minConnections,
      connections,
      minConnections,
      elapsedMs: summary.elapsedMs
    });
  }

  for (const { baseLabel, minPeers, required, core } of bases) {
    if (!required && !core) {
      evidence.push({
        phase: "CORE_PEERS",
        label: baseLabel,
        ok: true,
        skipped: true,
        elapsedMs: summary.elapsedMs
      });
      continue;
    }

    const peers = summary.observedPeers[baseLabel];
    evidence.push({
      phase: "CORE_PEERS",
      label: baseLabel,
      ok: typeof peers === "number" ? peers >= minPeers : false,
      peers,
      minPeers,
      elapsedMs: summary.elapsedMs
    });
  }

  evidence.push({
    phase: "READINESS_STABILITY",
    label: summary.label,
    ok: summary.stabilizationSucceeded,
    stableWindowMs: summary.stableWindowMs,
    pulseUsed: summary.pulseUsed,
    stabilizationEverSucceeded: summary.stabilizationEverSucceeded,
    elapsedMs: summary.elapsedMs
  });

  evidence.push({
    phase: "READINESS_SUMMARY",
    ...summary
  });
}

function snapshotConnections(swarms) {
  const out = {};
  for (const { swarmLabel, swarm } of swarms) {
    out[swarmLabel] = swarm?.connections?.size ?? 0;
  }
  return out;
}

function snapshotPeers(bases) {
  const out = {};
  for (const { baseLabel, core } of bases) {
    if (!core) {
      out[baseLabel] = null;
      continue;
    }
    const peers = core?.peers;
    out[baseLabel] = Array.isArray(peers) ? peers.length : null;
  }
  return out;
}

function allConnectionsReady(swarms, observedConnections) {
  for (const { swarmLabel, minConnections } of swarms) {
    if ((observedConnections[swarmLabel] ?? 0) < minConnections) return false;
  }
  return true;
}

function allPeersReady(bases, observedPeers) {
  for (const { baseLabel, required, minPeers, core } of bases) {
    if (!required) continue;
    if (!core) return { ready: false, missingRequiredBase: baseLabel };
    const peers = observedPeers[baseLabel];
    if (typeof peers !== "number") return { ready: false, missingRequiredBase: baseLabel };
    if (peers < minPeers) return { ready: false, missingRequiredBase: null };
  }
  return { ready: true, missingRequiredBase: null };
}

function buildReadinessSummary({
  label,
  ok,
  elapsedMs,
  readyTimeoutMs,
  pulseUsed,
  pulseAtMs,
  pulseErrors,
  stableWindowMs,
  observedConnections,
  observedPeers,
  stabilizationSucceeded,
  stabilizationEverSucceeded
}) {
  return {
    label,
    ok,
    elapsedMs,
    readyTimeoutMs,
    stableWindowMs,
    pulseUsed,
    pulseAtMs,
    pulseErrors,
    observedConnections,
    observedPeers,
    stabilizationSucceeded,
    stabilizationEverSucceeded
  };
}

function resolveReadyTimeoutMs(cfg) {
  const raw = cfg.readyMs ?? Math.max(cfg.connectMs || 0, cfg.peerMs || 0);
  return Math.max(1000, raw || 30000);
}

function pollCadenceMs(elapsedMs) {
  if (elapsedMs < 2000) return 50;
  if (elapsedMs < 10000) return 100;
  return 250;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function withTimeout(promise, ms, label) {
  let timer = null;
  try {
    return await Promise.race([
      promise,
      new Promise((_, reject) => {
        timer = setTimeout(() => reject(new Error(`${label} timeout after ${ms}ms`)), ms);
      })
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

function normalizeSwarm(desc, defaultMin = 1) {
  if (desc?.swarm) {
    return {
      swarm: desc.swarm,
      swarmLabel: desc.label || "swarm",
      minConnections: desc.minConnections ?? defaultMin
    };
  }
  return {
    swarm: desc,
    swarmLabel: "swarm",
    minConnections: defaultMin
  };
}

function normalizeDiscovery(desc) {
  if (desc?.target || desc?.discovery) {
    return {
      target: desc.target || desc.discovery,
      targetLabel: desc.label || "discovery"
    };
  }
  return {
    target: desc,
    targetLabel: "discovery"
  };
}

function normalizeBase(desc, defaultMin = 1) {
  const baseLike = desc?.base || desc;
  const core = desc?.core || resolveCore(baseLike);
  return {
    core,
    baseLabel: desc?.label || "base",
    minPeers: desc?.minPeers ?? defaultMin,
    required: desc?.required !== false
  };
}

function resolveCore(base) {
  if (!base) return null;
  if (base.core) return base.core;
  if (base.local) return base.local;
  if (base.view?.core) return base.view.core;
  return null;
}

export { waitForReplicationReady, ReplicationReadyError };
