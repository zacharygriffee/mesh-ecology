import test from "brittle";
import fs from "fs";
import Corestore from "corestore";
import crypto from "crypto";
import createFakeSwarm from "fakeswarm";
import b4a from "b4a";

import {
  __test__,
  OP,
  ensureConcernSurface,
  createJob,
  addWriter,
  getPublishView,
  getRatView,
  publishJobWork,
  publishJobRatification
} from "../../src/concern.js";
import { mkTmp } from "../_helpers/fs.js";
import { closeSwarm, safeFlush } from "../_helpers/swarm.js";

const STATE_ECON_OFF = { op: OP.STATE, v: 1, econ: { mode: 0, attemptBurn: 0, ratBurn: 0 } };

test("concern materializes admitted-writer PUB/RAT from non-optimistic apply", async (t) => {
  const prevProbeEnv = process.env.MESH_TEST_APPLY_PROBE;
  process.env.MESH_TEST_APPLY_PROBE = "1";
  __test__.setApplyProbe(null);

  const topics = new Map();
  const topic = crypto.randomBytes(32);
  const hostSwarm = createFakeSwarm({ topics });
  const admittedSwarm = createFakeSwarm({ topics });
  const nonWriterSwarm = createFakeSwarm({ topics });
  hostSwarm.join(topic);
  admittedSwarm.join(topic);
  nonWriterSwarm.join(topic);

  const dirs = [];
  let hostStore = null;
  let admittedStore = null;
  let nonWriterStore = null;
  let hostBase = null;
  let admittedBase = null;
  let nonWriterBase = null;

  try {
    const hostDir = mkTmp("admitted-non-opt-host-");
    const admittedDir = mkTmp("admitted-non-opt-admitted-");
    const nonWriterDir = mkTmp("admitted-non-opt-non-writer-");
    dirs.push(hostDir, admittedDir, nonWriterDir);

    hostStore = new Corestore(hostDir);
    admittedStore = new Corestore(admittedDir);
    nonWriterStore = new Corestore(nonWriterDir);
    await Promise.all([hostStore.ready?.(), admittedStore.ready?.(), nonWriterStore.ready?.()]);

    hostBase = await ensureConcernSurface(hostStore.namespace("concern-host"), hostSwarm);
    await hostBase.append(STATE_ECON_OFF, { optimistic: false });
    await hostBase.update({ wait: true });

    const concernHex = b4a.toString(hostBase.key, "hex");
    admittedBase = await ensureConcernSurface(
      admittedStore.namespace(`concern-${concernHex}-admitted`),
      admittedSwarm,
      { key: hostBase.key }
    );
    nonWriterBase = await ensureConcernSurface(
      nonWriterStore.namespace(`concern-${concernHex}-non-writer`),
      nonWriterSwarm,
      { key: hostBase.key }
    );

    const jobKey = await createJob(hostBase, "cap/admitted-non-opt/job", { in: "job" });
    const hostPublishView = getPublishView(hostBase);
    const hostRatView = getRatView(hostBase);
    const hostViewHex = toHex(hostBase.view?.feed?.key);

    await addWriter(hostBase, admittedBase.local.key);
    await hostBase.update({ wait: true });
    await waitForWritableBase({
      base: admittedBase,
      hostSwarm,
      admittedSwarm,
      timeoutMs: 10_000
    });

    const events = [];
    __test__.setApplyProbe((evt) => {
      events.push({
        op: evt?.op,
        optimistic: !!evt?.optimistic,
        writerHex: toHex(evt?.writerKey),
        viewHex: toHex(evt?.viewKey),
        jobHex: toHex(evt?.jobKey)
      });
    });

    const admittedAttempt = crypto.randomBytes(32);
    await publishJobWork(
      admittedBase,
      jobKey,
      "cap/admitted-non-opt/pub",
      { t: "result", k: jobKey, a: admittedAttempt },
      { test: "admitted-writer-pub" }
    );

    const admittedPubLeaf = await waitForLeaf({
      rounds: 120,
      settle: () => settle({ hostBase, admittedBase, nonWriterBase, hostSwarm, admittedSwarm, nonWriterSwarm }),
      getLeaf: () =>
        hostPublishView
          .sub(jobKey)
          .sub(admittedBase.local.key)
          .get(admittedAttempt, { valueEncoding: hostPublishView.valueEncoding })
          .catch(() => null)
    });
    t.ok(!!admittedPubLeaf, "admitted writer pub leaf materialized");

    await publishJobRatification(
      admittedBase,
      jobKey,
      admittedBase.local.key,
      admittedAttempt,
      1,
      1,
      "cap/admitted-non-opt/rat",
      { t: "result", k: jobKey, a: admittedAttempt },
      "admitted writer rat"
    );

    const admittedRatLeaf = await waitForLeaf({
      rounds: 140,
      settle: () => settle({ hostBase, admittedBase, nonWriterBase, hostSwarm, admittedSwarm, nonWriterSwarm }),
      getLeaf: () =>
        hostRatView
          .sub(jobKey)
          .sub(admittedBase.local.key)
          .sub(admittedBase.local.key)
          .get(admittedAttempt, { valueEncoding: hostRatView.valueEncoding })
          .catch(() => null)
    });
    t.ok(!!admittedRatLeaf, "admitted writer rat leaf materialized");

    const admittedWriterHex = toHex(admittedBase.local.key);
    const jobHex = toHex(jobKey);
    const admittedPubModes = new Set(
      events
        .filter((e) => e.viewHex === hostViewHex && e.writerHex === admittedWriterHex && e.jobHex === jobHex && e.op === OP.PUB)
        .map((e) => e.optimistic)
    );
    const admittedRatModes = new Set(
      events
        .filter((e) => e.viewHex === hostViewHex && e.writerHex === admittedWriterHex && e.jobHex === jobHex && e.op === OP.RAT)
        .map((e) => e.optimistic)
    );
    t.ok(admittedPubModes.has(false), "admitted writer PUB observed in non-optimistic apply");
    t.ok(admittedRatModes.has(false), "admitted writer RAT observed in non-optimistic apply");

    const nonWriterAttempt = crypto.randomBytes(32);
    await publishJobWork(
      nonWriterBase,
      jobKey,
      "cap/non-writer/pub",
      { t: "result", k: jobKey, a: nonWriterAttempt },
      { test: "non-writer-pub" }
    );

    const nonWriterLeaf = await waitForLeaf({
      rounds: 120,
      settle: () => settle({ hostBase, admittedBase, nonWriterBase, hostSwarm, admittedSwarm, nonWriterSwarm }),
      getLeaf: () =>
        hostPublishView
          .sub(jobKey)
          .sub(nonWriterBase.local.key)
          .get(nonWriterAttempt, { valueEncoding: hostPublishView.valueEncoding })
          .catch(() => null),
      allowMissing: true
    });

    const nonWriterHex = toHex(nonWriterBase.local.key);
    const nonWriterPubEvents = events.filter(
      (e) => e.viewHex === hostViewHex && e.writerHex === nonWriterHex && e.jobHex === jobHex && e.op === OP.PUB
    );
    t.ok(nonWriterPubEvents.length > 0, "non-writer PUB reached apply");
    t.is(
      nonWriterPubEvents.some((e) => e.optimistic === false),
      false,
      "non-writer PUB never materializes through non-optimistic apply path"
    );
    if (nonWriterLeaf) {
      t.ok(
        nonWriterPubEvents.some((e) => e.optimistic === true),
        "if non-writer leaf materializes, it is driven by optimistic apply"
      );
    }
  } finally {
    __test__.setApplyProbe(null);
    if (prevProbeEnv == null) delete process.env.MESH_TEST_APPLY_PROBE;
    else process.env.MESH_TEST_APPLY_PROBE = prevProbeEnv;

    await nonWriterBase?.close?.().catch(() => {});
    await nonWriterStore?.close?.().catch(() => {});
    await admittedBase?.close?.().catch(() => {});
    await admittedStore?.close?.().catch(() => {});
    await hostBase?.close?.().catch(() => {});
    await hostStore?.close?.().catch(() => {});
    await closeSwarm(nonWriterSwarm);
    await closeSwarm(admittedSwarm);
    await closeSwarm(hostSwarm);
    for (const dir of dirs) fs.rmSync(dir, { recursive: true, force: true });
  }
});

async function waitForWritableBase({ base, hostSwarm, admittedSwarm, timeoutMs }) {
  const stopAt = Date.now() + timeoutMs;
  while (Date.now() < stopAt) {
    await safeFlush(hostSwarm, 25).catch(() => {});
    await safeFlush(admittedSwarm, 25).catch(() => {});
    await base.update({ wait: false }).catch(() => {});
    if (base.writable) return true;
  }
  throw new Error("writer admission did not make admitted base writable before timeout");
}

async function settle({ hostBase, admittedBase, nonWriterBase, hostSwarm, admittedSwarm, nonWriterSwarm }) {
  await safeFlush(hostSwarm, 25).catch(() => {});
  await safeFlush(admittedSwarm, 25).catch(() => {});
  await safeFlush(nonWriterSwarm, 25).catch(() => {});
  await hostBase.update({ wait: true }).catch(() => {});
  await admittedBase.update({ wait: true }).catch(() => {});
  await nonWriterBase.update({ wait: true }).catch(() => {});
}

async function waitForLeaf({ rounds, settle, getLeaf, allowMissing = false }) {
  for (let i = 0; i < rounds; i++) {
    await settle();
    const leaf = await getLeaf();
    if (leaf) return leaf;
  }
  if (allowMissing) return null;
  throw new Error("expected derived leaf was not observed before timeout");
}

function toHex(value) {
  if (!value) return "";
  if (typeof value === "string") return value;
  if (b4a.isBuffer(value)) return b4a.toString(value, "hex");
  if (ArrayBuffer.isView(value)) return b4a.toString(b4a.from(value), "hex");
  return "";
}
