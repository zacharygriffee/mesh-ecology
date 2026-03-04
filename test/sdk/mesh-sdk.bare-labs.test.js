import test from "brittle";
import { spawnSync } from "child_process";

const ROOT = process.cwd();

function runBareLabs() {
  return spawnSync("npm", ["--prefix", "packages/mesh-sdk", "run", "test:bare-labs"], {
    cwd: ROOT,
    encoding: "utf8"
  });
}

test("mesh-sdk bare labs (opt-in)", (t) => {
  if (process.env.MESH_SDK_RUN_BARE !== "1") {
    t.pass("skipped: set MESH_SDK_RUN_BARE=1 to run bare conformance labs");
    return;
  }

  const result = runBareLabs();
  if (result.error) {
    t.fail(`failed to spawn bare labs: ${result.error.message}`);
    return;
  }
  if (result.status !== 0) {
    t.fail(`bare labs failed\nstdout:\n${result.stdout || ""}\nstderr:\n${result.stderr || ""}`);
    return;
  }

  t.pass("bare labs passed");
});
