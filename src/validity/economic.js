import b4a from "b4a";
import { ECON_MODE } from "./state.js";
import {
  ERR_ECON_CONFIG_INVALID,
  ERR_ECON_PROVIDER_MISSING,
  ERR_ECON_UNSUPPORTED_MODE,
  ERR_BUDGET_INSUFFICIENT
} from "./errors-economic.js";

const ok = (effects = []) => ({ ok: true, effects });
const fail = (code, details) => ({ ok: false, code, details });

function isBuf32(b) {
  return b4a.isBuffer(b) && b.length === 32;
}

function isUint8(n) {
  return Number.isInteger(n) && n >= 0 && n <= 0xff;
}

function validateInputs(ctx) {
  const { mode, attemptBurn, ratBurn, actorKey, jobKey, attemptToken, kind } = ctx;

  if (!isUint8(mode) || mode < ECON_MODE.OFF || mode > ECON_MODE.LOCK) return fail(ERR_ECON_CONFIG_INVALID, { where: "mode" });
  if (typeof attemptBurn !== "bigint" || attemptBurn < 0n) return fail(ERR_ECON_CONFIG_INVALID, { where: "attemptBurn" });
  if (typeof ratBurn !== "bigint" || ratBurn < 0n) return fail(ERR_ECON_CONFIG_INVALID, { where: "ratBurn" });
  if (!isBuf32(actorKey)) return fail(ERR_ECON_CONFIG_INVALID, { where: "actorKey" });
  if (!isBuf32(jobKey)) return fail(ERR_ECON_CONFIG_INVALID, { where: "jobKey" });
  if (attemptToken !== undefined && !b4a.isBuffer(attemptToken)) return fail(ERR_ECON_CONFIG_INVALID, { where: "attemptToken" });
  if (kind !== "attempt" && kind !== "rat") return fail(ERR_ECON_CONFIG_INVALID, { where: "kind" });

  return ok();
}

function validateProvider(provider) {
  if (!provider) return null;
  if (typeof provider.getInitialBudget !== "function") return null;
  if (typeof provider.getBurnedTotal !== "function") return null;
  return provider;
}

function toBigInt(value) {
  try {
    return BigInt(value);
  } catch {
    return null;
  }
}

function validateEconomic(ctx = {}) {
  const prelim = validateInputs(ctx);
  if (!prelim.ok) return prelim;

  const { mode, attemptBurn, ratBurn, kind, actorKey, jobKey, attemptToken, econProvider } = ctx;

  if (mode === ECON_MODE.OFF) return ok([]);
  if (mode === ECON_MODE.LOCK) return fail(ERR_ECON_UNSUPPORTED_MODE, { mode });

  const burnAmount = kind === "attempt" ? attemptBurn : ratBurn;
  if (burnAmount === 0n) return ok([]);

  const provider = validateProvider(econProvider);
  if (!provider) return fail(ERR_ECON_PROVIDER_MISSING);

  const initial = toBigInt(provider.getInitialBudget(actorKey));
  const burned = toBigInt(provider.getBurnedTotal(actorKey));
  if (initial === null || burned === null) return fail(ERR_ECON_PROVIDER_MISSING);
  if (initial < 0n || burned < 0n) return fail(ERR_ECON_PROVIDER_MISSING);

  const available = initial - burned;
  if (available < burnAmount) {
    return fail(ERR_BUDGET_INSUFFICIENT, { required: burnAmount, available, initial, burned });
  }

  return ok([
    {
      type: "burn",
      kind,
      actorKey,
      jobKey,
      attemptToken,
      amount: burnAmount
    }
  ]);
}

export { validateEconomic };
