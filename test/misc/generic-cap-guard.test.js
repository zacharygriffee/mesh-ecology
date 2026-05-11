import test from "brittle";
import { spawnSync } from "child_process";
import path from "path";

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..", "..");
const SCRIPT = path.join(ROOT, "scripts", "check-generic-caps.js");

test("generic cap guard allows existing legacy edge caps but blocks new repo-specific caps", (t) => {
  const ok = spawnSync(process.execPath, [SCRIPT], {
    cwd: ROOT,
    encoding: "utf8"
  });
  t.is(ok.status, 0, `guard should pass current tree\nstdout:\n${ok.stdout}\nstderr:\n${ok.stderr}`);

  const blocked = spawnSync(process.execPath, [
    SCRIPT,
    "--files",
    "test/fixtures/generic-cap-guard/blocked.example.md"
  ], {
    cwd: ROOT,
    encoding: "utf8"
  });
  t.is(blocked.status, 1, "guard blocks new app/repo-specific cap namespaces");
  t.ok(blocked.stderr.includes(["cap", "platform", "request-review", "v1"].join("/")));
  t.ok(blocked.stderr.includes("Prefer: cap/concern/<intent-family>/v1 plus profile/producer fields."));
});
