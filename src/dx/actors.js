import b4a from "b4a";
import idEncoding from "hypercore-id-encoding";

import { random32 } from "../util/random32.js";
import { createWorkJournal } from "./work-journal.js";

const RATIFIER_DETERMINATION_ACCEPT = 1;
const RATIFIER_TIER_DEFAULT = 1;

function asBuf32(key, label) {
  const buf = b4a.isBuffer(key) ? key : idEncoding.decode(String(key));
  if (!b4a.isBuffer(buf) || buf.length !== 32) {
    throw new Error(`${label} must be a 32-byte key`);
  }
  return buf;
}

function toZ32(key, label) {
  return idEncoding.encode(asBuf32(key, label));
}

function defaultLogger() {
  return console;
}

function createActor({ role, name, runner = null, stateBee = null, definition, logger = defaultLogger() }) {
  if (!definition || typeof definition.onTick !== "function") {
    throw new Error("definition.onTick (async function) is required");
  }

  let boundRunner = runner;
  let boundStateBee = stateBee || runner?.stateBee || null;
  let journalPromise = null;

  function now() {
    return Date.now();
  }

  function log(...args) {
    const line = `[dx:${role}:${name}]`;
    if (typeof logger?.info === "function") return logger.info(line, ...args);
    if (typeof logger?.log === "function") return logger.log(line, ...args);
    return undefined;
  }

  function logError(...args) {
    const line = `[dx:${role}:${name}]`;
    if (typeof logger?.error === "function") return logger.error(line, ...args);
    if (typeof logger?.log === "function") return logger.log(line, ...args);
    return undefined;
  }

  async function ensureJournal() {
    if (!boundStateBee) {
      throw new Error(
        `stateBee is required for actor '${name}'. Pass stateBee explicitly or bind a runner exposing runner.stateBee.`
      );
    }
    if (!journalPromise) {
      journalPromise = createWorkJournal({ stateBee: boundStateBee, nowFn: now });
    }
    return journalPromise;
  }

  function cooldown(delayMs = 0, jitterMs = 0) {
    const min = Math.max(0, Number(delayMs) || 0);
    const jitter = Math.max(0, Number(jitterMs) || 0);
    return now() + min + Math.floor(Math.random() * (jitter + 1));
  }

  function createApi(ctx) {
    const work = {
      // This is workflow persistence, not protocol truth.
      // Acceptance is a derived view; do not mark work done until acceptance is observed.
      async create(input) {
        return (await ensureJournal()).create(input);
      },
      async get(input) {
        return (await ensureJournal()).get(input);
      },
      async put(input) {
        return (await ensureJournal()).put(input);
      },
      async listOpen(input) {
        return (await ensureJournal()).listOpen(input);
      },
      async markWaiting(item, input) {
        return (await ensureJournal()).markWaiting(item, input);
      },
      async markDone(item, input) {
        return (await ensureJournal()).markDone(item, input);
      },
      async abandon(item, input) {
        return (await ensureJournal()).abandon(item, input);
      },
      async existsForJob(input) {
        return (await ensureJournal()).existsForJob(input);
      },
      cooldown
    };

    const publish = {
      async pub({ concernKey, jobKey, cap, meta, attemptZ32 } = {}) {
        if (concernKey) {
          const expected = toZ32(ctx.concern.key, "ctx.concern.key");
          const provided = toZ32(concernKey, "concernKey");
          if (expected !== provided) {
            throw new Error(`concernKey mismatch for ${name}`);
          }
        }
        const jobBuf = asBuf32(jobKey, "jobKey");
        const attempt = attemptZ32 ? asBuf32(attemptZ32, "attemptZ32") : random32();
        const result = await ctx.publish.publishPub({
          cap,
          ref: {
            t: "result",
            k: jobBuf,
            a: attempt
          },
          meta
        });
        return {
          attemptZ32: idEncoding.encode(attempt),
          result
        };
      },
      async rat({ concernKey, jobKey, orgKey, attemptZ32, cap, note } = {}) {
        if (concernKey) {
          const expected = toZ32(ctx.concern.key, "ctx.concern.key");
          const provided = toZ32(concernKey, "concernKey");
          if (expected !== provided) {
            throw new Error(`concernKey mismatch for ${name}`);
          }
        }

        const jobBuf = asBuf32(jobKey, "jobKey");
        const orgBuf = asBuf32(orgKey, "orgKey");
        const attemptBuf = asBuf32(attemptZ32, "attemptZ32");

        const result = await ctx.publish.publishRat({
          jobKey: jobBuf,
          orgKey: orgBuf,
          attemptToken: attemptBuf,
          determination: RATIFIER_DETERMINATION_ACCEPT,
          tier: RATIFIER_TIER_DEFAULT,
          cap,
          ref: {
            t: "result",
            k: jobBuf,
            a: attemptBuf
          },
          note
        });

        return {
          attemptZ32: idEncoding.encode(attemptBuf),
          result
        };
      }
    };

    return {
      work,
      publish,
      now,
      log
    };
  }

  async function projector(ctx) {
    const api = createApi(ctx);
    try {
      await definition.onTick(ctx, api);
    } catch (err) {
      logError("onTick failed", err?.stack || err?.message || err);
      if (process.env.CI || process.env.NODE_ENV === "test") throw err;
    }
  }

  function bind({ runner: nextRunner, stateBee: nextStateBee } = {}) {
    if (nextRunner) boundRunner = nextRunner;
    if (nextStateBee) boundStateBee = nextStateBee;
    if (!boundStateBee && boundRunner?.stateBee) boundStateBee = boundRunner.stateBee;
    return actor;
  }

  const actor = {
    role,
    name,
    definition,
    projector,
    bind,
    get runner() {
      return boundRunner;
    },
    get stateBee() {
      return boundStateBee;
    },
    async tick() {
      if (!boundRunner) throw new Error(`runner not bound for actor '${name}'`);
      return boundRunner.tick();
    },
    async close() {
      if (!boundRunner) return;
      return boundRunner.close?.();
    },
    getStatus() {
      return boundRunner?.getStatus?.();
    }
  };

  return actor;
}

function createOrganismActor(input) {
  return createActor({ role: "organism", ...input });
}

function createRatifierActor(input) {
  return createActor({ role: "ratifier", ...input });
}

export {
  createOrganismActor,
  createRatifierActor
};
