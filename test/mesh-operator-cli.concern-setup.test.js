import test from "brittle";
import { spawnSync } from "child_process";
import fs from "fs";
import path from "path";

import { mkTemp } from "./_helpers/fs.js";

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");
const CLI = path.join(ROOT, "packages", "mesh-operator-cli", "bin", "mesh.js");

test("mesh concern setup creates persistent concern JSON and is idempotent", (t) => {
  const tmp = mkTemp("mesh-concern-setup-");
  try {
    const first = runSetup(tmp.dir, "local-layer-test");
    const second = runSetup(tmp.dir, "local-layer-test");

    t.is(first.purpose, "local-layer-test");
    t.is(first.action, "concern-setup");
    t.ok(first.concernKey, "concernKey is returned");
    t.ok(first.discoveryKey, "discoveryKey is returned");
    t.is(first.concernKey, second.concernKey, "concernKey is stable for same purpose/root");
    t.is(first.discoveryKey, second.discoveryKey, "discoveryKey is stable for same purpose/root");
    t.is(first.concernStore.path, second.concernStore.path, "concern store path is stable");
    t.ok(fs.existsSync(first.operatorStore.path), "operator store exists");
    t.ok(fs.existsSync(first.configPath), "config file exists");
    t.ok(first.nextCommands.submitJob.includes("job submit"), "submit next command is returned");
    t.ok(first.nextCommands.status.includes("status --concern"), "status next command is returned");
    t.ok(
      first.posture.nonClaims.some((claim) => claim.includes("does not claim job completion")),
      "non-claim posture is explicit"
    );
    t.alike(first.status.counts, { jobs: 0, publish: 0, ratify: 0 });
  } finally {
    tmp.cleanup();
  }
});

test("mesh concern setup concernKey works with existing status and job submit", (t) => {
  const tmp = mkTemp("mesh-concern-setup-existing-");
  try {
    const setup = runSetup(tmp.dir, "submit-status-test");
    const env = {
      ...process.env,
      CORESTORE_DIR: setup.operatorStore.path,
      OPERATOR_TIMEOUT_MS: "1"
    };

    const status = spawnSync(process.execPath, [CLI, "status", "--concern", setup.concernKey], {
      cwd: ROOT,
      env,
      encoding: "utf8"
    });
    t.is(status.status, 0, `status failed: ${status.stderr || status.stdout}`);
    const statusJson = JSON.parse(status.stdout);
    t.is(statusJson.action, "status");
    t.is(statusJson.concern, setup.concernKey);

    const jobPath = path.join(tmp.dir, "job.json");
    fs.writeFileSync(jobPath, JSON.stringify({
      cap: "cap/test/local-setup-submit",
      in: { bounded: true }
    }));

    const submit = spawnSync(
      process.execPath,
      [CLI, "job", "submit", "--concern", setup.concernKey, "--json", jobPath, "--no-wait"],
      {
        cwd: ROOT,
        env,
        encoding: "utf8"
      }
    );
    t.is(submit.status, 0, `submit failed: ${submit.stderr || submit.stdout}`);
    const submitJson = parseTrailingJson(submit.stdout);
    t.is(submitJson.action, "job-submit");
    t.is(submitJson.concern, setup.concernKey);
    t.ok(submitJson.jobKey, "job submit returned a job key");
  } finally {
    tmp.cleanup();
  }
});

function runSetup(root, purpose) {
  const res = spawnSync(
    process.execPath,
    [CLI, "concern", "setup", "--purpose", purpose, "--root", root, "--json"],
    {
      cwd: ROOT,
      env: {
        ...process.env,
        OPERATOR_TIMEOUT_MS: "1"
      },
      encoding: "utf8"
    }
  );
  if (res.status !== 0) {
    throw new Error(`setup failed: ${res.stderr || res.stdout}`);
  }
  return JSON.parse(res.stdout);
}

function parseTrailingJson(stdout) {
  const text = String(stdout || "");
  const start = text.indexOf("{");
  if (start < 0) throw new Error(`no JSON object in stdout: ${text}`);
  return JSON.parse(text.slice(start));
}
