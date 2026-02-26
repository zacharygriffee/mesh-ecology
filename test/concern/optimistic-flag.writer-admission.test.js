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
  publishJobWork,
  publishJobRatification
} from "../../src/concern.js";
import { mkTmp } from "../_helpers/fs.js";
import { closeSwarm, safeFlush } from "../_helpers/swarm.js";

const STATE_ECON_OFF = { op: OP.STATE, v: 1, econ: { mode: 0, attemptBurn: 0, ratBurn: 0 } };

test("concern.apply optimistic flag for PUB/RAT with and without writer admission", async (t) => {
  const prevProbeEnv = process.env.MESH_TEST_APPLY_PROBE;
  process.env.MESH_TEST_APPLY_PROBE = "1";
  __test__.setApplyProbe(null);

  try {
    const caseA = await runCase(t, { label: "A_NON_WRITER", admitWriter: false });
    const caseB = await runCase(t, { label: "B_ADMITTED_WRITER", admitWriter: true });

    t.is(caseA.pubMode, true, "case A PUB observed optimistic=true");
    t.is(caseA.ratMode, true, "case A RAT observed optimistic=true");
    t.is(caseB.pubMode, false, "case B PUB observed optimistic=false");
    t.is(caseB.ratMode, false, "case B RAT observed optimistic=false");
    t.ok(
      caseA.pubMode !== caseB.pubMode || caseA.ratMode !== caseB.ratMode,
      `ADMISSION_DID_NOT_CHANGE_OBSERVED_MODE caseA(pub=${caseA.pubMode},rat=${caseA.ratMode}) caseB(pub=${caseB.pubMode},rat=${caseB.ratMode})`
    );
  } finally {
    __test__.setApplyProbe(null);
    if (prevProbeEnv == null) delete process.env.MESH_TEST_APPLY_PROBE;
    else process.env.MESH_TEST_APPLY_PROBE = prevProbeEnv;
  }
});

async function runCase(t, { label, admitWriter }) {
  const topics = new Map();
  const topic = crypto.randomBytes(32);
  const hostSwarm = createFakeSwarm({ topics });
  const workerSwarm = createFakeSwarm({ topics });
  hostSwarm.join(topic);
  workerSwarm.join(topic);

  const dirs = [];
  let hostStore = null;
  let workerStore = null;
  let hostBase = null;
  let workerBase = null;

  try {
    const hostDir = mkTmp(`optimistic-flag-${label}-host-`);
    const workerDir = mkTmp(`optimistic-flag-${label}-worker-`);
    dirs.push(hostDir, workerDir);

    hostStore = new Corestore(hostDir);
    workerStore = new Corestore(workerDir);
    await Promise.all([hostStore.ready?.(), workerStore.ready?.()]);

    hostBase = await ensureConcernSurface(hostStore.namespace("concern-host"), hostSwarm);
    await hostBase.append(STATE_ECON_OFF, { optimistic: false });
    await hostBase.update({ wait: true });

    const concernHex = b4a.toString(hostBase.key, "hex");
    workerBase = await ensureConcernSurface(
      workerStore.namespace(`concern-${concernHex}`),
      workerSwarm,
      { key: hostBase.key }
    );

    if (admitWriter) {
      await addWriter(hostBase, workerBase.local.key);
      await hostBase.update({ wait: true });
      await waitForWritableBase({
        base: workerBase,
        hostSwarm,
        workerSwarm,
        timeoutMs: 8000
      });
    }

    const jobKey = await createJob(hostBase, `cap/${label}/job`, { in: label });
    const attemptToken = crypto.randomBytes(32);

    const hostViewHex = toHex(hostBase.view?.feed?.key);
    const workerWriterHex = toHex(workerBase.local.key);
    const jobHex = toHex(jobKey);
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

    await publishJobWork(workerBase, jobKey, `cap/${label}/pub`, {
      t: "result",
      k: jobKey,
      a: attemptToken
    }, { label });

    await publishJobRatification(
      workerBase,
      jobKey,
      workerBase.local.key,
      attemptToken,
      1,
      1,
      `cap/${label}/rat`,
      { t: "result", k: jobKey, a: attemptToken },
      `${label}-rat`
    );

    const filtered = await waitForCaseEvents({
      events,
      hostBase,
      workerBase,
      hostSwarm,
      workerSwarm,
      hostViewHex,
      workerWriterHex,
      jobHex,
      timeoutMs: 12_000
    });

    const pubModes = new Set(filtered.filter((e) => e.op === OP.PUB).map((e) => e.optimistic));
    const ratModes = new Set(filtered.filter((e) => e.op === OP.RAT).map((e) => e.optimistic));
    const pubMode = requireSingleMode(pubModes, `${label}:PUB`, filtered);
    const ratMode = requireSingleMode(ratModes, `${label}:RAT`, filtered);

    t.ok(true, `${label} observed modes: PUB=${pubMode} RAT=${ratMode}`);
    return { pubMode, ratMode, filtered };
  } finally {
    __test__.setApplyProbe(null);
    await workerBase?.close?.().catch(() => {});
    await workerStore?.close?.().catch(() => {});
    await hostBase?.close?.().catch(() => {});
    await hostStore?.close?.().catch(() => {});
    await closeSwarm(workerSwarm);
    await closeSwarm(hostSwarm);
    for (const dir of dirs) fs.rmSync(dir, { recursive: true, force: true });
  }
}

async function waitForWritableBase({ base, hostSwarm, workerSwarm, timeoutMs }) {
  const stopAt = Date.now() + timeoutMs;
  while (Date.now() < stopAt) {
    await safeFlush(hostSwarm, 25).catch(() => {});
    await safeFlush(workerSwarm, 25).catch(() => {});
    await base.update({ wait: false }).catch(() => {});
    if (base.writable) return true;
  }
  throw new Error("writer admission did not make worker base writable before timeout");
}

async function waitForCaseEvents({
  events,
  hostBase,
  workerBase,
  hostSwarm,
  workerSwarm,
  hostViewHex,
  workerWriterHex,
  jobHex,
  timeoutMs
}) {
  const stopAt = Date.now() + timeoutMs;
  while (Date.now() < stopAt) {
    await safeFlush(hostSwarm, 25).catch(() => {});
    await safeFlush(workerSwarm, 25).catch(() => {});
    await hostBase.update({ wait: true }).catch(() => {});
    await workerBase.update({ wait: true }).catch(() => {});

    const filtered = events.filter((e) =>
      e.viewHex === hostViewHex &&
      e.writerHex === workerWriterHex &&
      e.jobHex === jobHex &&
      (e.op === OP.PUB || e.op === OP.RAT)
    );

    const sawPub = filtered.some((e) => e.op === OP.PUB);
    const sawRat = filtered.some((e) => e.op === OP.RAT);
    if (sawPub && sawRat) return filtered;
  }

  throw new Error(
    `NO_PUB_OR_RAT_APPLY_EVENTS observed for host-view=${hostViewHex} writer=${workerWriterHex} job=${jobHex}`
  );
}

function requireSingleMode(modeSet, label, events) {
  if (modeSet.size === 0) {
    throw new Error(`${label} no mode observed; events=${JSON.stringify(events)}`);
  }
  if (modeSet.size > 1) {
    throw new Error(`${label} nondeterministic mode observed; events=${JSON.stringify(events)}`);
  }
  return Array.from(modeSet)[0];
}

function toHex(value) {
  if (!value) return "";
  if (typeof value === "string") return value;
  if (b4a.isBuffer(value)) return b4a.toString(value, "hex");
  if (ArrayBuffer.isView(value)) return b4a.toString(b4a.from(value), "hex");
  return "";
}
