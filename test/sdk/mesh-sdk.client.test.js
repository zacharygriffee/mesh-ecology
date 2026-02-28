import test from "brittle";
import Corestore from "corestore";
import crypto from "crypto";
import fs from "fs";
import path from "path";
import createFakeSwarm from "fakeswarm";
import idEncoding from "hypercore-id-encoding";

import { mkTmp } from "../_helpers/fs.js";
import { closeSwarm, safeFlush } from "../_helpers/swarm.js";
import {
  ensureConcernSurface,
  createJob,
  publishJobWork,
  publishJobRatification
} from "../../src/concern.js";
import { createMeshClient } from "../../packages/mesh-sdk/index.js";

function hasDoctorJson(rootDir) {
  if (!fs.existsSync(rootDir)) return false;
  const stack = [rootDir];
  while (stack.length) {
    const current = stack.pop();
    const entries = fs.readdirSync(current, { withFileTypes: true });
    for (const entry of entries) {
      const full = path.join(current, entry.name);
      if (entry.isDirectory()) stack.push(full);
      if (entry.isFile() && entry.name === "doctor.json") return true;
    }
  }
  return false;
}

async function createHarness() {
  const topics = new Map();
  const hostSwarm = createFakeSwarm({ topics });
  const clientSwarm = createFakeSwarm({ topics });
  const topic = crypto.randomBytes(32);
  hostSwarm.join(topic);
  clientSwarm.join(topic);

  const hostDir = mkTmp("sdk-host-");
  const clientDir = mkTmp("sdk-client-");

  const hostStore = new Corestore(hostDir);
  await hostStore.ready?.();
  const hostBase = await ensureConcernSurface(hostStore.namespace("concern-host"), hostSwarm);
  await hostBase.update({ wait: true });

  const concernKey = idEncoding.encode(hostBase.key);
  const client = createMeshClient({
    storeRoot: clientDir,
    concernKeys: [concernKey],
    swarm: clientSwarm,
    noDoctor: true
  });

  async function pump(cycles = 20) {
    for (let i = 0; i < cycles; i++) {
      await safeFlush(hostSwarm);
      await safeFlush(clientSwarm);
      await hostBase.update({ wait: false }).catch(() => {});
      await new Promise((resolve) => setTimeout(resolve, 15));
    }
  }

  function startHostLoop(intervalMs = 40) {
    let closed = false;
    let running = false;
    const timer = setInterval(async () => {
      if (closed || running) return;
      running = true;
      try {
        await safeFlush(hostSwarm);
        await safeFlush(clientSwarm);
        await hostBase.update({ wait: false }).catch(() => {});
      } finally {
        running = false;
      }
    }, intervalMs);
    return () => {
      closed = true;
      clearInterval(timer);
    };
  }

  async function close() {
    await client.close();
    await hostBase.close().catch(() => {});
    await hostStore.close().catch(() => {});
    await closeSwarm(hostSwarm);
    await closeSwarm(clientSwarm);
    fs.rmSync(hostDir, { recursive: true, force: true });
    fs.rmSync(clientDir, { recursive: true, force: true });
  }

  return {
    hostBase,
    concernKey,
    client,
    hostDir,
    clientDir,
    pump,
    startHostLoop,
    close
  };
}

test("sdk state() returns schema v1 keys and no doctor artifacts", async (t) => {
  const h = await createHarness();
  try {
    await createJob(h.hostBase, "cap/sdk-state", { in: "job" });
    await h.hostBase.update({ wait: true });
    await h.pump(25);

    const out = await h.client.state();
    t.is(out.schema, "mesh-ecology-packs/state/v1");
    t.is(out.schemaVersion, 1);
    t.is(out.command, "state");
    t.ok(typeof out.ok === "boolean");
    t.ok(out.flags && typeof out.flags === "object");
    t.ok(out.topology && Array.isArray(out.topology.concernKeys));
    t.ok(Array.isArray(out.sideEffects));
    t.ok(out.artifacts && out.artifacts.summary && out.artifacts.items);
    t.ok(Array.isArray(out.checks));
    t.ok(Array.isArray(out.processes));
    t.ok(Array.isArray(out.concerns));
    t.ok(out.summary && typeof out.summary === "object");
    t.is(out.concerns.length, 1);
    t.absent(hasDoctorJson(h.clientDir), "sdk created no doctor artifacts");
  } finally {
    await h.close();
  }
});

test("sdk trace() reports attempt/ratifier materialization with truncation fields", async (t) => {
  const h = await createHarness();
  try {
    const jobKey = await createJob(h.hostBase, "cap/sdk-trace", { in: "trace" });
    const attempt = crypto.randomBytes(32);
    await publishJobWork(
      h.hostBase,
      jobKey,
      "cap/sdk-pub",
      { t: "result", k: jobKey, a: attempt },
      { ok: true }
    );
    await publishJobRatification(
      h.hostBase,
      jobKey,
      h.hostBase.local.key,
      attempt,
      1,
      1,
      "cap/sdk-rat",
      { t: "result", k: jobKey, a: attempt },
      "rat"
    );
    await h.hostBase.update({ wait: true });
    await h.pump(30);

    let out = null;
    for (let i = 0; i < 80; i++) {
      out = await h.client.trace({ jobKey: idEncoding.encode(jobKey) });
      if (out.concerns?.[0]?.stage === "rat_present") break;
      await h.pump(1);
    }
    t.is(out.schema, "mesh-ecology-packs/trace/v1");
    t.is(out.schemaVersion, 1);
    t.is(out.command, "trace");
    t.is(typeof out.jobKey, "string");
    t.is(out.concerns.length, 1);
    const row = out.concerns[0];
    t.is(row.stage, "rat_present");
    t.is(row.jobPresent, true);
    t.ok(Array.isArray(row.attempts));
    t.ok(row.attemptsTotal >= 1);
    t.is(row.attemptsReturned, row.attempts.length);
    t.is(typeof row.attemptsLimit, "number");
    t.is(typeof row.attemptsTruncated, "boolean");
    t.ok(row.attempts[0].ratifiersTotal >= 1);
    t.is(row.attempts[0].ratifiersReturned, row.attempts[0].ratifiers.length);
    t.is(typeof row.attempts[0].ratifiersLimit, "number");
    t.is(typeof row.attempts[0].ratifiersTruncated, "boolean");
  } finally {
    await h.close();
  }
});

test("sdk proposePub/proposeRat + waitForMaterialization work in-process without spawn", async (t) => {
  const h = await createHarness();
  try {
    const jobKey = await createJob(h.hostBase, "cap/sdk-propose", { in: "proposal" });
    await h.hostBase.update({ wait: true });
    await h.pump(20);

    const attemptToken = crypto.randomBytes(32);
    const proposedPub = await h.client.proposePub({
      concernKey: h.concernKey,
      cap: "cap/sdk-propose-pub",
      ref: {
        t: "result",
        k: jobKey,
        a: attemptToken
      },
      meta: { source: "sdk-test" }
    });
    t.alike(proposedPub, { ok: true, submitted: true, accepted: false, deduped: false });

    const stopPubLoop = h.startHostLoop(25);
    const pubWait = await h.client.waitForMaterialization({
      concernKey: h.concernKey,
      jobKey,
      kind: "pub",
      attemptToken,
      timeoutMs: 8000,
      intervalMs: 120
    });
    stopPubLoop();
    t.is(pubWait.ok, true, "pub materialized");

    const traced = await h.client.trace({ jobKey, concernKeys: [h.concernKey] });
    const concern = traced.concerns[0];
    const attempt = concern.attempts.find((row) => row.attemptToken === idEncoding.encode(attemptToken));
    t.ok(attempt, "trace includes proposed attempt");

    const proposedRat = await h.client.proposeRat({
      concernKey: h.concernKey,
      jobKey,
      organismKey: attempt.organismKey,
      attemptToken,
      cap: "cap/sdk-propose-rat",
      ref: {
        t: "result",
        k: jobKey,
        a: attemptToken
      },
      note: "ratified-by-sdk"
    });
    t.alike(proposedRat, { ok: true, submitted: true, accepted: false, deduped: false });

    const stopRatLoop = h.startHostLoop(25);
    const ratWait = await h.client.waitForMaterialization({
      concernKey: h.concernKey,
      jobKey,
      kind: "rat",
      attemptToken,
      organismKey: attempt.organismKey,
      timeoutMs: 8000,
      intervalMs: 120
    });
    stopRatLoop();
    t.is(ratWait.ok, true, "rat materialized");
  } finally {
    await h.close();
  }
});

test("sdk waitForMaterialization timeout is deterministic", async (t) => {
  const h = await createHarness();
  try {
    const jobKey = await createJob(h.hostBase, "cap/sdk-timeout", { in: "timeout" });
    await h.hostBase.update({ wait: true });
    await h.pump(20);

    const out = await h.client.waitForMaterialization({
      concernKey: h.concernKey,
      jobKey,
      kind: "pub",
      attemptToken: crypto.randomBytes(32),
      timeoutMs: 400,
      intervalMs: 60
    });
    t.is(out.ok, false);
    t.is(out.timeout, true);
    t.is(out.found, false);
  } finally {
    await h.close();
  }
});
