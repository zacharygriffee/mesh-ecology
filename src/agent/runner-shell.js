import { KIND } from "../discovery.js";
import { ensureAgentStateSurface, readAgentState, writeAgentState } from "./state.js";
import { scanDiscovery, ensureTrackedDiscovery as ensureTrackedDiscoveryBase } from "./discovery-roam.js";
import { createWarmsetManager, defaultOpenConcern } from "./warmset.js";
import { normalizeWarmN } from "./config.js";
import b4a from "b4a";

// Shared shell: opens agent state, discovery, and warms concerns up to warmN.
// It is coordination-only: it should observe and warm replica state without
// implying writer authority or performing admission-side actions.

async function createRunnerShell({ role, corestore, swarm, discoveryKeys = [], warmN = 1, log = console }) {
  const agentState = await ensureAgentStateSurface(corestore.namespace(`${role}-state`));
  const prior = (await readAgentState(agentState)) || { cursors: {}, warm: {} };
  const discoveryCursors = prior.cursors ?? {};

  const discoveries = [];
  const discoveryIndex = new Map();
  for (const key of discoveryKeys) {
    await ensureTrackedDiscoveryBase({
      discoveries,
      discoveryIndex,
      corestore,
      swarm,
      key,
      cursors: discoveryCursors,
      namespacePrefix: `${role}-disc`
    });
  }
  for (const key of Object.keys(discoveryCursors)) {
    await ensureTrackedDiscoveryBase({
      discoveries,
      discoveryIndex,
      corestore,
      swarm,
      key,
      cursors: discoveryCursors,
      namespacePrefix: `${role}-disc`
    });
  }

  const openConcern = await defaultOpenConcern({ cs: corestore, swarm });
  const normalizedWarmN = normalizeWarmN(warmN);
  const warmset = createWarmsetManager({ warmN: normalizedWarmN, openConcern });

  async function tick() {
    const currentDiscoveries = discoveries.slice();
    const pendingDiscoveries = [];
    for (const d of currentDiscoveries) {
      await d.disc.update({ wait: true }).catch(() => {});
      let latest = d.cursor;
      for await (const entry of scanDiscovery(d.disc, { since: d.cursor })) {
        latest = entry.seq;
        if (entry.t === KIND.CONCERN) {
          await warmset.warm(entry.k32);
        } else if (entry.t === KIND.DISCOVERY) {
          pendingDiscoveries.push(entry.k32);
        }
      }
      d.cursor = latest;
    }
    for (const keyBuf of pendingDiscoveries) {
      await ensureTrackedDiscoveryBase({
        discoveries,
        discoveryIndex,
        corestore,
        swarm,
        key: keyBuf,
        cursors: discoveryCursors,
        namespacePrefix: `${role}-disc`
      });
    }
    const cursorMap = Object.fromEntries(discoveries.map((d) => [d.key, d.cursor]));
    const warmKeys = warmset.getWarm().map((w) => b4a.toString(w.keyBuf, "hex"));
    await writeAgentState(agentState, { cursors: cursorMap, warm: { keys: warmKeys } });
  }

  async function close() {
    await warmset.close();
    for (const { disc } of discoveries) await disc.close?.();
    await agentState.close?.();
  }

  return { tick, getWarm: warmset.getWarm, close };
}

export { createRunnerShell };
