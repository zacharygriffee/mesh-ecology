import test from "brittle";
import fs from "fs";
import path from "path";

import { __test__ } from "../../src/concern.js";

test("concern.apply probe gate does not use direct process.env access", (t) => {
  const applyPath = path.resolve(process.cwd(), "src/concern/apply.js");
  const source = fs.readFileSync(applyPath, "utf8");
  t.is(source.includes("process.env.MESH_TEST_APPLY_PROBE"), false, "apply.js should not use direct process.env");
});

test("concern __test__.setApplyProbe is safe when process is missing", (t) => {
  const originalProcess = globalThis.process;

  try {
    globalThis.process = undefined;
    __test__.setApplyProbe(() => {});
    __test__.setApplyProbe(null);
  } catch (err) {
    t.fail(err?.stack || err?.message || String(err));
    return;
  } finally {
    globalThis.process = originalProcess;
  }

  t.pass("setApplyProbe is process-safe");
});
