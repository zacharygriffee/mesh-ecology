#!/usr/bin/env node
import b4a from "b4a";
import idEncoding from "hypercore-id-encoding";

import { createMeshClient } from "@mesh/mesh-sdk";
import { createMeshClient as createMeshClientBare } from "@mesh/mesh-sdk/bare";
import { createBareSdkHarness } from "./_helpers/bare-harness.js";

function assertOk(value, message) {
  if (!value) throw new Error(message);
}

function keyWithByte(byteValue) {
  const out = b4a.alloc(32);
  out.fill(byteValue & 0xff);
  return out;
}

async function run() {
  assertOk(typeof createMeshClient === "function", "default export must expose createMeshClient");
  assertOk(typeof createMeshClientBare === "function", "bare export must expose createMeshClient");

  const harness = await createBareSdkHarness({ createMeshClient });

  try {
    const jobKey = harness.jobKey;
    await harness.pump({ steps: 25 });

    const attemptToken = keyWithByte(0x39);
    const proposedPub = await harness.client.proposePub({
      concernKey: harness.concernKey,
      cap: "cap/sdk-bare-e2e-pub",
      ref: {
        t: "result",
        k: jobKey,
        a: attemptToken
      },
      meta: { source: "bare-e2e" }
    });

    assertOk(proposedPub?.ok === true, "proposePub should succeed");
    await harness.pump({ steps: 40 });

    const pubWait = await harness.client.waitForMaterialization({
      concernKey: harness.concernKey,
      jobKey,
      kind: "pub",
      attemptToken,
      timeoutMs: 1800,
      intervalMs: 60
    });

    assertOk(pubWait?.ok === true, "pub should materialize");
    assertOk(pubWait?.found === true, "pub materialization must be found");

    const tracedAfterPub = await harness.client.trace({
      jobKey,
      concernKeys: [harness.concernKey]
    });

    const concernRow = tracedAfterPub?.concerns?.[0];
    const attemptTokenZ32 = idEncoding.encode(attemptToken);
    const attempt = (concernRow?.attempts || []).find((row) => row.attemptToken === attemptTokenZ32);
    assertOk(attempt, "trace should include proposed attempt");

    const proposedRat = await harness.client.proposeRat({
      concernKey: harness.concernKey,
      jobKey,
      organismKey: attempt.organismKey,
      attemptToken,
      cap: "cap/sdk-bare-e2e-rat",
      ref: {
        t: "result",
        k: jobKey,
        a: attemptToken
      },
      note: "bare-e2e-rat"
    });

    assertOk(proposedRat?.ok === true, "proposeRat should succeed");
    await harness.pump({ steps: 40 });

    const ratWait = await harness.client.waitForMaterialization({
      concernKey: harness.concernKey,
      jobKey,
      kind: "rat",
      attemptToken,
      organismKey: attempt.organismKey,
      timeoutMs: 1800,
      intervalMs: 60
    });

    assertOk(ratWait?.ok === true, "rat should materialize");
    assertOk(ratWait?.found === true, "rat materialization must be found");

    const tracedAfterRat = await harness.client.trace({
      jobKey,
      concernKeys: [harness.concernKey]
    });
    assertOk(tracedAfterRat?.concerns?.[0]?.stage === "rat_present", "trace stage should show rat_present");

    // Deterministic negative path: impossible key + bounded pump steps, assert semantic timeout fields only.
    const impossibleAttemptToken = keyWithByte(0xee);
    await harness.pump({ steps: 8 });
    const timeoutResult = await harness.client.waitForMaterialization({
      concernKey: harness.concernKey,
      jobKey,
      kind: "pub",
      attemptToken: impossibleAttemptToken,
      timeoutMs: 200,
      intervalMs: 60
    });
    await harness.pump({ steps: 4 });

    assertOk(timeoutResult?.ok === false, "impossible attempt must not materialize");
    assertOk(timeoutResult?.timeout === true, "impossible attempt must timeout");
    assertOk(timeoutResult?.found === false, "impossible attempt must not be found");
  } finally {
    await harness.close();
  }

  console.log("[mesh-sdk] bare e2e materialization passed");
}

await run();
