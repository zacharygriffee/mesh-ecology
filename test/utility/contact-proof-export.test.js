import test from "brittle";
import { mkTemp } from "../_helpers/fs.js";
import { readFile } from "fs/promises";
import path from "path";
import { main, parseArgs } from "../../scripts/contact-proof-direct-peer.js";

function memoryStream() {
  let text = "";
  return {
    stream: {
      write(chunk) {
        text += chunk;
      }
    },
    text() {
      return text;
    }
  };
}

test("contact proof command writes mesh_contact_proof_evidence artifact", async (t) => {
  const tmp = mkTemp("mesh-contact-proof-export-");
  try {
    const outputPath = path.join(tmp.dir, "proof.json");
    const stdout = memoryStream();
    const stderr = memoryStream();

    const code = await main(["--output", outputPath], stdout.stream, stderr.stream);
    const evidence = JSON.parse(await readFile(outputPath, "utf8"));

    t.is(code, 0, stderr.text());
    t.ok(stdout.text().includes("mesh contact proof evidence written"));
    t.is(evidence.artifactKind, "mesh_contact_proof_evidence");
    t.is(evidence.schema, "mesh-v0-2/contact-proof/direct-peer/v1");
    t.is(evidence.proofKind, "mesh_contact_direct_peer_lab");
    t.is(evidence.selectedTransport.transportKind, "protomux-rpc");
    t.is(evidence.selectedTransport.contactSeam, "hyperdht_direct_peer");
    t.is(evidence.readinessEvidence.readinessScope, "direct_peer_contact");
    t.is(evidence.distributedReadinessClaimed, false);
    t.is(evidence.contactAttempted, true);
    t.is(evidence.contactSucceeded, true, evidence.failureMessage || "contact should succeed");
  } finally {
    tmp.cleanup();
  }
});

test("contact proof command can emit JSON to stdout", async (t) => {
  const stdout = memoryStream();
  const stderr = memoryStream();

  const code = await main(["--json"], stdout.stream, stderr.stream);
  const evidence = JSON.parse(stdout.text());

  t.is(code, 0, stderr.text());
  t.is(evidence.artifactKind, "mesh_contact_proof_evidence");
  t.is(evidence.selectedTransport.scope, "isolated_local_hyperdht");
  t.is(evidence.distributedReadinessClaimed, false);
});

test("contact proof command rejects invalid timeout", (t) => {
  t.exception(() => parseArgs(["--timeout-ms", "1"]), /--timeout-ms/);
});
