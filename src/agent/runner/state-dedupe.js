import { writeAgentState } from "../state.js";

function createRunnerDedupeState() {
  // INTENT(phase-b2-style): Keep dedupe and publish cooldown state scoped to one runner instance and reconstructible from persisted agent state.
  return {
    acceptedByConcern: new Map(), // concernHex -> Set(jobHex:attemptHex)
    ratifiedByConcern: new Map(), // concernHex -> Set(marker)
    publishErrors: new Map() // concernHex -> Map(id -> {lastPublishError, publishErrorCount, cooldownUntil})
  };
}

function hydrateFromAgentState(dedupeState, prior = {}) {
  const priorAccepted = prior.accepted || {};
  for (const [concHex, arr] of Object.entries(priorAccepted)) {
    dedupeState.acceptedByConcern.set(concHex, new Set(arr));
  }

  const priorRatified = prior.ratified || {};
  for (const [concHex, arr] of Object.entries(priorRatified)) {
    dedupeState.ratifiedByConcern.set(concHex, new Set(arr));
  }
}

function rememberAccepted(dedupeState, concernHex, id) {
  if (!dedupeState.acceptedByConcern.has(concernHex)) dedupeState.acceptedByConcern.set(concernHex, new Set());
  dedupeState.acceptedByConcern.get(concernHex).add(id);
}

function rememberRatified(dedupeState, concernHex, marker) {
  if (!dedupeState.ratifiedByConcern.has(concernHex)) dedupeState.ratifiedByConcern.set(concernHex, new Set());
  dedupeState.ratifiedByConcern.get(concernHex).add(marker);
}

function recordPublishError(dedupeState, concernHex, id, message) {
  if (!dedupeState.publishErrors.has(concernHex)) dedupeState.publishErrors.set(concernHex, new Map());
  const concernErrors = dedupeState.publishErrors.get(concernHex);
  const prev = concernErrors.get(id) || { publishErrorCount: 0 };
  concernErrors.set(id, {
    lastPublishError: message,
    publishErrorCount: prev.publishErrorCount + 1,
    cooldownUntil: Date.now() + 1000
  });
}

function shouldCooldown(dedupeState, concernHex, id) {
  const entry = dedupeState.publishErrors.get(concernHex)?.get(id);
  if (!entry?.cooldownUntil) return false;
  return entry.cooldownUntil > Date.now();
}

async function persistToAgentState({ agentState, discoveries, warmStatuses, dedupeState }) {
  const cursorMap = Object.fromEntries(discoveries.map((d) => [d.key, d.cursor]));
  const warmMeta = {};
  for (const status of warmStatuses) {
    warmMeta[status.keyHex] = {
      status: status.status,
      attemptCount: status.attemptCount,
      attemptTicks: status.attemptTicks,
      attemptStartedAt: status.attemptStartedAt,
      cooldownUntil: status.cooldownUntil,
      lastAttemptAt: status.lastAttemptAt ?? 0
    };
  }

  // Boundary: persist Map/Set structures into JSON-safe arrays for agent state storage.
  const acceptedState = Object.fromEntries(
    Array.from(dedupeState.acceptedByConcern.entries()).map(([hex, set]) => [hex, Array.from(set)])
  );
  const ratifiedState = Object.fromEntries(
    Array.from(dedupeState.ratifiedByConcern.entries()).map(([hex, set]) => [hex, Array.from(set)])
  );

  await writeAgentState(agentState, {
    cursors: cursorMap,
    warm: { meta: warmMeta },
    accepted: acceptedState,
    ratified: ratifiedState
  });
}

function getPublishErrorStatus(dedupeState) {
  return Object.fromEntries(
    Array.from(dedupeState.publishErrors.entries()).map(([concHex, concernErrors]) => [
      concHex,
      Object.fromEntries(
        Array.from(concernErrors.entries()).map(([id, v]) => [
          id,
          { lastPublishError: v.lastPublishError, publishErrorCount: v.publishErrorCount, cooldownUntil: v.cooldownUntil }
        ])
      )
    ])
  );
}

export {
  createRunnerDedupeState,
  hydrateFromAgentState,
  rememberAccepted,
  rememberRatified,
  recordPublishError,
  shouldCooldown,
  persistToAgentState,
  getPublishErrorStatus
};
