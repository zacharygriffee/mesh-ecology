import test from "brittle";
import { spawnSync } from "child_process";
import fs from "fs";
import path from "path";

import { mkTemp } from "./_helpers/fs.js";

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");
const CLI = path.join(ROOT, "packages", "mesh-operator-cli", "bin", "mesh.js");
const CALL_FOR_RESPONSES_CAP = "cap/concern/call-for-responses/v1";
const HELLO_CAP = "cap/edge/control-panel/hello-status";
const SELECTOR_CAP = "cap/edge/control-panel/selector-intent";
const YARD_LIGHTS_CAP = "cap/edge/control-panel/yard-lights/set-state";
const RESPONDER_ID = "mesh-v0-2.generic-responder";

test("mesh responder run --once handles one hello-status job", (t) => {
  const tmp = mkTemp("mesh-responder-");
  try {
    const setup = runSetup(tmp.dir, "hello-status");
    const helloJob = writeJob(tmp.dir, "hello.json", HELLO_CAP, { hello: "edge" });
    const submit = runCli(["job", "submit", "--concern", setup.concernKey, "--json", helloJob, "--no-wait", "--config", setup.configPath]);
    t.is(submit.status, 0, `submit failed: ${submit.stderr || submit.stdout}`);
    const submitJson = parseTrailingJson(submit.stdout);
    t.is(submitJson.cap, HELLO_CAP);
    t.ok(submitJson.jobKey, "job submit returns pending job key");

    const res = runResponder(setup);
    t.is(res.status, 0, `responder failed: ${res.stderr || res.stdout}`);
    const out = JSON.parse(res.stdout);
    t.is(out.action, "responder-run");
    t.is(out.state, "handled");
    t.is(out.concernKey, setup.concernKey);
    t.is(out.jobKey, submitJson.jobKey);
    t.is(out.cap, HELLO_CAP);
    t.is(out.responderId, RESPONDER_ID);
    t.is(out.handled, 1);
    t.is(out.response.ok, true);
    t.ok(out.responseKey, "response key is returned");
    t.ok(out.receiptKey, "receipt key is returned");
    t.ok(out.statusBefore.counts.jobs >= 1);
    t.ok(out.statusAfter.counts.publish > out.statusBefore.counts.publish, "status shows publish evidence after responder");

    const status = runCli(["status", "--concern", setup.concernKey, "--config", setup.configPath]);
    t.is(status.status, 0, `status failed: ${status.stderr || status.stdout}`);
    const statusJson = JSON.parse(status.stdout);
    t.is(statusJson.counts.jobs, 1);
    t.is(statusJson.counts.publish, 1);
    t.is(statusJson.responders[RESPONDER_ID].handled, 1);
    t.is(statusJson.responders[RESPONDER_ID].latest.jobKey, submitJson.jobKey);
    t.is(statusJson.responders[RESPONDER_ID].latest.responseKey, out.responseKey);
  } finally {
    tmp.cleanup();
  }
});

test("mesh responder ignores unsupported caps and reports no_match", (t) => {
  const tmp = mkTemp("mesh-responder-unsupported-");
  try {
    const setup = runSetup(tmp.dir, "unsupported-cap");
    const jobPath = writeJob(tmp.dir, "unsupported.json", "cap/test/unsupported", { ignored: true });
    const submit = runCli(["job", "submit", "--concern", setup.concernKey, "--json", jobPath, "--no-wait", "--config", setup.configPath]);
    t.is(submit.status, 0, `submit failed: ${submit.stderr || submit.stdout}`);

    const res = runResponder(setup);
    t.is(res.status, 2, `expected no_match exit: ${res.stderr || res.stdout}`);
    const out = JSON.parse(res.stdout);
    t.is(out.state, "no_match");
    t.is(out.handled, 0);
    t.is(out.skipped, 1);
    t.is(out.cap, HELLO_CAP);

    const status = runCli(["status", "--concern", setup.concernKey, "--config", setup.configPath]);
    t.is(status.status, 0, `status failed: ${status.stderr || status.stdout}`);
    const statusJson = JSON.parse(status.stdout);
    t.is(statusJson.counts.jobs, 1);
    t.is(statusJson.counts.publish, 0);
  } finally {
    tmp.cleanup();
  }
});

test("mesh responder blocks unsupported --cap", (t) => {
  const tmp = mkTemp("mesh-responder-bad-cap-");
  try {
    const setup = runSetup(tmp.dir, "bad-cap");
    const res = runResponder(setup, "cap/test/unsupported");
    t.is(res.status, 1, `expected unsupported cap failure: ${res.stderr || res.stdout}`);
    t.ok(String(res.stderr || "").includes("unsupported --cap for generic responder"));
  } finally {
    tmp.cleanup();
  }
});

test("mesh responder reports clear no_match when no job exists", (t) => {
  const tmp = mkTemp("mesh-responder-empty-");
  try {
    const setup = runSetup(tmp.dir, "empty");
    const res = runResponder(setup);
    t.is(res.status, 2, `expected no_match exit: ${res.stderr || res.stdout}`);
    const out = JSON.parse(res.stdout);
    t.is(out.ok, false);
    t.is(out.state, "no_match");
    t.is(out.reason, "no matching pending job");
    t.is(out.concernKey, setup.concernKey);
    t.is(out.responderId, RESPONDER_ID);
    t.is(out.handled, 0);
    t.is(out.skipped, 0);
    t.is(out.statusBefore.counts.jobs, 0);
    t.is(out.statusAfter.counts.publish, 0);
  } finally {
    tmp.cleanup();
  }
});

test("mesh selector-intent responder emits bounded plural evidence", (t) => {
  const tmp = mkTemp("mesh-responder-selector-");
  try {
    const setup = runSetup(tmp.dir, "selector-intent");
    const selectorJob = writeJob(tmp.dir, "selector.json", SELECTOR_CAP, selectorInput());
    const submit = runCli(["job", "submit", "--concern", setup.concernKey, "--json", selectorJob, "--no-wait", "--config", setup.configPath]);
    t.is(submit.status, 0, `submit failed: ${submit.stderr || submit.stdout}`);
    const submitJson = parseTrailingJson(submit.stdout);
    t.is(submitJson.cap, SELECTOR_CAP);

    const res = runResponder(setup, SELECTOR_CAP);
    t.is(res.status, 0, `selector responder failed: ${res.stderr || res.stdout}`);
    const out = JSON.parse(res.stdout);
    t.is(out.state, "handled");
    t.is(out.cap, SELECTOR_CAP);
    t.is(out.jobKey, submitJson.jobKey);
    t.is(out.actorGroup, "yard_lights");
    t.is(out.selectorKind, "all_in_actor_group");
    t.is(out.expectedResultMode, "plural_responses");
    t.is(out.responseMode, "plural_selector_response");
    t.ok(Array.isArray(out.responses), "top-level plural responses are present");
    t.is(out.responses.length, 2);
    t.is(out.responses[0].actorId, "yard-light-alpha");
    t.is(out.responses[0].eligibility, "eligible");
    t.is(out.handledBy, RESPONDER_ID);
    t.is(out.response.responderId, RESPONDER_ID);
    t.ok(out.responseKey, "response key is returned");
    t.ok(out.receiptKey, "receipt key is returned");
    t.ok(out.posture.nonClaims.includes("does not select actors"));
    t.ok(out.posture.nonClaims.includes("does not assign actor obligation"));
    t.ok(out.posture.nonClaims.includes("does not claim canonical selection"));

    const status = runCli(["status", "--concern", setup.concernKey, "--config", setup.configPath]);
    t.is(status.status, 0, `status failed: ${status.stderr || status.stdout}`);
    const statusJson = JSON.parse(status.stdout);
    t.is(statusJson.counts.jobs, 1);
    t.is(statusJson.counts.publish, 1);
    const latest = statusJson.responders[RESPONDER_ID].latest;
    t.is(latest.cap, SELECTOR_CAP);
    t.is(latest.jobKey, submitJson.jobKey);
    t.is(latest.responseKey, out.responseKey);
    t.is(latest.actorGroup, "yard_lights");
    t.is(latest.responseMode, "plural_selector_response");
    t.is(latest.responsesReturned, 2);
    t.ok(latest.posture.nonClaims.includes("does not claim completion"));
  } finally {
    tmp.cleanup();
  }
});

test("mesh selector-intent responder skips already-handled selector jobs", (t) => {
  const tmp = mkTemp("mesh-responder-selector-once-");
  try {
    const setup = runSetup(tmp.dir, "selector-once");
    const firstJob = writeJob(tmp.dir, "selector-1.json", SELECTOR_CAP, selectorInput());
    const secondJob = writeJob(tmp.dir, "selector-2.json", SELECTOR_CAP, selectorInput({ desiredState: { power: "off" } }));
    t.is(runCli(["job", "submit", "--concern", setup.concernKey, "--json", firstJob, "--no-wait", "--config", setup.configPath]).status, 0);
    t.is(runCli(["job", "submit", "--concern", setup.concernKey, "--json", secondJob, "--no-wait", "--config", setup.configPath]).status, 0);

    const first = runResponder(setup, SELECTOR_CAP);
    t.is(first.status, 0, `first selector responder failed: ${first.stderr || first.stdout}`);
    const firstOut = JSON.parse(first.stdout);
    t.is(firstOut.handled, 1);
    t.is(firstOut.skipped, 0);
    t.is(firstOut.statusAfter.counts.publish, 1);

    const second = runResponder(setup, SELECTOR_CAP);
    t.is(second.status, 0, `second selector responder failed: ${second.stderr || second.stdout}`);
    const secondOut = JSON.parse(second.stdout);
    t.is(secondOut.handled, 1);
    t.is(secondOut.skipped, 1);
    t.is(secondOut.statusAfter.counts.publish, 2);
    t.ok(secondOut.jobKey !== firstOut.jobKey, "second run handles the next selector job");
  } finally {
    tmp.cleanup();
  }
});

test("mesh call-for-responses responder emits generic plural response evidence", (t) => {
  const tmp = mkTemp("mesh-responder-call-for-responses-");
  try {
    const setup = runSetup(tmp.dir, "call-for-responses");
    const jobPath = writeJob(tmp.dir, "call.json", CALL_FOR_RESPONSES_CAP, callForResponsesInput());
    const submit = runCli(["job", "submit", "--concern", setup.concernKey, "--json", jobPath, "--no-wait", "--config", setup.configPath]);
    t.is(submit.status, 0, `submit failed: ${submit.stderr || submit.stdout}`);
    const submitJson = parseTrailingJson(submit.stdout);
    t.is(submitJson.cap, CALL_FOR_RESPONSES_CAP);

    const res = runResponder(setup, CALL_FOR_RESPONSES_CAP);
    t.is(res.status, 0, `call-for-responses responder failed: ${res.stderr || res.stdout}`);
    const out = JSON.parse(res.stdout);
    t.is(out.state, "handled");
    t.is(out.cap, CALL_FOR_RESPONSES_CAP);
    t.is(out.jobKey, submitJson.jobKey);
    t.is(out.requestKind, "mesh_concern_call_for_responses");
    t.is(out.profile, "edge_local_layer_need_call");
    t.is(out.needRef, "edge-local-need:1");
    t.is(out.producer.repo, "edge");
    t.is(out.producer.surface, "local-layer");
    t.is(out.responseMode, "plural_response_evidence");
    t.ok(Array.isArray(out.responses), "plural responses are present");
    t.is(out.responses.length, 1);
    t.is(out.responses[0].responderRef, RESPONDER_ID);
    t.is(out.responses[0].eligibility, "eligible");
    assertGenericCallNonClaims(t, out.response);
    t.is(out.response.ok, true);
    t.is(out.response.globalCapabilityRegistryClaimed, false);
    t.is(out.response.discoverySearchClaimed, false);
    t.is(out.response.schedulingClaimed, false);
    t.is(out.response.shellCommandExecuted, false);
    t.is(out.response.deviceMutationAttempted, false);

    const status = runCli(["status", "--concern", setup.concernKey, "--config", setup.configPath]);
    t.is(status.status, 0, `status failed: ${status.stderr || status.stdout}`);
    const statusJson = JSON.parse(status.stdout);
    const latest = statusJson.responders[RESPONDER_ID].latestByCap[CALL_FOR_RESPONSES_CAP];
    t.is(statusJson.responders[RESPONDER_ID].byCap[CALL_FOR_RESPONSES_CAP], 1);
    t.is(statusJson.responders[RESPONDER_ID].byCapCounts[CALL_FOR_RESPONSES_CAP].handled, 1);
    t.is(latest.cap, CALL_FOR_RESPONSES_CAP);
    t.is(latest.profile, "edge_local_layer_need_call");
    t.is(latest.needRef, "edge-local-need:1");
    t.is(latest.responseMode, "plural_response_evidence");
    t.is(latest.responsesReturned, 1);
    t.ok(latest.posture.nonClaims.includes("does not provide a global capability registry"));
  } finally {
    tmp.cleanup();
  }
});

test("mesh call-for-responses responder emits rejected evidence for invalid or registry-like payloads", (t) => {
  const tmp = mkTemp("mesh-responder-call-for-responses-invalid-");
  try {
    const setup = runSetup(tmp.dir, "call-for-responses-invalid");
    const invalid = writeJob(tmp.dir, "call-invalid.json", CALL_FOR_RESPONSES_CAP, callForResponsesInput({
      needRef: undefined,
      subject: {
        kind: "capability_registry",
        summary: "global capability registry with completion proof",
        constraints: { scheduler: "select actor winner" }
      },
      nonClaimsRequired: ["no_actor_selection"]
    }));
    t.is(runCli(["job", "submit", "--concern", setup.concernKey, "--json", invalid, "--no-wait", "--config", setup.configPath]).status, 0);

    const res = runResponder(setup, CALL_FOR_RESPONSES_CAP);
    t.is(res.status, 0, `invalid call-for-responses responder failed: ${res.stderr || res.stdout}`);
    const out = JSON.parse(res.stdout);
    t.is(out.state, "handled");
    t.is(out.response.ok, false);
    t.is(out.response.responseMode, "plural_response_evidence");
    t.ok(out.response.reasonCodes.includes("missing_need_ref"));
    t.ok(out.response.reasonCodes.includes("missing_required_non_claims"));
    t.ok(out.response.reasonCodes.includes("forbidden_claim"));
    assertGenericCallNonClaims(t, out.response);
    t.is(out.response.completionClaimed, false);
    t.is(out.response.meshTruthClaimed, false);
    t.is(out.response.globalCapabilityRegistryClaimed, false);

    const status = runCli(["status", "--concern", setup.concernKey, "--config", setup.configPath]);
    t.is(status.status, 0, `status failed: ${status.stderr || status.stdout}`);
    const latest = JSON.parse(status.stdout).responders[RESPONDER_ID].latestByCap[CALL_FOR_RESPONSES_CAP];
    t.ok(Array.isArray(latest.reasonCodes));
    t.ok(latest.reasonCodes.includes("forbidden_claim"));
  } finally {
    tmp.cleanup();
  }
});

test("mesh call-for-responses responder skips already-handled generic jobs", (t) => {
  const tmp = mkTemp("mesh-responder-call-for-responses-once-");
  try {
    const setup = runSetup(tmp.dir, "call-for-responses-once");
    const firstJob = writeJob(tmp.dir, "call-1.json", CALL_FOR_RESPONSES_CAP, callForResponsesInput({ needRef: "edge-local-need:1" }));
    const secondJob = writeJob(tmp.dir, "call-2.json", CALL_FOR_RESPONSES_CAP, callForResponsesInput({ needRef: "edge-local-need:2" }));
    t.is(runCli(["job", "submit", "--concern", setup.concernKey, "--json", firstJob, "--no-wait", "--config", setup.configPath]).status, 0);
    t.is(runCli(["job", "submit", "--concern", setup.concernKey, "--json", secondJob, "--no-wait", "--config", setup.configPath]).status, 0);

    const first = runResponder(setup, CALL_FOR_RESPONSES_CAP);
    t.is(first.status, 0, `first call-for-responses responder failed: ${first.stderr || first.stdout}`);
    const firstOut = JSON.parse(first.stdout);
    t.is(firstOut.handled, 1);
    t.is(firstOut.skipped, 0);

    const second = runResponder(setup, CALL_FOR_RESPONSES_CAP);
    t.is(second.status, 0, `second call-for-responses responder failed: ${second.stderr || second.stdout}`);
    const secondOut = JSON.parse(second.stdout);
    t.is(secondOut.handled, 1);
    t.is(secondOut.skipped, 1);
    t.ok(secondOut.jobKey !== firstOut.jobKey, "second run handles the next generic call job");
  } finally {
    tmp.cleanup();
  }
});

test("mesh call-for-responses support does not change discovery, concern apply, or opcode surfaces", (t) => {
  const discoverySource = fs.readFileSync(path.join(ROOT, "src", "discovery.js"), "utf8");
  const applySource = fs.readFileSync(path.join(ROOT, "src", "concern", "apply.js"), "utf8");
  const keySource = fs.readFileSync(path.join(ROOT, "src", "concern", "keys.js"), "utf8");

  t.is(discoverySource.includes(CALL_FOR_RESPONSES_CAP), false, "discovery remains unaware of generic responder cap");
  t.is(applySource.includes(CALL_FOR_RESPONSES_CAP), false, "concern apply remains cap-agnostic");
  t.is(keySource.includes(CALL_FOR_RESPONSES_CAP), false, "no opcode/keyspace entry added for generic responder cap");
});

test("mesh yard-lights set-state cap accepts job submit and emits admitted evidence", (t) => {
  const tmp = mkTemp("mesh-responder-yard-lights-");
  try {
    const setup = runSetup(tmp.dir, "yard-lights-set-state");
    const jobPath = writeJob(tmp.dir, "yard-lights.json", YARD_LIGHTS_CAP, yardLightsInput());
    const submit = runCli(["job", "submit", "--concern", setup.concernKey, "--json", jobPath, "--no-wait", "--config", setup.configPath]);
    t.is(submit.status, 0, `submit failed: ${submit.stderr || submit.stdout}`);
    const submitJson = parseTrailingJson(submit.stdout);
    t.is(submitJson.cap, YARD_LIGHTS_CAP);
    t.ok(submitJson.jobKey, "job submit returns pending job key");

    const res = runResponder(setup, YARD_LIGHTS_CAP);
    t.is(res.status, 0, `yard-lights responder failed: ${res.stderr || res.stdout}`);
    const out = JSON.parse(res.stdout);
    t.is(out.state, "handled");
    t.is(out.cap, YARD_LIGHTS_CAP);
    t.is(out.jobKey, submitJson.jobKey);
    t.is(out.admissionState, "admitted");
    t.is(out.responseMode, "ratified_control_request_evidence");
    t.is(out.requestId, "yard-lights-request-1");
    t.is(out.actorGroup, "yard_lights");
    t.is(out.selectorKind, "all_in_actor_group");
    t.is(out.requestedState, "on");
    t.is(out.sourceRatificationRef, "rat/source/1");
    t.is(out.operatorRef, "operator/local/1");
    assertYardLightsNonClaims(t, out.response);
    t.is(out.response.ok, true);
    t.is(out.response.admissionState, "admitted");
    t.is(out.response.physicalDeviceTruthClaimed, false);
    t.is(out.response.jobCompletionClaimed, false);
    t.is(out.response.projectCompletionClaimed, false);
    t.is(out.response.edgeAuthorityClaimed, false);
    t.is(out.response.meshTruthClaimed, false);
    t.is(out.response.shellCommandExecuted, false);
    t.is(out.response.deviceMutationAttempted, false);
    t.is(out.response.networkSideEffectAttempted, false);

    const status = runCli(["status", "--concern", setup.concernKey, "--config", setup.configPath]);
    t.is(status.status, 0, `status failed: ${status.stderr || status.stdout}`);
    const statusJson = JSON.parse(status.stdout);
    const responder = statusJson.responders[RESPONDER_ID];
    t.is(responder.handled, 1);
    t.is(responder.byCap[YARD_LIGHTS_CAP], 1);
    t.is(responder.byCapCounts[YARD_LIGHTS_CAP].handled, 1);
    t.is(responder.byCapCounts[YARD_LIGHTS_CAP].skipped, 0);
    t.is(responder.latestByCap[YARD_LIGHTS_CAP].cap, YARD_LIGHTS_CAP);
    t.is(responder.latestByCap[YARD_LIGHTS_CAP].admissionState, "admitted");
    t.is(responder.latestByCap[YARD_LIGHTS_CAP].response.requestId, "yard-lights-request-1");
  } finally {
    tmp.cleanup();
  }
});

test("mesh yard-lights set-state responder emits rejected evidence for invalid payloads", (t) => {
  const tmp = mkTemp("mesh-responder-yard-lights-rejected-");
  try {
    const setup = runSetup(tmp.dir, "yard-lights-rejected");
    const missingRat = writeJob(tmp.dir, "yard-lights-missing-rat.json", YARD_LIGHTS_CAP, yardLightsInput({ sourceRatificationRef: undefined, requestId: "missing-rat" }));
    const invalidState = writeJob(tmp.dir, "yard-lights-invalid-state.json", YARD_LIGHTS_CAP, yardLightsInput({ requestedState: "blink", requestId: "invalid-state" }));
    const invalidSelector = writeJob(tmp.dir, "yard-lights-invalid-selector.json", YARD_LIGHTS_CAP, yardLightsInput({ selectorKind: "shell_command", requestId: "invalid-selector" }));
    t.is(runCli(["job", "submit", "--concern", setup.concernKey, "--json", missingRat, "--no-wait", "--config", setup.configPath]).status, 0);
    t.is(runCli(["job", "submit", "--concern", setup.concernKey, "--json", invalidState, "--no-wait", "--config", setup.configPath]).status, 0);
    t.is(runCli(["job", "submit", "--concern", setup.concernKey, "--json", invalidSelector, "--no-wait", "--config", setup.configPath]).status, 0);

    const handled = [
      runResponder(setup, YARD_LIGHTS_CAP),
      runResponder(setup, YARD_LIGHTS_CAP),
      runResponder(setup, YARD_LIGHTS_CAP)
    ].map((res) => {
      t.is(res.status, 0, `yard-lights rejection responder failed: ${res.stderr || res.stdout}`);
      return JSON.parse(res.stdout);
    });
    const allReasonCodes = new Set();
    for (const out of handled) {
      t.is(out.response.ok, false);
      t.is(out.response.admissionState, "rejected");
      for (const code of out.response.reasonCodes) allReasonCodes.add(code);
      assertYardLightsNonClaims(t, out.response);
    }
    t.ok(allReasonCodes.has("missing_source_ratification_ref"));
    t.ok(allReasonCodes.has("invalid_requested_state"));
    t.ok(allReasonCodes.has("invalid_actor_selector"));

    const status = runCli(["status", "--concern", setup.concernKey, "--config", setup.configPath]);
    t.is(status.status, 0, `status failed: ${status.stderr || status.stdout}`);
    const responder = JSON.parse(status.stdout).responders[RESPONDER_ID];
    t.is(responder.byCap[YARD_LIGHTS_CAP], 3);
    t.is(responder.byCapCounts[YARD_LIGHTS_CAP].handled, 3);
    t.is(responder.latestByCap[YARD_LIGHTS_CAP].admissionState, "rejected");
    t.ok(Array.isArray(responder.latestByCap[YARD_LIGHTS_CAP].reasonCodes));
  } finally {
    tmp.cleanup();
  }
});

test("mesh responder handles exactly one matching job per --once invocation", (t) => {
  const tmp = mkTemp("mesh-responder-once-");
  try {
    const setup = runSetup(tmp.dir, "once");
    const firstJob = writeJob(tmp.dir, "hello-1.json", HELLO_CAP, { n: 1 });
    const secondJob = writeJob(tmp.dir, "hello-2.json", HELLO_CAP, { n: 2 });
    t.is(runCli(["job", "submit", "--concern", setup.concernKey, "--json", firstJob, "--no-wait", "--config", setup.configPath]).status, 0);
    t.is(runCli(["job", "submit", "--concern", setup.concernKey, "--json", secondJob, "--no-wait", "--config", setup.configPath]).status, 0);

    const first = runResponder(setup);
    t.is(first.status, 0, `first responder failed: ${first.stderr || first.stdout}`);
    const firstOut = JSON.parse(first.stdout);
    t.is(firstOut.handled, 1);
    t.is(firstOut.statusAfter.counts.publish, 1);

    const statusAfterFirst = JSON.parse(runCli(["status", "--concern", setup.concernKey, "--config", setup.configPath]).stdout);
    t.is(statusAfterFirst.counts.jobs, 2);
    t.is(statusAfterFirst.counts.publish, 1, "--once does not keep running");

    const second = runResponder(setup);
    t.is(second.status, 0, `second responder failed: ${second.stderr || second.stdout}`);
    const secondOut = JSON.parse(second.stdout);
    t.is(secondOut.handled, 1);
    t.is(secondOut.skipped, 1, "already-handled job is skipped on second invocation");
    t.is(secondOut.statusAfter.counts.publish, 2);
  } finally {
    tmp.cleanup();
  }
});

function runSetup(root, purpose) {
  const res = runCli(["concern", "setup", "--purpose", purpose, "--root", root, "--json"]);
  if (res.status !== 0) {
    throw new Error(`setup failed: ${res.stderr || res.stdout}`);
  }
  return JSON.parse(res.stdout);
}

function runResponder(setup, cap = HELLO_CAP) {
  return runCli([
    "responder",
    "run",
    "--concern",
    setup.concernKey,
    "--config",
    setup.configPath,
    "--cap",
    cap,
    "--once",
    "--json"
  ]);
}

function runCli(args) {
  return spawnSync(process.execPath, [CLI, ...args], {
    cwd: ROOT,
    env: {
      ...process.env,
      OPERATOR_TIMEOUT_MS: "1"
    },
    encoding: "utf8"
  });
}

function writeJob(dir, name, cap, input) {
  const file = path.join(dir, name);
  fs.writeFileSync(file, JSON.stringify({ cap, in: input }));
  return file;
}

function selectorInput(overrides = {}) {
  return {
    requestKind: "mesh_concern_selector_intent",
    actorGroup: "yard_lights",
    selectorKind: "all_in_actor_group",
    desiredState: { power: "on" },
    expectedResultMode: "plural_responses",
    ...overrides
  };
}

function callForResponsesInput(overrides = {}) {
  const input = {
    requestKind: "mesh_concern_call_for_responses",
    profile: "edge_local_layer_need_call",
    needRef: "edge-local-need:1",
    producer: {
      repo: "edge",
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
  for (const [key, value] of Object.entries(input)) {
    if (value === undefined) delete input[key];
  }
  return input;
}

function yardLightsInput(overrides = {}) {
  const input = {
    actorGroup: "yard_lights",
    selectorKind: "all_in_actor_group",
    requestedState: "on",
    sourceRatificationRef: "rat/source/1",
    operatorRef: "operator/local/1",
    requestId: "yard-lights-request-1",
    ...overrides
  };
  for (const [key, value] of Object.entries(input)) {
    if (value === undefined) delete input[key];
  }
  return input;
}

function assertYardLightsNonClaims(t, response) {
  t.is(response.physicalDeviceTruthClaimed, false);
  t.is(response.jobCompletionClaimed, false);
  t.is(response.projectCompletionClaimed, false);
  t.is(response.edgeAuthorityClaimed, false);
  t.is(response.meshTruthClaimed, false);
  t.is(response.deviceMutationAttempted, false);
  t.is(response.networkSideEffectAttempted, false);
  t.is(response.shellCommandExecuted, false);
  t.ok(response.posture.nonClaims.includes("does not claim physical device truth"));
  t.ok(response.posture.nonClaims.includes("does not claim Edge authority"));
  t.ok(response.posture.nonClaims.includes("does not mutate devices"));
  t.ok(response.posture.nonClaims.includes("does not execute shell commands"));
}

function assertGenericCallNonClaims(t, response) {
  t.is(response.actorSelectionClaimed, false);
  t.is(response.actorObligationClaimed, false);
  t.is(response.completionClaimed, false);
  t.is(response.physicalDeviceTruthClaimed, false);
  t.is(response.meshTruthClaimed, false);
  t.is(response.adjacentRepoTruthClaimed, false);
  t.is(response.globalCapabilityRegistryClaimed, false);
  t.is(response.discoverySearchClaimed, false);
  t.is(response.schedulingClaimed, false);
  t.is(response.deviceMutationAttempted, false);
  t.is(response.networkSideEffectAttempted, false);
  t.is(response.shellCommandExecuted, false);
  t.ok(response.posture.nonClaims.includes("does not select actors"));
  t.ok(response.posture.nonClaims.includes("does not assign actor obligation"));
  t.ok(response.posture.nonClaims.includes("does not claim completion"));
  t.ok(response.posture.nonClaims.includes("does not claim physical device truth"));
  t.ok(response.posture.nonClaims.includes("does not claim Mesh truth"));
  t.ok(response.posture.nonClaims.includes("does not provide a global capability registry"));
  t.ok(response.posture.nonClaims.includes("does not schedule work"));
  t.ok(response.posture.nonClaims.includes("does not execute shell commands"));
}

function parseTrailingJson(stdout) {
  const text = String(stdout || "");
  const start = text.indexOf("{");
  if (start < 0) throw new Error(`no JSON object in stdout: ${text}`);
  return JSON.parse(text.slice(start));
}
