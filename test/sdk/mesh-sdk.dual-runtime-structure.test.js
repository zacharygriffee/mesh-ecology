import test from "brittle";
import path from "path";
import { spawnSync } from "child_process";
import { pathToFileURL } from "url";

const ROOT = process.cwd();

test("mesh-sdk bare entry imports without throwing", async (t) => {
  const bareEntry = path.resolve(ROOT, "packages/mesh-sdk/src/entry/bare.js");
  const mod = await import(pathToFileURL(bareEntry).href);
  t.is(typeof mod.createMeshClient, "function");
});

test("mesh-sdk bare import graph guard passes", (t) => {
  const script = path.resolve(ROOT, "packages/mesh-sdk/scripts/check-bare-import-graph.js");
  const result = spawnSync("node", [script], { encoding: "utf8" });
  if (result.status !== 0) {
    t.fail(`guard failed\nstdout:\n${result.stdout || ""}\nstderr:\n${result.stderr || ""}`);
    return;
  }
  t.pass("guard passed");
});

test("mesh-sdk bare e2e import graph guard passes", (t) => {
  const script = path.resolve(ROOT, "packages/mesh-sdk/scripts/check-bare-e2e-import-graph.js");
  const result = spawnSync("node", [script], { encoding: "utf8" });
  if (result.status !== 0) {
    t.fail(`e2e guard failed\nstdout:\n${result.stdout || ""}\nstderr:\n${result.stderr || ""}`);
    return;
  }
  t.pass("e2e guard passed");
});

test("mesh-sdk node exports smoke passes", (t) => {
  const script = path.resolve(ROOT, "packages/mesh-sdk/scripts/smoke-node-exports.js");
  const result = spawnSync("node", [script], {
    cwd: path.resolve(ROOT, "packages/mesh-sdk"),
    encoding: "utf8"
  });
  if (result.status !== 0) {
    t.fail(`node exports smoke failed\nstdout:\n${result.stdout || ""}\nstderr:\n${result.stderr || ""}`);
    return;
  }
  t.pass("node exports smoke passed");
});

test("mesh-sdk conformance module passes", (t) => {
  const script = path.resolve(ROOT, "packages/mesh-sdk/test/conformance.test.js");
  const result = spawnSync("node", [script], {
    cwd: path.resolve(ROOT, "packages/mesh-sdk"),
    encoding: "utf8"
  });
  if (result.status !== 0) {
    t.fail(`conformance failed\nstdout:\n${result.stdout || ""}\nstderr:\n${result.stderr || ""}`);
    return;
  }
  t.pass("conformance passed");
});
