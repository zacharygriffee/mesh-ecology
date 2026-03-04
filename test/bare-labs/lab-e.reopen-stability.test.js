import idEncoding from "hypercore-id-encoding";

import {
  makeTmpRoot,
  makeHarness,
  keyWithByte,
  settleWithPump
} from "./_helpers/bare-lab-harness.js";

function assertOk(value, message) {
  if (!value) throw new Error(message);
}

async function materializePubAndRat(harness, tag) {
  const jobKey = await harness.host.createJob({
    cap: `cap/sdk-bare-labs-reopen-${tag}`,
    input: { in: `lab-e-${tag}` }
  });

  await harness.pump(8, { stepDelayMs: 2 });

  const attemptToken = keyWithByte(0x44);
  const pub = await harness.client.proposePub({
    concernKey: harness.host.concernKey,
    cap: `cap/sdk-bare-labs-reopen-pub-${tag}`,
    ref: {
      t: "result",
      k: jobKey,
      a: attemptToken
    },
    meta: { source: "bare-lab-e" }
  });
  assertOk(pub?.ok === true, "reopen setup proposePub should succeed");

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
  assertOk(pubWait?.ok === true, "reopen setup pub materialization should succeed");

  const attemptTokenZ32 = idEncoding.encode(attemptToken);
  const traced = await harness.client.trace({
    jobKey,
    concernKeys: [harness.host.concernKey]
  });
  const concern = traced?.concerns?.[0];
  const attempt = (concern?.attempts || []).find((row) => row.attemptToken === attemptTokenZ32);
  assertOk(attempt && typeof attempt.organismKey === "string", "reopen setup trace must include organismKey");

  const rat = await harness.client.proposeRat({
    concernKey: harness.host.concernKey,
    jobKey,
    organismKey: attempt.organismKey,
    attemptToken,
    cap: `cap/sdk-bare-labs-reopen-rat-${tag}`,
    ref: {
      t: "result",
      k: jobKey,
      a: attemptToken
    },
    note: "bare-lab-e-rat"
  });
  assertOk(rat?.ok === true, "reopen setup proposeRat should succeed");

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
  assertOk(ratWait?.ok === true, "reopen setup rat materialization should succeed");

  return {
    concernKey: harness.host.concernKey,
    jobKey,
    attemptTokenZ32
  };
}

const labName = "lab-e.reopen-stability";

async function runLab() {
  const tmpRoot = await makeTmpRoot("mesh-sdk-bare-labs-reopen");

  let firstHarness = null;
  let secondHarness = null;

  try {
    firstHarness = await makeHarness({ tmpRoot });
    const firstClientRef = firstHarness.client;
    const firstHostBaseRef = firstHarness.host.base;

    const materialized = await materializePubAndRat(firstHarness, "phase1");

    await firstHarness.closeAll({ cleanup: false });
    firstHarness = null;

    secondHarness = await makeHarness({ tmpRoot });

    assertOk(secondHarness.client !== firstClientRef, "reopen must create a fresh client object");
    assertOk(secondHarness.host.base !== firstHostBaseRef, "reopen must create a fresh host base object");
    assertOk(secondHarness.host.concernKey === materialized.concernKey, "reopen concern key should be stable");

    await secondHarness.pump(12, { stepDelayMs: 2 });

    const state = await secondHarness.client.state();
    const concernState = (state?.concerns || []).find((row) => row.key === materialized.concernKey);
    assertOk(concernState, "state after reopen must include original concern");

    const trace = await secondHarness.client.trace({
      jobKey: materialized.jobKey,
      concernKeys: [materialized.concernKey]
    });

    const concernTrace = trace?.concerns?.[0];
    const attempt = (concernTrace?.attempts || []).find((row) => row.attemptToken === materialized.attemptTokenZ32);
    assertOk(attempt && attempt.pubPresent === true, "reopen trace must retain materialized pub");
    assertOk(Array.isArray(attempt.ratifiers) && attempt.ratifiers.length > 0, "reopen trace must retain materialized rat");
  } finally {
    if (secondHarness) {
      await secondHarness.closeAll({ cleanup: true }).catch(() => {});
    }
    if (firstHarness) {
      await firstHarness.closeAll({ cleanup: true }).catch(() => {});
    }
  }
}

export { labName, runLab };
