import fs from "fs";
import path from "path";
import test from "brittle";
import { spawnSync } from "child_process";
import idEncoding from "hypercore-id-encoding";
import { mkTemp } from "../_helpers/fs.js";
import { ensureCorestore } from "../../src/ensureCorestore.js";
import { ensureDiscoverySurface } from "../../src/discovery.js";
import { ensureConcernSurface, createJob } from "../../src/concern.js";

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), "../..");
const APPLY = path.join(ROOT, "scripts", "runtime-host-apply.js");
const REPORT = path.join(ROOT, "scripts", "runtime-host-report.js");
const NULL_SWARM = {
  connections: [],
  on() {},
  off() {}
};

test("runtime host report emits bounded facts for local discovery and concern hosts", async (t) => {
  const tmp = mkTemp("runtime-host-report-");
  t.teardown(() => tmp.cleanup());

  const discoveryStoreDir = path.join(tmp.dir, "var", "lib", "mesh", "discovery");
  const concernStoreDir = path.join(tmp.dir, "var", "lib", "mesh", "concern");

  const discoveryStore = ensureCorestore(discoveryStoreDir);
  await discoveryStore.ready?.();
  const discovery = await ensureDiscoverySurface(discoveryStore.namespace("mesh-discovery-host"));
  const discoveryKey = idEncoding.encode(discovery.key);

  const concernStore = ensureCorestore(concernStoreDir);
  await concernStore.ready?.();
  const concern = await ensureConcernSurface(concernStore.namespace("mesh-concern-host-1"), NULL_SWARM);
  const concernKey = idEncoding.encode(concern.key);
  await createJob(concern, "cap/test/runtime-host-report", { hello: "mesh" });

  const specPath = path.join(tmp.dir, "runtime-hosts.json");
  fs.writeFileSync(specPath, JSON.stringify({
    version: 1,
    repoRoot: ROOT,
    discoveryHost: {
      config: {
        discoveryKey
      }
    },
    concernHost: {
      config: {
        concernKeys: [concernKey]
      }
    }
  }, null, 2));

  const applyRes = spawnSync(process.execPath, [APPLY, "--spec", specPath, "--root", tmp.dir], {
    cwd: ROOT,
    encoding: "utf8"
  });
  t.is(applyRes.status, 0, applyRes.stderr || applyRes.stdout);

  await concern.close().catch(() => {});
  await discovery.close().catch(() => {});
  await concernStore.close?.().catch(() => {});
  await discoveryStore.close?.().catch(() => {});

  const reportRes = spawnSync(process.execPath, [REPORT, "--spec", specPath, "--root", tmp.dir], {
    cwd: ROOT,
    encoding: "utf8"
  });
  t.is(reportRes.status, 0, reportRes.stderr || reportRes.stdout);

  const out = JSON.parse(String(reportRes.stdout || "{}"));
  t.is(out.ok, true);
  t.is(out.discoveryHost.configuredKey, discoveryKey);
  t.is(out.discoveryHost.readinessState, "opened");
  t.ok(out.discoveryHost.localEntries >= 0);
  t.is(out.concernHost.concerns[0].concernKey, concernKey);
  t.is(out.concernHost.concerns[0].readinessState, "opened");
  t.is(out.concernHost.concerns[0].counts.jobs, 1);
});
