const ECON_MODE = { OFF: 0, BURN: 1, LOCK: 2 };
const MAX_U64 = (2n ** 64n) - 1n;

function toUint64(value) {
  if (value === undefined || value === null) return 0n;
  if (typeof value === "bigint") {
    if (value < 0n || value > MAX_U64) throw new Error("burn must be uint64");
    return value;
  }
  if (typeof value === "number" && Number.isInteger(value)) {
    const v = BigInt(value);
    if (v < 0n || v > MAX_U64) throw new Error("burn must be uint64");
    return v;
  }
  throw new Error("burn must be an integer");
}

function normalizeStrictConfigV1(input = {}) {
  const { econ = {}, v = 1 } = input;

  let vBig;
  if (typeof v === "bigint") {
    vBig = v;
  } else if (typeof v === "number" && Number.isInteger(v)) {
    vBig = BigInt(v);
  } else {
    throw new Error("v must be an integer");
  }
  if (vBig < 0n || vBig > MAX_U64) throw new Error("v must be uint64");

  const mode = econ.mode ?? ECON_MODE.OFF;
  if (!Number.isInteger(mode) || mode < ECON_MODE.OFF || mode > ECON_MODE.LOCK) {
    throw new Error("econ.mode must be 0,1,2");
  }

  const attemptBurn = toUint64(econ.attemptBurn);
  const ratBurn = toUint64(econ.ratBurn);

  return {
    v: vBig,
    econ: {
      mode,
      attemptBurn,
      ratBurn
    }
  };
}

export { ECON_MODE, MAX_U64, normalizeStrictConfigV1 };
