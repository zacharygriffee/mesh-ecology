import test from "brittle";
import { spawnSync } from "child_process";
import fs from "fs";
import path from "path";

import { mkTemp } from "./_helpers/fs.js";

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");
const CLI = path.join(ROOT, "packages", "mesh-operator-cli", "bin", "mesh.js");
const HELLO_CAP = "cap/edge/control-panel/hello-status";
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

function runResponder(setup) {
  return runCli([
    "responder",
    "run",
    "--concern",
    setup.concernKey,
    "--config",
    setup.configPath,
    "--cap",
    HELLO_CAP,
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

function parseTrailingJson(stdout) {
  const text = String(stdout || "");
  const start = text.indexOf("{");
  if (start < 0) throw new Error(`no JSON object in stdout: ${text}`);
  return JSON.parse(text.slice(start));
}
