import test from "brittle";
import { spawn } from "child_process";
import path from "path";

import { mkTemp } from "./_helpers/fs.js";

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");
const CLI = path.join(ROOT, "packages", "mesh-operator-cli", "bin", "mesh.js");
const CALL_FOR_RESPONSES_CAP = "cap/concern/call-for-responses/v1";
const RESPONDER_ID = "mesh-v0-2.generic-responder";

test("mesh service exposes health and capabilities without registry or scheduler claims", async (t) => {
  const tmp = mkTemp("mesh-service-health-");
  const svc = await startService(t, tmp.dir);
  try {
    const health = await requestJson(svc.url, "GET", "/health");
    t.is(health.status, 200);
    t.is(health.body.action, "service-health");
    t.is(health.body.serviceState, "running");
    t.ok(health.body.endpoints.includes("POST /concern/setup"));
    assertServiceNonClaims(t, health.body.posture);

    const caps = await requestJson(svc.url, "GET", "/capabilities");
    t.is(caps.status, 200);
    t.ok(caps.body.caps.includes(CALL_FOR_RESPONSES_CAP), "generic cap is advertised");
    t.is(caps.body.registry.globalCapabilityRegistryClaimed, false);
    t.is(caps.body.responder.runOnceOnly, true);
    t.is(caps.body.responder.daemonResponderClaimed, false);
    t.is(caps.body.responder.schedulerClaimed, false);
    assertServiceNonClaims(t, caps.body.posture);
  } finally {
    await stopService(svc);
    tmp.cleanup();
  }
});

test("mesh service concern setup reuses a purpose-scoped concern", async (t) => {
  const tmp = mkTemp("mesh-service-setup-");
  const svc = await startService(t, tmp.dir);
  try {
    const first = await requestJson(svc.url, "POST", "/concern/setup", { purpose: "service-purpose" });
    const second = await requestJson(svc.url, "POST", "/concern/setup", { purpose: "service-purpose" });

    t.is(first.status, 200);
    t.is(first.body.action, "concern-setup");
    t.is(first.body.serviceState, "running");
    t.ok(first.body.concernKey, "concernKey is returned");
    t.ok(first.body.discoveryKey, "discoveryKey is returned");
    t.is(first.body.concernKey, second.body.concernKey, "concern key is stable");
    t.is(first.body.discoveryKey, second.body.discoveryKey, "discovery key is stable");
    t.ok(first.body.configPath.startsWith(tmp.dir), "configPath stays under service root");
    t.ok(first.body.nextServiceCalls.submitJob.includes("/job/submit"));
    t.ok(first.body.posture.nonClaims.includes("does not claim job completion"));
    t.ok(first.body.posture.nonClaims.includes("does not provide a global capability registry"));
  } finally {
    await stopService(svc);
    tmp.cleanup();
  }
});

test("mesh service submits explicit JSON payload and status reads materialized state", async (t) => {
  const tmp = mkTemp("mesh-service-submit-");
  const svc = await startService(t, tmp.dir);
  try {
    const setup = (await requestJson(svc.url, "POST", "/concern/setup", { purpose: "submit-status" })).body;
    const submit = await requestJson(svc.url, "POST", "/job/submit", {
      concernKey: setup.concernKey,
      payload: {
        cap: CALL_FOR_RESPONSES_CAP,
        in: callForResponsesInput()
      }
    });

    t.is(submit.status, 200);
    t.is(submit.body.action, "job-submit");
    t.is(submit.body.concernKey, setup.concernKey);
    t.is(submit.body.cap, CALL_FOR_RESPONSES_CAP);
    t.ok(submit.body.jobKey, "jobKey is returned");
    t.is(submit.body.configPath, setup.configPath);
    t.is(submit.body.materialization.status, "materialized");

    const status = await requestJson(svc.url, "POST", "/job/status", { concernKey: setup.concernKey });
    t.is(status.status, 200);
    t.is(status.body.action, "status");
    t.is(status.body.concernKey, setup.concernKey);
    t.is(status.body.configRefs.operatorCli, setup.configPath);
    t.is(status.body.counts.jobs, 1);
    t.is(status.body.counts.publish, 0);
    t.is(status.body.materialization.source, "materialized concern view");
  } finally {
    await stopService(svc);
    tmp.cleanup();
  }
});

test("mesh service responder run-once emits generic plural response evidence only when invoked", async (t) => {
  const tmp = mkTemp("mesh-service-responder-");
  const svc = await startService(t, tmp.dir);
  try {
    const setup = (await requestJson(svc.url, "POST", "/concern/setup", { purpose: "responder" })).body;
    await requestJson(svc.url, "POST", "/job/submit", {
      concernKey: setup.concernKey,
      payload: {
        cap: CALL_FOR_RESPONSES_CAP,
        in: callForResponsesInput()
      }
    });

    const before = await requestJson(svc.url, "POST", "/job/status", { concernKey: setup.concernKey });
    t.is(before.body.counts.publish, 0, "service does not run a background responder");

    const run = await requestJson(svc.url, "POST", "/responder/run-once", {
      concernKey: setup.concernKey,
      cap: CALL_FOR_RESPONSES_CAP
    });
    t.is(run.status, 200);
    t.is(run.body.action, "responder-run");
    t.is(run.body.state, "handled");
    t.is(run.body.responderId, RESPONDER_ID);
    t.is(run.body.cap, CALL_FOR_RESPONSES_CAP);
    t.is(run.body.configPath, setup.configPath);
    t.is(run.body.responseMode, "plural_response_evidence");
    t.is(run.body.responses.length, 1);
    t.is(run.body.responses[0].responderRef, RESPONDER_ID);
    t.is(run.body.response.actorSelectionClaimed, false);
    t.is(run.body.response.completionClaimed, false);
    t.is(run.body.response.physicalDeviceTruthClaimed, false);
    t.is(run.body.response.globalCapabilityRegistryClaimed, false);
    t.is(run.body.response.meshTruthClaimed, false);
    t.ok(run.body.responseKey, "responseKey is returned");
    t.ok(run.body.receiptKey, "receiptKey is returned");

    const after = await requestJson(svc.url, "POST", "/job/status", { concernKey: setup.concernKey });
    t.is(after.body.counts.jobs, 1);
    t.is(after.body.counts.publish, 1);
    t.is(after.body.responders[RESPONDER_ID].latestByCap[CALL_FOR_RESPONSES_CAP].responsesReturned, 1);
  } finally {
    await stopService(svc);
    tmp.cleanup();
  }
});

test("mesh service blocks unsupported responder caps", async (t) => {
  const tmp = mkTemp("mesh-service-unsupported-");
  const svc = await startService(t, tmp.dir);
  try {
    const setup = (await requestJson(svc.url, "POST", "/concern/setup", { purpose: "unsupported" })).body;
    const res = await requestJson(svc.url, "POST", "/responder/run-once", {
      concernKey: setup.concernKey,
      cap: "cap/test/unsupported"
    });

    t.is(res.status, 400);
    t.is(res.body.ok, false);
    t.ok(res.body.error.includes("unsupported cap"));
    t.alike(res.body.supportedCaps, [CALL_FOR_RESPONSES_CAP]);
    assertServiceNonClaims(t, res.body.posture);
  } finally {
    await stopService(svc);
    tmp.cleanup();
  }
});

async function startService(t, root) {
  const child = spawn(process.execPath, [
    CLI,
    "service",
    "start",
    "--host",
    "127.0.0.1",
    "--port",
    "0",
    "--root",
    root,
    "--json"
  ], {
    cwd: ROOT,
    env: {
      ...process.env,
      OPERATOR_TIMEOUT_MS: "1"
    },
    stdio: ["ignore", "pipe", "pipe"]
  });

  let stdout = "";
  let stderr = "";
  child.stdout.setEncoding("utf8");
  child.stderr.setEncoding("utf8");
  child.stderr.on("data", (chunk) => {
    stderr += chunk;
  });

  const ready = await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`service start timed out: ${stderr}`)), 10_000);
    child.once("exit", (code) => {
      clearTimeout(timer);
      reject(new Error(`service exited during start code=${code}: ${stderr || stdout}`));
    });
    child.stdout.on("data", (chunk) => {
      stdout += chunk;
      const idx = stdout.indexOf("\n");
      if (idx < 0) return;
      clearTimeout(timer);
      try {
        resolve(JSON.parse(stdout.slice(0, idx)));
      } catch (err) {
        reject(err);
      }
    });
  });

  t.is(ready.action, "service-start");
  return { child, url: ready.url, stderr: () => stderr };
}

async function stopService(svc) {
  if (!svc?.child || svc.child.killed) return;
  await new Promise((resolve) => {
    const timer = setTimeout(() => {
      svc.child.kill("SIGKILL");
      resolve();
    }, 2_000);
    svc.child.once("exit", () => {
      clearTimeout(timer);
      resolve();
    });
    svc.child.kill("SIGTERM");
  });
}

async function requestJson(baseUrl, method, pathname, body = undefined) {
  const res = await fetch(`${baseUrl}${pathname}`, {
    method,
    headers: body === undefined ? undefined : { "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body)
  });
  return {
    status: res.status,
    body: await res.json()
  };
}

function callForResponsesInput(overrides = {}) {
  return {
    requestKind: "mesh_concern_call_for_responses",
    profile: "local_layer_need_call",
    needRef: "sample-need:1",
    producer: {
      repo: "sample-adapter",
      surface: "local-layer"
    },
    responseMode: "plural_response_evidence",
    subject: {
      kind: "operator_need",
      summary: "Find local responders for a bounded operator need.",
      constraints: {}
    },
    nonClaimsRequired: [
      "no_actor_selection",
      "no_actor_obligation",
      "no_completion_claim",
      "no_device_truth",
      "no_mesh_truth"
    ],
    operatorRef: "operator/local/1",
    ...overrides
  };
}

function assertServiceNonClaims(t, posture) {
  t.is(posture.globalCapabilityRegistryClaimed, false);
  t.is(posture.discoverySearchClaimed, false);
  t.is(posture.schedulingClaimed, false);
  t.is(posture.actorSelectionClaimed, false);
  t.is(posture.actorObligationClaimed, false);
  t.is(posture.completionClaimed, false);
  t.is(posture.physicalDeviceTruthClaimed, false);
  t.is(posture.meshTruthBeyondMaterializedConcernViewClaimed, false);
  t.is(posture.adjacentRepoAuthorityClaimed, false);
  t.is(posture.hiddenContinuationClaimed, false);
}
