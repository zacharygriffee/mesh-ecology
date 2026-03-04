import idEncoding from "hypercore-id-encoding";

import {
  makeHarness,
  keyWithByte,
  settleWithPump
} from "./_helpers/bare-lab-harness.js";

function assertOk(value, message) {
  if (!value) throw new Error(message);
}

const labName = "lab-c.materialization";

async function runLab() {
  const harness = await makeHarness();

  try {
    const jobKey = await harness.host.createJob({
      cap: "cap/sdk-bare-labs-materialization",
      input: { in: "lab-c" }
    });

    await harness.pump(8, { stepDelayMs: 2 });

    const attemptToken = keyWithByte(0x31);
    const proposedPub = await harness.client.proposePub({
      concernKey: harness.host.concernKey,
      cap: "cap/sdk-bare-labs-pub",
      ref: {
        t: "result",
        k: jobKey,
        a: attemptToken
      },
      meta: { source: "bare-lab-c" }
    });

    assertOk(proposedPub?.ok === true, "proposePub should succeed");

    const pubWait = await settleWithPump(
      harness.client.waitForMaterialization({
        concernKey: harness.host.concernKey,
        jobKey,
        kind: "pub",
        attemptToken,
        timeoutMs: 1200,
        intervalMs: 25
      }),
      harness.pump,
      { maxSteps: 160, stepDelayMs: 2 }
    );

    assertOk(pubWait?.ok === true, "pub materialization wait should succeed");

    const attemptTokenZ32 = idEncoding.encode(attemptToken);
    const traceAfterPub = await harness.client.trace({
      jobKey,
      concernKeys: [harness.host.concernKey]
    });

    const concernAfterPub = traceAfterPub?.concerns?.[0];
    const attempt = (concernAfterPub?.attempts || []).find((row) => row.attemptToken === attemptTokenZ32);
    assertOk(attempt && typeof attempt.organismKey === "string", "trace must include proposed pub attempt");

    const proposedRat = await harness.client.proposeRat({
      concernKey: harness.host.concernKey,
      jobKey,
      organismKey: attempt.organismKey,
      attemptToken,
      cap: "cap/sdk-bare-labs-rat",
      ref: {
        t: "result",
        k: jobKey,
        a: attemptToken
      },
      note: "bare-lab-c-rat"
    });

    assertOk(proposedRat?.ok === true, "proposeRat should succeed");

    const ratWait = await settleWithPump(
      harness.client.waitForMaterialization({
        concernKey: harness.host.concernKey,
        jobKey,
        kind: "rat",
        attemptToken,
        organismKey: attempt.organismKey,
        timeoutMs: 1200,
        intervalMs: 25
      }),
      harness.pump,
      { maxSteps: 160, stepDelayMs: 2 }
    );

    assertOk(ratWait?.ok === true, "rat materialization wait should succeed");

    const traceAfterRat = await harness.client.trace({
      jobKey,
      concernKeys: [harness.host.concernKey]
    });

    const concernAfterRat = traceAfterRat?.concerns?.[0];
    const finalAttempt = (concernAfterRat?.attempts || []).find((row) => row.attemptToken === attemptTokenZ32);
    assertOk(Array.isArray(finalAttempt?.ratifiers) && finalAttempt.ratifiers.length > 0, "trace must show ratifier materialization");
  } finally {
    await harness.closeAll();
  }
}

export { labName, runLab };
