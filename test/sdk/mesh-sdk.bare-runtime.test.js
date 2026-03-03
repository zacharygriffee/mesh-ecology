import test from "brittle";
import path from "path";
import { spawnSync } from "child_process";

const ROOT = process.cwd();

function runBareSmoke() {
  const packageRoot = path.resolve(ROOT, "packages/mesh-sdk");
  const script = path.resolve(packageRoot, "test/bare-runtime.smoke.js");
  return spawnSync("bare", [script], {
    cwd: packageRoot,
    encoding: "utf8"
  });
}

test("mesh-sdk bare runtime smoke (opt-in)", (t) => {
  if (process.env.MESH_SDK_RUN_BARE !== "1") {
    t.pass("skipped: set MESH_SDK_RUN_BARE=1 to run real bare runtime smoke");
    return;
  }

  const result = runBareSmoke();
  if (result.error) {
    t.fail(`failed to spawn bare: ${result.error.message}`);
    return;
  }
  if (result.status !== 0) {
    t.fail(`bare smoke failed\nstdout:\n${result.stdout || ""}\nstderr:\n${result.stderr || ""}`);
    return;
  }

  t.pass("bare runtime smoke passed");
});
