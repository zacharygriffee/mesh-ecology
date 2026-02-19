import b4a from "b4a";
import idEncoding from "hypercore-id-encoding";
import Hyperbee from "hyperbee";
import { ensureAgentStateSurface, readAgentState } from "./state.js";
import { ensureDiscoverySurface } from "../discovery.js";
import { joinDiscovery, ensureDiscoveryReplication, scanDiscovery } from "./discovery-roam.js";
import { createWarmsetManager, defaultOpenConcern } from "./warmset.js";
import { normalizeWarmN, normalizeWarmupBudget, normalizeRetryPolicy } from "./config.js";
import {
  publishJobWork,
  publishJobRatification,
  getPublishView,
  getRatView,
  getJobView,
  getStrictState,
  viewPubEncoding,
  viewRatEncoding
} from "../concern.js";
import { createPubsIterator } from "./runner/pubs-iterator.js";
import { createRatsIterator } from "./runner/rats-iterator.js";
import { createPublishPub } from "./runner/publish-pub.js";
import { createPublishRat } from "./runner/publish-rat.js";
import {
  createProjectorContextFactory,
  makeRatifiedMarker
} from "./runner/projector-context.js";
import { createTick } from "./runner/tick.js";
import {
  RATIFIER_DETERMINATION_ACCEPT,
  RATIFIER_TIER_DEFAULT,
  getDefaultProjector
} from "./runner/default-projectors.js";
import {
  createRunnerDedupeState,
  hydrateFromAgentState,
  rememberAccepted,
  forgetAccepted,
  rememberRatified,
  recordPublishError,
  shouldCooldown,
  persistToAgentState,
  getPublishErrorStatus
} from "./runner/state-dedupe.js";

function validatePubAction(action = {}) {
  if (!action || typeof action !== "object") throw new Error("action must be an object");
  const { cap, ref, meta } = action;
  if (typeof cap !== "string" || !cap.length) throw new Error("cap must be non-empty string");
  if (!ref || typeof ref !== "object") throw new Error("ref is required");
  const { t, k, a } = ref;
  if (typeof t !== "string" || !t.length) throw new Error("ref.t required");
  if (!k) throw new Error("ref.k required");
  if (!a) throw new Error("ref.a (attempt token) required");
  if (meta && typeof meta !== "object") throw new Error("meta must be object if present");
  return { cap, ref, meta };
}

function validateRatAction(action = {}) {
  if (!action || typeof action !== "object") throw new Error("action must be an object");
  const {
    jobKey,
    orgKey,
    attemptToken,
    determination = RATIFIER_DETERMINATION_ACCEPT,
    tier = RATIFIER_TIER_DEFAULT,
    cap,
    ref,
    note
  } = action;

  if (!jobKey) throw new Error("jobKey required");
  if (!orgKey) throw new Error("orgKey required");
  if (!attemptToken) throw new Error("attemptToken required");
  if (!Number.isInteger(determination) || determination < 0 || determination > 0xff) {
    throw new Error("determination must be uint8");
  }
  if (!Number.isInteger(tier) || tier < 0 || tier > 0xffff) {
    throw new Error("tier must be uint16");
  }
  if (typeof cap !== "string" || !cap.length) throw new Error("cap must be non-empty string");
  if (!ref || typeof ref !== "object") throw new Error("ref is required");
  const { t, a } = ref;
  if (typeof t !== "string" || !t.length) throw new Error("ref.t required");
  if (!a) throw new Error("ref.a (attempt token) required");
  if (note !== undefined && typeof note !== "string") throw new Error("note must be string if present");

  return { jobKey, orgKey, attemptToken, determination, tier, cap, ref, note };
}


async function createRunner({
  role,
  corestore,
  swarm,
  discoveryKeys,
  warmN,
  warmupBudget = {},
  retryPolicy = {},
  projector,
  log = console
}) {
  const agentState = await ensureAgentStateSurface(corestore.namespace(`${role}-state`));
  const workflowStateBee = new Hyperbee(
    corestore.namespace(`${role}-state`).get({ name: "dx-workflow-state" }),
    { keyEncoding: "utf-8", valueEncoding: "json", extension: false }
  );
  await workflowStateBee.ready?.();
  const prior = (await readAgentState(agentState)) || { cursors: {}, warm: { meta: {} }, accepted: {}, ratified: {} };
  const projectorFn = projector ?? getDefaultProjector(role);

  const discoveries = [];
  for (const key of discoveryKeys) {
    const buf = b4a.isBuffer(key) ? key : idEncoding.decode(key);
    const z = idEncoding.encode(buf);
    const disc = await ensureDiscoverySurface(corestore.namespace(`${role}-disc-${z}`), { key: buf }, swarm);
    ensureDiscoveryReplication(disc, swarm);
    joinDiscovery(swarm, disc);
    discoveries.push({ disc, cursor: prior.cursors[z] ?? 0, key: z });
  }

  const openConcern = await defaultOpenConcern({ cs: corestore, swarm });
  const normalizedWarmN = normalizeWarmN(warmN);
  const warmset = createWarmsetManager({ warmN: normalizedWarmN, openConcern });
  const budget = normalizeWarmupBudget(warmupBudget);
  const retry = normalizeRetryPolicy(retryPolicy);

  // Seed warmset from prior warm metadata if present.
  const priorWarmMeta = prior.warm?.meta || {};
  for (const [hex, meta] of Object.entries(priorWarmMeta)) {
    const buf = b4a.from(hex, "hex");
    await warmset.warm(buf, { warmupBudget: budget, retryPolicy: retry });
  }

  const dedupeState = createRunnerDedupeState();
  hydrateFromAgentState(dedupeState, prior);

  const buildProjectorContext = createProjectorContextFactory({
    role,
    getPublishView,
    getRatView,
    getJobView,
    viewPubEncoding,
    viewRatEncoding,
    createPubsIterator,
    createRatsIterator,
    createPublishPub,
    createPublishRat,
    validatePubAction,
    validateRatAction,
    publishJobWork,
    publishJobRatification,
    rememberAccepted,
    forgetAccepted,
    shouldCooldown,
    recordPublishError
  });

  async function hydrateAccepted(concernBase, concernHex) {
    const publishView = getPublishView(concernBase);
    for await (const jobEntry of publishView.createReadStream()) {
      const jobKey = jobEntry.key;
      if (!jobKey) continue;
      const jobHex = b4a.toString(jobKey, "hex");
      const jobSub = publishView.sub(jobKey);
      for await (const fromEntry of jobSub.createReadStream()) {
        const fromKey = fromEntry.key;
        if (!fromKey) continue;
        const attemptStream = jobSub.sub(fromKey).createReadStream({ valueEncoding: viewPubEncoding });
        for await (const { key: attemptKey, value } of attemptStream) {
          const attemptBuf = value?.ref?.a || attemptKey;
          const attemptHex = b4a.toString(attemptBuf, "hex");
          rememberAccepted(dedupeState, concernHex, `${jobHex}:${attemptHex}`);
        }
      }
    }
  }

  async function hydrateRatified(concernBase, concernHex, concernKey) {
    const ratView = getRatView(concernBase);
    for await (const jobEntry of ratView.createReadStream()) {
      const jobKey = jobEntry.key;
      if (!jobKey) continue;
      const jobSub = ratView.sub(jobKey);
      for await (const ratifierEntry of jobSub.createReadStream()) {
        const ratifierKey = ratifierEntry.key;
        if (!ratifierKey) continue;
        const ratifierSub = jobSub.sub(ratifierKey);
        for await (const orgEntry of ratifierSub.createReadStream()) {
          const organismKey = orgEntry.key;
          if (!organismKey) continue;
          const attemptStream = ratifierSub
            .sub(organismKey)
            .createReadStream({ valueEncoding: viewRatEncoding });
          for await (const { key: attemptKey, value } of attemptStream) {
            const attemptBuf = value?.ref?.a || attemptKey;
            rememberRatified(dedupeState, concernHex, makeRatifiedMarker(concernKey, ratifierKey, jobKey, organismKey, attemptBuf));
          }
        }
      }
    }
  }

  async function persistState() {
    await persistToAgentState({
      agentState,
      discoveries,
      warmStatuses: warmset.getStatuses(),
      dedupeState
    });
  }

  const tick = createTick({
    discoveries,
    scanDiscovery,
    warmset,
    warmupBudget: budget,
    retryPolicy: retry,
    getStrictState,
    getPublishView,
    getRatView,
    getJobView,
    buildProjectorContext,
    projector: projectorFn,
    dedupeState,
    hydrateRatified,
    persistState
  });

  async function close() {
    // Capture any accepted attempts that may not have been streamed yet.
    for (const w of warmset.getWarm()) {
      const concernHex = b4a.toString(w.keyBuf, "hex");
      await hydrateAccepted(w.base, concernHex);
      await hydrateRatified(w.base, concernHex, w.keyBuf);
    }

    // Persist latest state before teardown to keep dedupe across restarts.
    await persistState();

    await warmset.close();
    for (const { disc } of discoveries) await disc.close?.();
    await workflowStateBee.close?.();
    await agentState.close?.();
  }

  function getStatus() {
    const publishErrorState = getPublishErrorStatus(dedupeState);
    return {
      cursors: Object.fromEntries(discoveries.map((d) => [d.key, d.cursor])),
      warm: warmset.getStatuses(),
      publishErrors: publishErrorState
    };
  }

  async function start() {
    // phase 2: start is manual tick; implement loop later
    return tick();
  }

  return {
    tick,
    start,
    close,
    getStatus,
    // DX extension point: runner-local workflow state (work journal, cooldown hints, etc.).
    // This is writable local state and is not concern-canonical protocol state.
    stateBee: workflowStateBee
  };
}

export { createRunner };
