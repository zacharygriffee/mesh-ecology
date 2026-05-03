export const MESH_RESULT_REVIEW_EVIDENCE_ARTIFACT_KIND =
  "mesh_result_owned_adjacent_review_evidence";

export const MESH_RESULT_REVIEW_EVIDENCE_SCHEMA =
  "mesh-ecology/result-review-evidence/v1";

export const MESH_RESULT_REVIEW_EVIDENCE_SCHEMA_VERSION = 1;

export const EDGE_PHASE_132_FIXTURE_PATH =
  "test/fixtures/edge-adjacent-packets/phase-132-mesh-result-adjacent-review-packet-fixture.json";

export const EDGE_IMPORT_CLASSIFICATION = Object.freeze({
  seamId: "mesh_result_evidence",
  evidenceKind: "mesh_result_edge_packet_review_evidence",
  edgeExpectedArtifactKind: "mesh_result_edge_packet_review_evidence",
  classificationOnly: true,
  edgeOwnsSchema: false
});

export const REVIEW_STATUSES = Object.freeze([
  "review_only_pass",
  "review_only_rejected",
  "review_only_malformed_fixture",
  "review_only_incomplete_fixture",
  "review_only_unsupported_fixture",
  "review_only_scope_violation",
  "review_only_mesh_participation_wording_blocked",
  "review_only_result_truth_wording_blocked",
  "review_only_writer_admission_wording_blocked",
  "review_only_topology_discovery_wording_blocked",
  "review_only_execution_wording_blocked"
]);

export const COMMON_EDGE_REF_FIELDS = Object.freeze([
  "packetRef",
  "sourceContractRef",
  "sourceContractSetRef",
  "sourceLedgerRef",
  "sourceReadinessRollupRef",
  "sourceEvidenceRefs",
  "sourceWorkPacketRefs",
  "sourceNextActionRefs",
  "sourceLedgerEventRefs",
  "sourceLedgerDeltaRefs"
]);

export const MESH_RESULT_REF_FIELDS = Object.freeze([
  "meshResultRef",
  "meshResultEvidenceRef",
  "meshResultReceiptRef",
  "meshJobRef",
  "meshJobRequestRef",
  "meshJobResultRef",
  "meshExecutionRef",
  "meshRuntimeRef",
  "meshWriterRef",
  "writerAdmissionRef",
  "writerReceiptRef",
  "meshTopologyRef",
  "topologySnapshotRef",
  "meshParticipantRef",
  "meshPublicationRef",
  "meshCommitRef",
  "meshObservationRef",
  "meshRouteRef",
  "meshPeerRef",
  "actorRef",
  "organismRef",
  "schedulerRef",
  "runnerRef",
  "resultPayloadRef",
  "resultDigestRef",
  "resultValidationRef"
]);

export const SAFE_REVIEW_FLAGS = Object.freeze({
  staticInputOnly: true,
  reviewOnly: true,
  evidenceOnly: true,
  edgeRuntimeFetched: false,
  edgeCalled: false,
  edgeMutated: false,
  edgeJoinedMesh: false,
  edgeMeshParticipantClaimed: false,
  edgePacketAcceptedAsSchema: false,
  edgePacketAcceptedAsCommand: false,
  edgePacketAcceptedAsTodo: false,
  edgePacketAcceptedAsProof: false,
  edgePacketAcceptedAsTruth: false,
  meshParticipationClaimed: false,
  jobExecutionClaimed: false,
  resultTruthClaimed: false,
  writerAdmissionClaimed: false,
  writerAuthorizationClaimed: false,
  topologyDiscoveryClaimed: false,
  canonicalTopologyClaimed: false,
  canonicalResultAccepted: false,
  runtimeSuccessClaimed: false,
  meshPublicationClaimed: false,
  meshWriteClaimed: false,
  actorExecutionClaimed: false,
  organismExecutionClaimed: false,
  schedulerClaimed: false,
  runnerClaimed: false,
  productionProofClaimed: false,
  meshTruthClaimed: false,
  grantsAdjacentAcceptance: false,
  edgeAuthorityGranted: false,
  publishesToMesh: false,
  meshJoinClaimed: false,
  liveDiscoveryClaimed: false,
  sdkExecutionPathIntroduced: false
});

const UNSAFE_WORDING_RULES = Object.freeze([
  ["review_only_mesh_participation_wording_blocked", [
    "edge joined mesh",
    "edge is a mesh participant",
    "mesh participant accepted"
  ]],
  ["review_only_writer_admission_wording_blocked", [
    "writer admitted",
    "writer authorized",
    "writer trusted"
  ]],
  ["review_only_topology_discovery_wording_blocked", [
    "topology discovered",
    "topology is canonical"
  ]],
  ["review_only_result_truth_wording_blocked", [
    "canonical result",
    "result is true",
    "result verified",
    "mesh receipt proves",
    "production proof",
    "mesh proof"
  ]],
  ["review_only_execution_wording_blocked", [
    "job executed",
    "job succeeded",
    "job completed",
    "actor executed",
    "organism executed",
    "runtime succeeded",
    "runtime healthy",
    "published to mesh",
    "wrote to mesh",
    "committed to mesh",
    "broadcast to mesh",
    "replicated through mesh",
    "scheduled job",
    "dispatched job",
    "ran job",
    "replayed job"
  ]]
]);

const UNSAFE_FLAG_RULES = Object.freeze([
  ["review_only_mesh_participation_wording_blocked", [
    "edgeJoinedMesh",
    "edgeMeshParticipantClaimed",
    "meshParticipationClaimed",
    "infersMeshParticipation"
  ]],
  ["review_only_result_truth_wording_blocked", [
    "resultTruthClaimed",
    "canonicalResultAccepted",
    "meshTruthClaimed",
    "productionProofClaimed",
    "infersAdjacentTruth",
    "meshResultAccepted",
    "meshResultSchemaAccepted"
  ]],
  ["review_only_writer_admission_wording_blocked", [
    "writerAdmissionClaimed",
    "writerAuthorizationClaimed",
    "admitsWriter"
  ]],
  ["review_only_topology_discovery_wording_blocked", [
    "topologyDiscoveryClaimed",
    "canonicalTopologyClaimed",
    "discoversRepos",
    "discoversTools",
    "discoversEvidence"
  ]],
  ["review_only_execution_wording_blocked", [
    "jobExecutionClaimed",
    "runtimeSuccessClaimed",
    "meshPublicationClaimed",
    "meshWriteClaimed",
    "actorExecutionClaimed",
    "organismExecutionClaimed",
    "schedulerClaimed",
    "runnerClaimed",
    "executesAction",
    "schedulesWork",
    "publishesToMesh",
    "callsTool",
    "activatesPlatform"
  ]],
  ["review_only_scope_violation", [
    "callsAdjacentRepo",
    "grantsAuthority",
    "adjacentRepoAuthority",
    "hiddenStateMutation",
    "adjacentAccepted",
    "adjacentAcceptanceClaimed"
  ]]
]);

const IGNORED_WORDING_PATH_PREFIXES = Object.freeze([
  "$.meshResultWordingGuardrails.avoidWording",
  "$.meshResultWordingGuardrails.useWording",
  "$.reviewChecklist",
  "$.stopGoDecision.acceptanceCriteria"
]);

export function reviewMeshResultReviewEvidenceFixture(input, options = {}) {
  const parsed = parseFixtureInput(input);
  if (!parsed.ok) {
    return buildEvidence({
      fixture: null,
      sourceFixture: options.sourceFixture,
      reviewStatus: "review_only_malformed_fixture",
      reasonCodes: ["fixture_json_malformed"],
      rejections: [parsed.reason],
      warnings: ["static-fixture-only", "review-evidence-only"]
    });
  }

  const fixture = parsed.fixture;
  if (!isPlainObject(fixture)) {
    return buildEvidence({
      fixture: null,
      sourceFixture: options.sourceFixture,
      reviewStatus: "review_only_malformed_fixture",
      reasonCodes: ["fixture_not_object"],
      rejections: ["fixture must parse to an object"],
      warnings: ["static-fixture-only", "review-evidence-only"]
    });
  }

  const refs = collectCorrelationRefs(fixture);
  const support = inspectFixtureSupport(fixture, refs);
  if (!support.ok) {
    return buildEvidence({
      fixture,
      refs,
      sourceFixture: options.sourceFixture,
      reviewStatus: support.status,
      reasonCodes: support.reasonCodes,
      rejections: support.rejections,
      warnings: ["static-fixture-only", "review-evidence-only", "fixture-not-accepted-as-truth"]
    });
  }

  const unsafe = inspectUnsafeClaims(fixture);
  if (!unsafe.ok) {
    return buildEvidence({
      fixture,
      refs,
      sourceFixture: options.sourceFixture,
      reviewStatus: unsafe.status,
      reasonCodes: unsafe.reasonCodes,
      rejections: unsafe.rejections,
      warnings: ["static-fixture-only", "review-evidence-only", "unsafe-claim-blocked"]
    });
  }

  return buildEvidence({
    fixture,
    refs,
    sourceFixture: options.sourceFixture,
    reviewStatus: "review_only_pass",
    reasonCodes: [
      "mesh_result_packet_fixture_review_pass",
      "mesh_result_evidence_review_only",
      "no_mesh_authority_claimed"
    ],
    rejections: [],
    warnings: [
      "static-fixture-only",
      "review-evidence-only",
      "edge-import-classification-only"
    ]
  });
}

export function collectCorrelationRefs(fixture) {
  if (!isPlainObject(fixture)) return {};

  const packet = firstPacket(fixture);
  const expected = isPlainObject(fixture.expectedMeshResultEvidenceResponseShape)
    ? fixture.expectedMeshResultEvidenceResponseShape
    : {};
  const expectedRefs = isPlainObject(expected.correlationRefs) ? expected.correlationRefs : {};
  const edgePacketRefs = isPlainObject(expected.edgePacketRefs) ? expected.edgePacketRefs : {};
  const packetSet = isPlainObject(fixture.packetSet) ? fixture.packetSet : {};

  const refs = {};
  for (const field of [...COMMON_EDGE_REF_FIELDS, ...MESH_RESULT_REF_FIELDS]) {
    const value = firstDefined(
      fixture[field],
      packet?.[field],
      packetSet[field],
      expected[field],
      expectedRefs[field],
      edgePacketRefs[field]
    );
    if (value !== undefined) refs[field] = cloneJsonValue(value);
  }
  return refs;
}

function parseFixtureInput(input) {
  if (typeof input === "string") {
    try {
      return { ok: true, fixture: JSON.parse(input) };
    } catch (err) {
      return { ok: false, reason: `fixture JSON parse failed: ${err.message}` };
    }
  }
  return { ok: true, fixture: input };
}

function inspectFixtureSupport(fixture, refs) {
  const packet = firstPacket(fixture);
  if (!isPhase132MeshResultFixture(fixture)) {
    return {
      ok: false,
      status: "review_only_unsupported_fixture",
      reasonCodes: ["unsupported_fixture_identity"],
      rejections: ["fixture is not the Edge Phase 132 mesh-result review fixture"]
    };
  }

  const missing = [];
  if (!packet) missing.push("packet");
  if (fixture.stopGoDecision?.decision !== "go_for_mesh_result_repo_review") {
    missing.push("stopGoDecision.decision");
  }
  if (!Array.isArray(fixture.reviewChecklist) || fixture.reviewChecklist.length === 0) {
    missing.push("reviewChecklist");
  }
  if (!isPlainObject(fixture.meshResultWordingGuardrails)) {
    missing.push("meshResultWordingGuardrails");
  }
  if (!isPlainObject(fixture.expectedMeshResultEvidenceResponseShape) && Object.keys(refs).length === 0) {
    missing.push("expectedMeshResultEvidenceResponseShape or correlation refs");
  }
  if (!refs.packetRef) missing.push("packetRef");
  if (!refs.sourceContractRef) missing.push("sourceContractRef");

  if (missing.length) {
    return {
      ok: false,
      status: "review_only_incomplete_fixture",
      reasonCodes: ["incomplete_fixture_material"],
      rejections: missing.map((field) => `missing ${field}`)
    };
  }

  const packetUnsupported = packetUnsupportedActions(packet);
  if (!packetUnsupported.ok) {
    return {
      ok: false,
      status: "review_only_scope_violation",
      reasonCodes: ["unsupported_action_scope_violation"],
      rejections: packetUnsupported.rejections
    };
  }

  return { ok: true };
}

function inspectUnsafeClaims(fixture) {
  for (const [status, fields] of UNSAFE_FLAG_RULES) {
    const hits = findTrueFields(fixture, fields);
    if (hits.length) {
      return {
        ok: false,
        status,
        reasonCodes: ["unsafe_authority_flag_blocked"],
        rejections: hits.map((hit) => `unsafe true flag ${hit}`)
      };
    }
  }

  const wordingHit = findUnsafeWording(fixture);
  if (wordingHit) {
    return {
      ok: false,
      status: wordingHit.status,
      reasonCodes: ["unsafe_authority_wording_blocked"],
      rejections: [`unsafe wording "${wordingHit.phrase}" at ${wordingHit.path}`]
    };
  }

  return { ok: true };
}

function buildEvidence({
  fixture,
  refs = {},
  sourceFixture,
  reviewStatus,
  reasonCodes,
  warnings,
  rejections
}) {
  const createdAt = isPlainObject(fixture) && typeof fixture.createdAt === "string"
    ? fixture.createdAt
    : null;
  const evidenceId = isPlainObject(fixture) && typeof fixture.fixtureId === "string"
    ? `mesh-result-review-evidence:${fixture.fixtureId}`
    : "mesh-result-review-evidence:unavailable";
  const edgePacketRefs = pickRefs(refs, COMMON_EDGE_REF_FIELDS);
  const meshRefs = pickRefs(refs, MESH_RESULT_REF_FIELDS);
  const correlationRefs = { ...edgePacketRefs, ...meshRefs };

  return {
    artifactKind: MESH_RESULT_REVIEW_EVIDENCE_ARTIFACT_KIND,
    schema: MESH_RESULT_REVIEW_EVIDENCE_SCHEMA,
    schemaVersion: MESH_RESULT_REVIEW_EVIDENCE_SCHEMA_VERSION,
    artifactId: evidenceId,
    evidenceId,
    createdAt,
    emittedAt: createdAt,
    sourceFixture: sourceFixture || EDGE_PHASE_132_FIXTURE_PATH,
    edgePacketRefs,
    edgeImportClassification: { ...EDGE_IMPORT_CLASSIFICATION },
    reviewStatus,
    allowedReviewStatuses: [...REVIEW_STATUSES],
    evidenceLabel: {
      evidenceKind: "mesh_result_fixture_review",
      outcome: reviewStatus,
      scenarioId: "phase-132-mesh-result-adjacent-packet"
    },
    receiptLabel: {
      labelKind: "mesh_result_evidence_review",
      outcome: reviewStatus,
      requestArtifactKindReviewed: "mesh_job_preparation_plan",
      receiptArtifactKindReviewed: "edge_mesh_result_evidence_import"
    },
    reasonCodes: [...reasonCodes],
    meshResultFindings: [],
    warnings: [...warnings],
    rejections: [...rejections],
    correlationRefs,
    refInterpretation: "inert_correlation_refs_only",
    fixtureInterpretation: {
      edgePacketAcceptedAsSchema: false,
      edgePacketAcceptedAsCommand: false,
      edgePacketAcceptedAsTodo: false,
      edgePacketAcceptedAsProof: false,
      edgePacketAcceptedAsTruth: false,
      edgePacketParsedAsMeshTruth: false,
      edgePacketParsedAsCommand: false,
      edgePacketParsedAsTodo: false,
      edgePacketParsedAsProof: false
    },
    ...edgePacketRefs,
    ...meshRefs,
    ...SAFE_REVIEW_FLAGS
  };
}

function isPhase132MeshResultFixture(fixture) {
  return fixture.artifactKind === "edge_ecosystem_mesh_result_packet_fixture_review" &&
    fixture.schemaVersion === "edge_ecosystem_mesh_result_packet_fixture_review.v1" &&
    fixture.fixtureScope === "edge_side_mesh_result_packet_review_only" &&
    fixture.targetSurface === "mesh_result_evidence" &&
    fixture.seamId === "mesh_result_evidence";
}

function firstPacket(fixture) {
  if (isPlainObject(fixture.packet)) return fixture.packet;
  if (Array.isArray(fixture.packetSet?.packets) && isPlainObject(fixture.packetSet.packets[0])) {
    return fixture.packetSet.packets[0];
  }
  return null;
}

function packetUnsupportedActions(packet) {
  if (!Array.isArray(packet?.unsupportedActions)) return { ok: true };
  const required = new Set([
    "call_adjacent_repo",
    "execute",
    "schedule_work",
    "publish_to_mesh",
    "admit_writer",
    "grant_authority",
    "infer_mesh_participation",
    "infer_adjacent_truth"
  ]);
  const missing = [];
  for (const action of required) {
    if (!packet.unsupportedActions.includes(action)) missing.push(action);
  }
  return {
    ok: missing.length === 0,
    rejections: missing.map((action) => `unsupportedActions missing ${action}`)
  };
}

function findTrueFields(value, fields, path = "$", hits = []) {
  if (!isPlainObject(value) && !Array.isArray(value)) return hits;
  if (Array.isArray(value)) {
    for (let i = 0; i < value.length; i++) {
      findTrueFields(value[i], fields, `${path}[${i}]`, hits);
    }
    return hits;
  }
  for (const [key, child] of Object.entries(value)) {
    const childPath = `${path}.${key}`;
    if (fields.includes(key) && child === true) hits.push(childPath);
    if (isPlainObject(child) || Array.isArray(child)) findTrueFields(child, fields, childPath, hits);
  }
  return hits;
}

function findUnsafeWording(value, path = "$") {
  if (typeof value === "string") {
    if (isIgnoredWordingPath(path)) return null;
    const normalized = value.toLowerCase();
    for (const [status, phrases] of UNSAFE_WORDING_RULES) {
      for (const phrase of phrases) {
        if (normalized.includes(phrase)) return { status, phrase, path };
      }
    }
    return null;
  }
  if (Array.isArray(value)) {
    for (let i = 0; i < value.length; i++) {
      const hit = findUnsafeWording(value[i], `${path}[${i}]`);
      if (hit) return hit;
    }
    return null;
  }
  if (isPlainObject(value)) {
    for (const [key, child] of Object.entries(value)) {
      const hit = findUnsafeWording(child, `${path}.${key}`);
      if (hit) return hit;
    }
  }
  return null;
}

function isIgnoredWordingPath(path) {
  return IGNORED_WORDING_PATH_PREFIXES.some((prefix) => path === prefix || path.startsWith(`${prefix}[`));
}

function pickRefs(refs, fields) {
  const out = {};
  for (const field of fields) {
    if (Object.hasOwn(refs, field)) out[field] = cloneJsonValue(refs[field]);
  }
  return out;
}

function firstDefined(...values) {
  for (const value of values) {
    if (value !== undefined) return value;
  }
  return undefined;
}

function cloneJsonValue(value) {
  if (value === undefined) return undefined;
  if (value === null) return null;
  if (typeof value !== "object") return value;
  return JSON.parse(JSON.stringify(value));
}

function isPlainObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}
