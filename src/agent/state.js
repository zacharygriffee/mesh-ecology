import Autobase from "autobase";
import Hyperbee from "hyperbee";
import c from "compact-encoding";

// Agent state lives in its own Autobase/Hyperbee view. It is coordination-only
// (discovery cursors, warmset hints) and is not concern-canonical.

const OP = { STATE: 1, ADD: 2 };
const STATE_KEY = "agent/v1/state";

const stateEncoding = c.json; // { cursors: { [discKey]: number }, warm: { keys: string[] } }

const baseEncoding = {
  preencode(state, { op, state: payload, key }) {
    c.uint8.preencode(state, op);
    if (op === OP.STATE) stateEncoding.preencode(state, payload);
    if (op === OP.ADD) c.fixed32.preencode(state, key);
  },
  encode(state, { op, state: payload, key }) {
    c.uint8.encode(state, op);
    if (op === OP.STATE) stateEncoding.encode(state, payload);
    if (op === OP.ADD) c.fixed32.encode(state, key);
  },
  decode(state) {
    const op = c.uint8.decode(state);
    let payload = null;
    let key = null;
    if (op === OP.STATE) payload = stateEncoding.decode(state);
    if (op === OP.ADD) key = c.fixed32.decode(state);
    return { op, state: payload, key };
  },
};

function open(store) {
  // UTF-8 keys; JSON values. No extensions.
  const core = store.get({ name: "view" });
  return new Hyperbee(core, { keyEncoding: "utf-8", valueEncoding: stateEncoding, extension: false });
}

async function apply(updates, view, host) {
  for await (const { value } of updates) {
    if (value.op === OP.ADD) {
      await host.addWriter(value.key);
      continue;
    }
    if (value.op === OP.STATE) {
      await view.put(STATE_KEY, value.state);
    }
  }
}

async function ensureAgentStateSurface(cs, config = {}) {
  const key = config.key || (await Autobase.getLocalKey(cs));
  const base = new Autobase(cs, key, {
    valueEncoding: baseEncoding,
    open,
    apply,
    optimistic: false
  });
  await base.ready();
  await base.update(); // bring view up to date for capability checks and state reads
  return base;
}

async function readAgentState(base) {
  const res = await base.view.get(STATE_KEY).catch(() => null);
  return res?.value ?? res ?? null;
}

async function writeAgentState(base, state) {
  await base.append({ op: OP.STATE, state });
  await base.update({ wait: true });
}

async function addAgentWriter(base, key) {
  await base.append({ op: OP.ADD, key });
  await base.update({ wait: true });
}

export { ensureAgentStateSurface, readAgentState, writeAgentState, addAgentWriter, STATE_KEY };
