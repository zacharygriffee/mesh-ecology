import { makeHarness } from "./_helpers/bare-lab-harness.js";

function assertOk(value, message) {
  if (!value) throw new Error(message);
}

const EMPTY_JOB_KEY_HEX = "00".repeat(32);
const labName = "lab-b.pump-loop";

async function runLab() {
  const harness = await makeHarness();

  try {
    await harness.pump(10, { stepDelayMs: 2 });

    const state = await harness.client.state();
    assertOk(state && typeof state === "object", "state() must return an object");
    assertOk(state.schema === "mesh-ecology-packs/state/v1", "state schema mismatch");
    assertOk(state.schemaVersion === 1, "state schemaVersion mismatch");
    assertOk(Array.isArray(state.concerns), "state.concerns must be an array");

    const trace = await harness.client.trace({
      jobKey: EMPTY_JOB_KEY_HEX,
      concernKeys: [harness.host.concernKey]
    });

    assertOk(trace && typeof trace === "object", "trace() must return an object");
    assertOk(trace.schema === "mesh-ecology-packs/trace/v1", "trace schema mismatch");
    assertOk(trace.schemaVersion === 1, "trace schemaVersion mismatch");
    assertOk(Array.isArray(trace.concerns), "trace.concerns must be an array");
  } finally {
    await harness.closeAll();
  }
}

export { labName, runLab };
