import Krypto from "hypercore-crypto";
import b4a from "b4a";
import { normalizeStrictConfigV1 } from "../validity/state.js";
import { getWait } from "../getWait.js";
import { STATE_KEY } from "./keys.js";
import { stateEncoding } from "./encodings.js";

// INTENT(phase-c3-style): Keep strict-state reads centralized and normalized so all read boundaries return deterministic bigint-backed config shapes.

function strictConfigKey(v) {
  return Krypto.hash([b4a.from(`state/v${v}/config/strict`)]);
}

async function getStrictStateFromView(view, v = 1n) {
  // Boundary: strict state reads must decode via stateEncoding and normalize through normalizeStrictConfigV1.
  const key = strictConfigKey(v);
  const state = await view.sub(STATE_KEY).get(key, { valueEncoding: stateEncoding });
  if (!state) return null;
  const raw = state.value ?? state;
  return normalizeStrictConfigV1(raw);
}

async function getStrictState(concern, v) {
  // Boundary: wait-based strict state reads keep existing getWait semantics before normalization.
  const key = strictConfigKey(v);
  const state = await getWait(concern.view.sub(STATE_KEY), key, { valueEncoding: stateEncoding });
  if (!state) return null;
  return normalizeStrictConfigV1(state);
}

export { strictConfigKey, getStrictStateFromView, getStrictState };
