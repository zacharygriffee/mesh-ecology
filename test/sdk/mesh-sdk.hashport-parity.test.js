import test from "brittle";
import path from "path";
import { spawnSync } from "child_process";

const ROOT = process.cwd();

test("mesh-sdk hashport parity between node and bare entries", (t) => {
  const packageRoot = path.resolve(ROOT, "packages/mesh-sdk");
  const script = path.resolve(packageRoot, "test/hashport.parity.test.js");
  const result = spawnSync("node", [script], {
    cwd: packageRoot,
    encoding: "utf8"
  });

  if (result.status !== 0) {
    t.fail(`hashport parity failed\nstdout:\n${result.stdout || ""}\nstderr:\n${result.stderr || ""}`);
    return;
  }

  t.pass("hashport parity passed");
});

