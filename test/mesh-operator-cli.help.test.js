import test from "brittle";
import { spawnSync } from "child_process";
import path from "path";

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");
const CLI = path.join(ROOT, "packages", "mesh-operator-cli", "bin", "mesh.js");

test("mesh operator CLI help lists advertise-discovery", (t) => {
  const res = spawnSync(process.execPath, [CLI, "--help"], {
    cwd: ROOT,
    encoding: "utf8"
  });

  t.is(res.status, 0, `help failed: ${res.stderr || res.stdout}`);
  const out = String(res.stdout || "");
  t.ok(out.includes("mesh discovery advertise-discovery --discovery <z32> --nested <z32>"));
  t.ok(out.includes("For normal operator workflows, prefer mesh-ecology-packs live:ctl."));
});
