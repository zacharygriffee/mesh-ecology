import { retry } from "../retry.js";
import { waitForSwarmConnections, flushDiscovery } from "../waiters/swarm.js";

const DEFAULT_TIMEOUTS = {
  flushMs: 5000,
  connectMs: 20000,
  advertiseMs: 5000,
  jobVisibleMs: 20000,
  pubVisibleMs: 20000,
  ratVisibleMs: 20000
};

const DEFAULT_RETRY = {
  attempts: 3,
  timeoutMs: 5000,
  baseDelayMs: 200,
  maxDelayMs: 2000,
  jitter: 0.2,
  label: "phase"
};

const DEFAULT_PLAN = {
  minSwarmConnections: 1,
  requireConcernAdvertised: true,
  requireJobVisible: true,
  requirePubVisible: false,
  requireRatVisible: false
};

async function runFourBringup(opts) {
  const {
    spawn,
    advertiseConcern,
    checkJobVisible,
    checkPubVisible,
    checkRatVisible,
    plan = {},
    timeouts = {},
    retry: retryOpts = {},
    log
  } = opts;

  if (!spawn?.startDiscovery || !spawn?.startConcern || !spawn?.startOrganism || !spawn?.startRatifier) {
    throw new Error("spawn functions for all roles are required");
  }

  const planCfg = { ...DEFAULT_PLAN, ...plan };
  const timeCfg = { ...DEFAULT_TIMEOUTS, ...timeouts };
  const retryCfg = { ...DEFAULT_RETRY, ...retryOpts };

  const evidence = [];
  const summary = {};

  const record = (phase, attemptInfo) => {
    evidence.push({ phase, ...attemptInfo });
    if (log) log({ phase, ...attemptInfo });
  };

  const discovery = await spawn.startDiscovery();
  const concern = await spawn.startConcern();
  const organism = await spawn.startOrganism();
  const ratifier = await spawn.startRatifier();

  // Phase helpers
  const doPhase = async (name, work) => {
    const res = await retry(async ({ attempt }) => {
      const started = Date.now();
      try {
        const result = await work();
        record(name, { attempt, ok: true, elapsedMs: Date.now() - started, result });
        return { ok: true, result };
      } catch (err) {
        record(name, { attempt, ok: false, error: err?.message ?? String(err), elapsedMs: Date.now() - started });
        throw err;
      }
    }, { ...retryCfg, label: name });
    return res;
  };

  // DISCOVERY_FLUSH
  await doPhase("DISCOVERY_FLUSH", async () => {
    const flushRes = await flushDiscovery({
      swarm: discovery.swarm,
      discovery: discovery.discoveryJoin,
      timeoutMs: timeCfg.flushMs
    });
    return { ...flushRes, note: "does not imply peers exist" };
  });

  // SWARM_CONNECT
  await doPhase("SWARM_CONNECT", async () => {
    const res = await waitForSwarmConnections(discovery.swarm, {
      min: planCfg.minSwarmConnections,
      timeoutMs: timeCfg.connectMs
    });
    if (!res.reached) throw new Error(`swarm connections < ${planCfg.minSwarmConnections}`);
    return res;
  });

  // CONCERN_ADVERTISE
  if (planCfg.requireConcernAdvertised) {
    if (!advertiseConcern) {
      record("CONCERN_ADVERTISE", { attempt: 1, ok: false, error: "advertiseConcern not provided" });
      return { ok: false, evidence, failures: ["advertiseConcern missing"], summary };
    }
    const advertiseCheck = opts.checkConcernAdvertised;
    await doPhase("CONCERN_ADVERTISE", async () => {
      await advertiseConcern({
        DISCOVERY: discovery.DISCOVERY,
        discoveryJoin: discovery.discoveryJoin,
        concernKey: concern.info?.key,
        meta: concern.info?.meta
      });
      if (advertiseCheck) {
        const ok = await advertiseCheck();
        if (!ok) throw new Error("advertise not confirmed");
      }
      return { advertised: true };
    });
  }

  // JOB_VISIBLE
  if (planCfg.requireJobVisible) {
    const checker = checkJobVisible || (async () => {
      const len = concern.beeJob?.core?.length ?? 0;
      return len > 0;
    });
    await doPhase("JOB_VISIBLE", async () => {
      const ok = await checker({ CONCERN: concern });
      if (!ok) throw new Error("job not visible");
      return { visible: true };
    });
  }

  // PUB_VISIBLE
  if (planCfg.requirePubVisible) {
    const checker = checkPubVisible || (async () => false);
    await doPhase("PUB_VISIBLE", async () => {
      const ok = await checker({ CONCERN: concern, organism });
      if (!ok) throw new Error("pub not visible");
      return { visible: true };
    });
  }

  // RAT_VISIBLE
  if (planCfg.requireRatVisible) {
    const checker = checkRatVisible || (async () => false);
    await doPhase("RAT_VISIBLE", async () => {
      const ok = await checker({ CONCERN: concern, ratifier });
      if (!ok) throw new Error("rat not visible");
      return { visible: true };
    });
  }

  summary.plan = planCfg;
  return { ok: true, evidence, summary };
}

export { runFourBringup };
