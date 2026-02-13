import { ensureDiscoverySurface } from "../discovery.js";
import idEncoding from "hypercore-id-encoding";
import { ensureAgentStateSurface, readAgentState, writeAgentState } from "./state.js";
import { joinDiscovery, ensureDiscoveryReplication, scanDiscovery } from "./discovery-roam.js";
import { createWarmsetManager, defaultOpenConcern } from "./warmset.js";
import b4a from "b4a";

// Shared shell: opens agent state, discovery, and warms concerns up to warmN.
// No projector logic or publishing; purely coordination.

async function createRunnerShell({ role, corestore, swarm, discoveryKeys = [], warmN = 1, log = console }) {
  const agentState = await ensureAgentStateSurface(corestore.namespace(`${role}-state`));
  const prior = (await readAgentState(agentState)) || { cursors: {}, warm: {} };

  const discoveries = [];
  for (const key of discoveryKeys) {
    const discKeyBuf = b4a.isBuffer(key) ? key : idEncoding.decode(key);
    const discKeyZ32 = idEncoding.encode(discKeyBuf);
    const disc = await ensureDiscoverySurface(
      corestore.namespace(`${role}-disc-${discKeyZ32}`),
      { key: discKeyBuf },
      swarm
    ); // replica open: scan-only
    ensureDiscoveryReplication(disc, swarm);
    joinDiscovery(swarm, disc);
    discoveries.push({ disc, cursor: prior.cursors[discKeyZ32] ?? 0, key: discKeyZ32 });
  }

  const openConcern = await defaultOpenConcern({ cs: corestore, swarm });
  const warmset = createWarmsetManager({ warmN, openConcern });

  async function tick() {
    for (const d of discoveries) {
      await d.disc.update({ wait: true }).catch(() => {});
      let latest = d.cursor;
      for await (const entry of scanDiscovery(d.disc, { since: d.cursor })) {
        latest = entry.seq;
        if (entry.t === 2 /* CONCERN */) {
          await warmset.warm(entry.k32);
        }
      }
      d.cursor = latest;
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
