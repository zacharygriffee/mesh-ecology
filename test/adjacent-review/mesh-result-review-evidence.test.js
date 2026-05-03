import test from "brittle";
import { readFileSync } from "fs";
import {
  EDGE_IMPORT_CLASSIFICATION,
  EDGE_PHASE_132_FIXTURE_PATH,
  MESH_RESULT_REVIEW_EVIDENCE_ARTIFACT_KIND,
  MESH_RESULT_REVIEW_EVIDENCE_SCHEMA,
  MESH_RESULT_REVIEW_EVIDENCE_SCHEMA_VERSION,
  REVIEW_STATUSES,
  reviewMeshResultReviewEvidenceFixture
} from "../../src/adjacent-review/mesh-result-review-evidence.js";

const fixtureUrl = new URL(
  "../fixtures/edge-adjacent-packets/phase-132-mesh-result-adjacent-review-packet-fixture.json",
  import.meta.url
);
const moduleUrl = new URL("../../src/adjacent-review/mesh-result-review-evidence.js", import.meta.url);

function readFixtureText() {
  return readFileSync(fixtureUrl, "utf8");
}

function readFixture() {
  return JSON.parse(readFixtureText());
}

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

test("static Edge fixture is consumed without fetching Edge", (t) => {
  const previousFetch = globalThis.fetch;
  let fetchCalls = 0;
  globalThis.fetch = () => {
    fetchCalls++;
    throw new Error("fetch must not be used by static fixture review");
  };

  try {
    const evidence = reviewMeshResultReviewEvidenceFixture(readFixtureText());
    t.is(evidence.reviewStatus, "review_only_pass");
    t.is(fetchCalls, 0);
    t.is(evidence.sourceFixture, EDGE_PHASE_132_FIXTURE_PATH);
  } finally {
    if (previousFetch === undefined) {
      delete globalThis.fetch;
    } else {
      globalThis.fetch = previousFetch;
    }
  }
});

test("valid Phase 132 fixture emits mesh-v0-2 owned evidence constants", (t) => {
  const evidence = reviewMeshResultReviewEvidenceFixture(readFixture());

  t.is(evidence.artifactKind, MESH_RESULT_REVIEW_EVIDENCE_ARTIFACT_KIND);
  t.is(evidence.artifactKind, "mesh_result_owned_adjacent_review_evidence");
  t.is(evidence.schema, MESH_RESULT_REVIEW_EVIDENCE_SCHEMA);
  t.is(evidence.schema, "mesh-ecology/result-review-evidence/v1");
  t.is(evidence.schemaVersion, MESH_RESULT_REVIEW_EVIDENCE_SCHEMA_VERSION);
  t.is(evidence.schemaVersion, 1);
  t.is(evidence.reviewStatus, "review_only_pass");
  t.ok(evidence.allowedReviewStatuses.includes("review_only_rejected"));
  t.alike(evidence.allowedReviewStatuses, REVIEW_STATUSES);
});

test("classification metadata is routing-only and does not grant Edge schema ownership", (t) => {
  const evidence = reviewMeshResultReviewEvidenceFixture(readFixture());

  t.alike(evidence.edgeImportClassification, EDGE_IMPORT_CLASSIFICATION);
  t.is(evidence.edgeImportClassification.seamId, "mesh_result_evidence");
  t.is(evidence.edgeImportClassification.evidenceKind, "mesh_result_edge_packet_review_evidence");
  t.is(evidence.edgeImportClassification.edgeExpectedArtifactKind, "mesh_result_edge_packet_review_evidence");
  t.is(evidence.edgeImportClassification.classificationOnly, true);
  t.is(evidence.edgeImportClassification.edgeOwnsSchema, false);
});

test("safe flags are present and non-authoritative", (t) => {
  const evidence = reviewMeshResultReviewEvidenceFixture(readFixture());

  t.is(evidence.staticInputOnly, true);
  t.is(evidence.reviewOnly, true);
  t.is(evidence.evidenceOnly, true);
  t.is(evidence.edgeRuntimeFetched, false);
  t.is(evidence.edgeCalled, false);
  t.is(evidence.edgeMutated, false);
  t.is(evidence.edgeJoinedMesh, false);
  t.is(evidence.edgeMeshParticipantClaimed, false);
  t.is(evidence.meshParticipationClaimed, false);
  t.is(evidence.jobExecutionClaimed, false);
  t.is(evidence.resultTruthClaimed, false);
  t.is(evidence.writerAdmissionClaimed, false);
  t.is(evidence.writerAuthorizationClaimed, false);
  t.is(evidence.topologyDiscoveryClaimed, false);
  t.is(evidence.canonicalTopologyClaimed, false);
  t.is(evidence.canonicalResultAccepted, false);
  t.is(evidence.runtimeSuccessClaimed, false);
  t.is(evidence.meshPublicationClaimed, false);
  t.is(evidence.meshWriteClaimed, false);
  t.is(evidence.actorExecutionClaimed, false);
  t.is(evidence.organismExecutionClaimed, false);
  t.is(evidence.schedulerClaimed, false);
  t.is(evidence.runnerClaimed, false);
  t.is(evidence.productionProofClaimed, false);
  t.is(evidence.meshTruthClaimed, false);
  t.is(evidence.grantsAdjacentAcceptance, false);
  t.is(evidence.edgeAuthorityGranted, false);
  t.is(evidence.publishesToMesh, false);
});

test("correlation refs are preserved as inert refs only", (t) => {
  const evidence = reviewMeshResultReviewEvidenceFixture(readFixture());

  t.is(evidence.refInterpretation, "inert_correlation_refs_only");
  t.is(evidence.packetRef, "edge-ecosystem-adjacent-packet:001:mesh:2026-05-02T10:00:00.000Z");
  t.is(evidence.sourceContractRef, "edge-ecosystem-handoff-contract:001:mesh:2026-05-02T10:00:00.000Z");
  t.is(evidence.sourceContractSetRef, "edge-ecosystem-handoff-contracts:2026-05-02T10:00:00.000Z");
  t.is(evidence.sourceLedgerRef, "edge-ecosystem-state-ledger:2026-05-02T10:00:00.000Z");
  t.is(evidence.sourceReadinessRollupRef, "edge-ecosystem-readiness:2026-05-02T10:00:00.000Z");
  t.alike(evidence.sourceEvidenceRefs, ["mesh-result:phase-132-ready"]);
  t.ok(evidence.sourceWorkPacketRefs[0].startsWith("edge-ecosystem-work-packet:"));
  t.ok(evidence.sourceNextActionRefs[0].startsWith("edge-ecosystem-next-action:"));
  t.is(evidence.sourceLedgerEventRefs.length, 5);
  t.is(evidence.sourceLedgerDeltaRefs.length, 1);
  t.is(evidence.meshResultRef, "mesh-result:phase-132-review");
  t.is(evidence.meshResultEvidenceRef, "mesh-result-evidence:phase-132-review");
  t.is(evidence.meshJobRef, "mesh-job:phase-132-review");
  t.is(evidence.meshRuntimeRef, "mesh-runtime-review:phase-132");
  t.is(evidence.writerAdmissionRef, null);
  t.is(evidence.meshParticipantRef, null);
  t.is(evidence.schedulerRef, null);
  t.is(evidence.runnerRef, null);
  t.is(evidence.resultDigestRef, "mesh-result-digest-review:phase-132");
  t.alike(evidence.correlationRefs.sourceEvidenceRefs, evidence.sourceEvidenceRefs);
});

test("unsafe flags and unsafe wording block review evidence", (t) => {
  const base = readFixture();

  const participation = clone(base);
  participation.meshParticipationClaimed = true;
  t.is(
    reviewMeshResultReviewEvidenceFixture(participation).reviewStatus,
    "review_only_mesh_participation_wording_blocked"
  );

  const writer = clone(base);
  writer.writerAdmissionClaimed = true;
  t.is(
    reviewMeshResultReviewEvidenceFixture(writer).reviewStatus,
    "review_only_writer_admission_wording_blocked"
  );

  const topology = clone(base);
  topology.topologyDiscoveryClaimed = true;
  t.is(
    reviewMeshResultReviewEvidenceFixture(topology).reviewStatus,
    "review_only_topology_discovery_wording_blocked"
  );

  const execution = clone(base);
  execution.reviewNote = "job executed";
  t.is(
    reviewMeshResultReviewEvidenceFixture(execution).reviewStatus,
    "review_only_execution_wording_blocked"
  );

  const truth = clone(base);
  truth.reviewNote = "result is true";
  const blocked = reviewMeshResultReviewEvidenceFixture(truth);
  t.is(blocked.reviewStatus, "review_only_result_truth_wording_blocked");
  t.ok(blocked.rejections[0].includes("result is true"));
});

test("malformed, incomplete, unsupported, and scope-violating fixtures remain review-only", (t) => {
  const malformed = reviewMeshResultReviewEvidenceFixture("{");
  t.is(malformed.reviewStatus, "review_only_malformed_fixture");
  t.is(malformed.reviewOnly, true);

  const incomplete = readFixture();
  delete incomplete.reviewChecklist;
  t.is(reviewMeshResultReviewEvidenceFixture(incomplete).reviewStatus, "review_only_incomplete_fixture");

  const unsupported = readFixture();
  unsupported.artifactKind = "other_fixture";
  t.is(reviewMeshResultReviewEvidenceFixture(unsupported).reviewStatus, "review_only_unsupported_fixture");

  const scopeViolation = readFixture();
  scopeViolation.callsAdjacentRepo = true;
  t.is(reviewMeshResultReviewEvidenceFixture(scopeViolation).reviewStatus, "review_only_scope_violation");
});

test("Edge packet is not accepted as schema, command, TODO, proof, or truth", (t) => {
  const evidence = reviewMeshResultReviewEvidenceFixture(readFixture());

  t.is(evidence.edgePacketAcceptedAsSchema, false);
  t.is(evidence.edgePacketAcceptedAsCommand, false);
  t.is(evidence.edgePacketAcceptedAsTodo, false);
  t.is(evidence.edgePacketAcceptedAsProof, false);
  t.is(evidence.edgePacketAcceptedAsTruth, false);
  t.is(evidence.fixtureInterpretation.edgePacketParsedAsMeshTruth, false);
  t.is(evidence.fixtureInterpretation.edgePacketParsedAsCommand, false);
  t.is(evidence.fixtureInterpretation.edgePacketParsedAsTodo, false);
  t.is(evidence.fixtureInterpretation.edgePacketParsedAsProof, false);
});

test("module introduces no live mesh, SDK, runner, scheduler, or actor execution path", (t) => {
  const evidence = reviewMeshResultReviewEvidenceFixture(readFixture());
  const source = readFileSync(moduleUrl, "utf8");

  t.is(evidence.meshJoinClaimed, false);
  t.is(evidence.publishesToMesh, false);
  t.is(evidence.jobExecutionClaimed, false);
  t.is(evidence.writerAdmissionClaimed, false);
  t.is(evidence.topologyDiscoveryClaimed, false);
  t.is(evidence.actorExecutionClaimed, false);
  t.is(evidence.organismExecutionClaimed, false);
  t.is(evidence.runnerClaimed, false);
  t.is(evidence.schedulerClaimed, false);
  t.is(evidence.liveDiscoveryClaimed, false);
  t.is(evidence.sdkExecutionPathIntroduced, false);
  t.is(source.includes("createMeshClient"), false);
  t.is(source.includes("ensureDiscoverySurface"), false);
  t.is(source.includes("createJob"), false);
  t.is(source.includes("publishPub"), false);
  t.is(source.includes("publishRat"), false);
  t.is(source.includes("onTick("), false);
});
