import test from "brittle";
import b4a from "b4a";
import Krypto from "hypercore-crypto";
import { __test__, PUB_KEY, RAT_KEY, JOB_KEY, STATE_KEY } from "../../src/concern.js";

// Minimal FakeView that records put order
class FakeView {
  constructor(store = new Map(), prefix = []) {
    this.store = store;
    this.prefix = prefix;
    this.log = store.__log || [];
    this.store.__log = this.log;
  }
  sub(key) {
    return new FakeView(this.store, this.prefix.concat([key]));
  }
  _keyString(key) {
    if (key === null || key === undefined) return "";
    if (b4a.isBuffer(key)) return b4a.toString(key, "hex");
    return String(key);
  }
  _composite(key) {
    const parts = this.prefix.map((p) => (b4a.isBuffer(p) ? b4a.toString(p, "hex") : String(p)));
    const leaf = this._keyString(key);
    return parts.join("/") + "|" + leaf;
  }
  async get(key, opts = {}) {
    const k = this._composite(key);
    if (!this.store.has(k)) return null;
    return { value: this.store.get(k) };
  }
  async put(key, value, opts = {}) {
    const k = this._composite(key);
    this.store.set(k, value);
    this.log.push({ prefix: this.prefix.map((p) => this._keyString(p)), key: this._keyString(key), op: "put" });
  }
}

const FakeHost = { ackWriter: async () => {}, addWriter: async () => {} };

const jobKey = b4a.alloc(32, 1);
const actorKey = b4a.alloc(32, 2);
const ratifierKey = b4a.alloc(32, 3);
const attemptToken = b4a.alloc(32, 4);
const ECON_BURN_TOTAL_KEY = __test__.keys.ECON_BURN_TOTAL_KEY;

const econOk = (effectKind, actor = actorKey) => async () => ({
  ok: true,
  effects: [ { type: "burn", kind: effectKind, actorKey: actor, jobKey, attemptToken, amount: 1n } ]
});

function seedJob(view) {
  view.store.set(view._composite(jobKey), { in: {}, cap: "c" });
}

function seedAttempt(view) {
  const k = view.sub(PUB_KEY).sub(jobKey).sub(actorKey)._composite(attemptToken);
  view.store.set(k, { oK: actorKey, cap: "c", ref: { k: jobKey, a: attemptToken, t: "t" } });
}

test("PUB writes acceptance before burn total", async (t) => {
  const store = new Map();
  const view = new FakeView(store);
  seedJob(view.sub(JOB_KEY));

  const updates = [
    {
      value: { op: 2, key: jobKey, cap: "c", ref: { t: "t", k: jobKey, a: attemptToken }, meta: {} },
      optimistic: true,
      from: { key: actorKey }
    }
  ];

  await __test__.applyWithDeps(updates, view, FakeHost, {
    validateEconomic: econOk("attempt"),
    getStrictStateFromView: async () => ({ econ: { mode: 1, attemptBurn: 1n, ratBurn: 1n } })
  });

  const pubPut = view.log.find((e) =>
    e.prefix.includes(b4a.toString(PUB_KEY, "hex")) &&
    e.prefix.includes(b4a.toString(jobKey, "hex")) &&
    e.prefix.includes(b4a.toString(actorKey, "hex")) &&
    e.key === b4a.toString(attemptToken, "hex")
  );
  const burnPut = view.log.find((e) =>
    e.prefix.includes(b4a.toString(ECON_BURN_TOTAL_KEY, "hex")) &&
    e.key === b4a.toString(actorKey, "hex")
  );

  t.ok(pubPut, "pub write logged");
  t.ok(burnPut, "burn write logged");
  t.ok(view.log.indexOf(pubPut) < view.log.indexOf(burnPut), "pub before burn");
});

test("PUB OFF numeric strict econ is normalized to bigint", async (t) => {
  const store = new Map();
  const view = new FakeView(store);
  seedJob(view.sub(JOB_KEY));

  // seed strict state with numeric burns (what compact-encoding stores)
  const strictKey = Krypto.hash([b4a.from("state/v1/config/strict")]);
  await view.sub(STATE_KEY).put(strictKey, { v: 1, econ: { mode: 0, attemptBurn: 0, ratBurn: 0 } });

  const updates = [
    {
      value: { op: 2, key: jobKey, cap: "c", ref: { t: "t", k: jobKey, a: attemptToken }, meta: {} },
      optimistic: true,
      from: { key: actorKey }
    }
  ];

  await __test__.applyWithDeps(updates, view, FakeHost);

  const pubPut = view.log.find((e) =>
    e.prefix.includes(b4a.toString(PUB_KEY, "hex")) &&
    e.prefix.includes(b4a.toString(jobKey, "hex")) &&
    e.prefix.includes(b4a.toString(actorKey, "hex")) &&
    e.key === b4a.toString(attemptToken, "hex")
  );

  t.ok(pubPut, "pub write logged under OFF mode with numeric burns");
});

test("RAT writes acceptance before burn total", async (t) => {
  const store = new Map();
  const view = new FakeView(store);
  seedJob(view.sub(JOB_KEY));
  seedAttempt(view);

  const updates = [
    {
      value: {
        op: 3,
        jK: jobKey,
        oK: actorKey,
        aK: attemptToken,
        d: 1,
        tr: 1,
        cap: "c",
        ref: { t: "t", k: jobKey, a: attemptToken },
        n: "note"
      },
      optimistic: true,
      from: { key: ratifierKey }
    }
  ];

  await __test__.applyWithDeps(updates, view, FakeHost, {
    validateEconomic: econOk("rat", ratifierKey),
    getStrictStateFromView: async () => ({ econ: { mode: 1, attemptBurn: 1n, ratBurn: 1n } })
  });

  const ratPut = view.log.find((e) =>
    e.prefix.includes(b4a.toString(RAT_KEY, "hex")) &&
    e.prefix.includes(b4a.toString(jobKey, "hex")) &&
    e.prefix.includes(b4a.toString(ratifierKey, "hex")) &&
    e.prefix.includes(b4a.toString(actorKey, "hex")) &&
    e.key === b4a.toString(attemptToken, "hex")
  );
  const burnPut = view.log.find((e) =>
    e.prefix.includes(b4a.toString(ECON_BURN_TOTAL_KEY, "hex")) &&
    e.key === b4a.toString(ratifierKey, "hex")
  );

  t.ok(ratPut, "rat write logged");
  t.ok(burnPut, "burn write logged");
  t.ok(view.log.indexOf(ratPut) < view.log.indexOf(burnPut), "rat before burn");
});
