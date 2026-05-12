import test from "brittle";
import { spawnSync } from "child_process";
import fs from "fs";
import path from "path";

import { mkTemp } from "./_helpers/fs.js";

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");
const CLI = path.join(ROOT, "packages", "mesh-operator-cli", "bin", "mesh.js");
const CALL_FOR_RESPONSES_CAP = "cap/concern/call-for-responses/v1";
const ADJACENT_REPO_CAP = ["cap", "platform", "request-review", "v1"].join("/");
const RESPONDER_ID = "mesh-v0-2.generic-responder";

test("mesh responder run --once handles one generic call-for-responses job", (t) => {
  const tmp = mkTemp("mesh-responder-");
  try {
    const setup = runSetup(tmp.dir, "call-for-responses");
    const jobPath = writeJob(tmp.dir, "call.json", CALL_FOR_RESPONSES_CAP, callForResponsesInput());
    const submit = runCli(["job", "submit", "--concern", setup.concernKey, "--json", jobPath, "--no-wait", "--config", setup.configPath]);
    t.is(submit.status, 0, `submit failed: ${submit.stderr || submit.stdout}`);
    const submitJson = parseTrailingJson(submit.stdout);
    t.is(submitJson.cap, CALL_FOR_RESPONSES_CAP);
    t.ok(submitJson.jobKey, "job submit returns pending job key");

    const res = runResponder(setup);
    t.is(res.status, 0, `responder failed: ${res.stderr || res.stdout}`);
    const out = JSON.parse(res.stdout);
    t.is(out.action, "responder-run");
    t.is(out.state, "handled");
    t.is(out.concernKey, setup.concernKey);
    t.is(out.jobKey, submitJson.jobKey);
    t.is(out.cap, CALL_FOR_RESPONSES_CAP);
    t.is(out.requestKind, "mesh_concern_call_for_responses");
    t.is(out.profile, "local_layer_need_call");
    t.is(out.needRef, "sample-need:1");
    t.is(out.producer.repo, "sample-adapter");
    t.is(out.producer.surface, "local-layer");
    t.is(out.responseMode, "plural_response_evidence");
    t.ok(Array.isArray(out.responses), "plural responses are present");
    t.is(out.responses.length, 1);
    t.is(out.responses[0].responderRef, RESPONDER_ID);
    t.is(out.responses[0].eligibility, "eligible");
    t.is(out.responderId, RESPONDER_ID);
    t.is(out.handled, 1);
    t.is(out.response.ok, true);
    assertGenericCallNonClaims(t, out.response);
    t.ok(out.responseKey, "response key is returned");
    t.ok(out.receiptKey, "receipt key is returned");
    t.ok(out.statusBefore.counts.jobs >= 1);
    t.ok(out.statusAfter.counts.publish > out.statusBefore.counts.publish, "status shows publish evidence after responder");

    const status = runCli(["status", "--concern", setup.concernKey, "--config", setup.configPath]);
    t.is(status.status, 0, `status failed: ${status.stderr || status.stdout}`);
    const statusJson = JSON.parse(status.stdout);
    const latest = statusJson.responders[RESPONDER_ID].latestByCap[CALL_FOR_RESPONSES_CAP];
    t.is(statusJson.counts.jobs, 1);
    t.is(statusJson.counts.publish, 1);
    t.is(statusJson.responders[RESPONDER_ID].handled, 1);
    t.is(statusJson.responders[RESPONDER_ID].byCap[CALL_FOR_RESPONSES_CAP], 1);
    t.is(statusJson.responders[RESPONDER_ID].byCapCounts[CALL_FOR_RESPONSES_CAP].handled, 1);
    t.is(latest.jobKey, submitJson.jobKey);
    t.is(latest.responseKey, out.responseKey);
    t.is(latest.responsesReturned, 1);
    t.ok(latest.posture.nonClaims.includes("does not provide a global capability registry"));
  } finally {
    tmp.cleanup();
  }
});

test("mesh setup advertises only generic responder next command", (t) => {
  const tmp = mkTemp("mesh-responder-setup-");
  try {
    const setup = runSetup(tmp.dir, "setup-next-commands");
    const nextCommands = setup.nextCommands;
    t.ok(nextCommands.callForResponsesResponderRunOnceWithConfig, "generic responder command is present");
    t.absent(nextCommands.responderRunOnceWithConfig);
    t.absent(nextCommands.selectorResponderRunOnceWithConfig);
    t.absent(nextCommands.yardLightsSetStateResponderRunOnceWithConfig);
    t.alike(
      Object.keys(nextCommands).filter((key) => key.includes("Responder")),
      ["callForResponsesResponderRunOnceWithConfig"]
    );
  } finally {
    tmp.cleanup();
  }
});

test("mesh responder ignores unsupported job caps and reports no_match", (t) => {
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
    t.is(out.cap, CALL_FOR_RESPONSES_CAP);

    const status = runCli(["status", "--concern", setup.concernKey, "--config", setup.configPath]);
    t.is(status.status, 0, `status failed: ${status.stderr || status.stdout}`);
    const statusJson = JSON.parse(status.stdout);
    t.is(statusJson.counts.jobs, 1);
    t.is(statusJson.counts.publish, 0);
  } finally {
    tmp.cleanup();
  }
});

test("mesh responder blocks unsupported --cap values", (t) => {
  const tmp = mkTemp("mesh-responder-bad-cap-");
  try {
    const setup = runSetup(tmp.dir, "bad-cap");
    for (const cap of ["cap/test/unsupported", ADJACENT_REPO_CAP]) {
      const res = runResponder(setup, cap);
      t.is(res.status, 1, `expected unsupported cap failure: ${res.stderr || res.stdout}`);
      t.ok(String(res.stderr || "").includes("unsupported --cap for generic responder"));
    }
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

    const res = runResponder(setup);
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
    const firstJob = writeJob(tmp.dir, "call-1.json", CALL_FOR_RESPONSES_CAP, callForResponsesInput({ needRef: "sample-need:1" }));
    const secondJob = writeJob(tmp.dir, "call-2.json", CALL_FOR_RESPONSES_CAP, callForResponsesInput({ needRef: "sample-need:2" }));
    t.is(runCli(["job", "submit", "--concern", setup.concernKey, "--json", firstJob, "--no-wait", "--config", setup.configPath]).status, 0);
    t.is(runCli(["job", "submit", "--concern", setup.concernKey, "--json", secondJob, "--no-wait", "--config", setup.configPath]).status, 0);

    const first = runResponder(setup);
    t.is(first.status, 0, `first call-for-responses responder failed: ${first.stderr || first.stdout}`);
    const firstOut = JSON.parse(first.stdout);
    t.is(firstOut.handled, 1);
    t.is(firstOut.skipped, 0);

    const second = runResponder(setup);
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

test("mesh responder handles exactly one matching job per --once invocation", (t) => {
  const tmp = mkTemp("mesh-responder-once-");
  try {
    const setup = runSetup(tmp.dir, "once");
    const firstJob = writeJob(tmp.dir, "call-1.json", CALL_FOR_RESPONSES_CAP, callForResponsesInput({ needRef: "sample-need:1" }));
    const secondJob = writeJob(tmp.dir, "call-2.json", CALL_FOR_RESPONSES_CAP, callForResponsesInput({ needRef: "sample-need:2" }));
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

function runResponder(setup, cap = CALL_FOR_RESPONSES_CAP) {
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

function callForResponsesInput(overrides = {}) {
  const input = {
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
  for (const [key, value] of Object.entries(input)) {
    if (value === undefined) delete input[key];
  }
  return input;
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
