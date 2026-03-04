import {
  makeHarness,
  keyWithByte,
  settleWithPump
} from "./_helpers/bare-lab-harness.js";

function assertOk(value, message) {
  if (!value) throw new Error(message);
}

const labName = "lab-d.negative-wait";

async function runLab() {
  const harness = await makeHarness();

  try {
    const jobKey = await harness.host.createJob({
      cap: "cap/sdk-bare-labs-negative",
      input: { in: "lab-d" }
    });

    await harness.pump(8, { stepDelayMs: 2 });

    const impossibleAttempt = keyWithByte(0xee);
    const impossibleOrg = keyWithByte(0xdd);

    const pubTimeout = await settleWithPump(
      harness.client.waitForMaterialization({
        concernKey: harness.host.concernKey,
        jobKey,
        kind: "pub",
        attemptToken: impossibleAttempt,
        timeoutMs: 60,
        intervalMs: 8
      }),
      harness.pump,
      { maxSteps: 120, stepDelayMs: 2 }
    );

    assertOk(pubTimeout?.ok === false, "pub timeout must fail deterministically");
    assertOk(pubTimeout?.timeout === true, "pub timeout flag must be true");
    assertOk(pubTimeout?.found === false, "pub timeout must not report found");

    const ratTimeout = await settleWithPump(
      harness.client.waitForMaterialization({
        concernKey: harness.host.concernKey,
        jobKey,
        kind: "rat",
        attemptToken: impossibleAttempt,
        organismKey: impossibleOrg,
        timeoutMs: 60,
        intervalMs: 8
      }),
      harness.pump,
      { maxSteps: 120, stepDelayMs: 2 }
    );

    assertOk(ratTimeout?.ok === false, "rat timeout must fail deterministically");
    assertOk(ratTimeout?.timeout === true, "rat timeout flag must be true");
    assertOk(ratTimeout?.found === false, "rat timeout must not report found");
  } finally {
    await harness.closeAll();
  }
}

export { labName, runLab };
