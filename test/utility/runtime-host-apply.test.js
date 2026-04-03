import fs from "fs";
import path from "path";
import test from "brittle";
import { spawnSync } from "child_process";
import { mkTemp } from "../_helpers/fs.js";

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), "../..");
const APPLY = path.join(ROOT, "scripts", "runtime-host-apply.js");

test("runtime host apply materializes runtime-owned files from spec", async (t) => {
  const tmp = mkTemp("runtime-host-apply-");
  t.teardown(() => tmp.cleanup());

  const specPath = path.join(tmp.dir, "runtime-hosts.json");
  fs.writeFileSync(specPath, JSON.stringify({
    version: 1,
    repoRoot: ROOT,
    discoveryHost: {
      config: {
        discoveryCreate: true
      }
    },
    concernHost: {
      config: {
        concernKeys: ["concern-z32"],
        validation: 1
      }
    }
  }, null, 2));

  const res = spawnSync(process.execPath, [APPLY, "--spec", specPath, "--root", tmp.dir], {
    cwd: ROOT,
    encoding: "utf8"
  });

  t.is(res.status, 0, res.stderr || res.stdout);
  const out = JSON.parse(String(res.stdout || "{}"));
  t.is(out.ok, true);

  const discoveryConfigPath = path.join(tmp.dir, "etc", "mesh", "discovery-host.json");
  const concernConfigPath = path.join(tmp.dir, "etc", "mesh", "concern-host.json");
  const discoveryUnitPath = path.join(tmp.dir, "etc", "systemd", "system", "mesh-discovery-host.service");
  const concernUnitPath = path.join(tmp.dir, "etc", "systemd", "system", "mesh-concern-host.service");

  t.ok(fs.existsSync(discoveryConfigPath));
  t.ok(fs.existsSync(concernConfigPath));
  t.ok(fs.existsSync(discoveryUnitPath));
  t.ok(fs.existsSync(concernUnitPath));

  const discoveryConfig = JSON.parse(fs.readFileSync(discoveryConfigPath, "utf8"));
  const concernConfig = JSON.parse(fs.readFileSync(concernConfigPath, "utf8"));
  const discoveryUnit = fs.readFileSync(discoveryUnitPath, "utf8");

  t.is(discoveryConfig.discoveryCreate, true);
  t.alike(concernConfig.concernKeys, ["concern-z32"]);
  t.ok(discoveryUnit.includes(ROOT), "rendered unit should include repo root");
});
