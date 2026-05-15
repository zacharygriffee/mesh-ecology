import test from "brittle";
import {
  CONTACT_PROOF_DISPATCH_COMMAND,
  CONTACT_PROOF_REQUEST_ENCODING,
  CONTACT_PROOF_RESPONSE_ENCODING,
  CONTACT_PROTOCOL_FAMILY,
  CONTACT_PROTOCOL_SCHEMA,
  decodeContactProofEvidence,
  decodeContactProofRequest,
  decodeContactProofResponse,
  dispatchContactProofRequest,
  dispatchVersion,
  encodeContactProofEvidence,
  encodeContactProofRequest,
  encodeContactProofResponse,
  protocolVersion
} from "../../src/contact-proof/protocol.js";

test("contact proof protocol encodes request response and evidence with stable markers", async (t) => {
  const request = {
    requestId: "mesh-contact-request:test",
    participant: "mesh-contact-client",
    capability: "contact-proof",
    input: "ping"
  };
  const encodedRequest = encodeContactProofRequest(request);
  const decodedRequest = decodeContactProofRequest(encodedRequest);

  t.alike(decodedRequest, request);
  t.is(protocolVersion, 1);
  t.is(dispatchVersion, 1);

  const dispatched = await dispatchContactProofRequest(encodedRequest, (message) => ({
    responseId: "mesh-contact-response:test",
    requestId: message.requestId,
    participant: "mesh-contact-host",
    capability: message.capability,
    received: message.input,
    ok: true
  }));
  const encodedResponse = encodeContactProofResponse(dispatched);
  const decodedResponse = decodeContactProofResponse(encodedResponse);

  t.is(decodedResponse.requestId, request.requestId);
  t.is(decodedResponse.responseId, "mesh-contact-response:test");
  t.is(decodedResponse.ok, true);

  const evidence = {
    artifactKind: "mesh_contact_proof_evidence",
    schema: CONTACT_PROTOCOL_SCHEMA,
    protocolFamily: CONTACT_PROTOCOL_FAMILY,
    protocolSchema: CONTACT_PROTOCOL_SCHEMA,
    requestEncoding: CONTACT_PROOF_REQUEST_ENCODING,
    responseEncoding: CONTACT_PROOF_RESPONSE_ENCODING,
    dispatchCommand: CONTACT_PROOF_DISPATCH_COMMAND,
    proofKind: "mesh_contact_direct_peer_lab",
    transportKind: "protomux-rpc",
    contactSeam: "hyperdht_direct_peer",
    participantA: "mesh-contact-host",
    participantB: "mesh-contact-client",
    operation: "capability.echo",
    methodName: "capability.echo",
    requestId: request.requestId,
    responseId: decodedResponse.responseId,
    hostPublicKey: "a".repeat(64),
    selectedTransport: {
      transportKind: "protomux-rpc",
      contactSeam: "hyperdht_direct_peer",
      transportRole: "proof_lane",
      scope: "isolated_local_hyperdht",
      scaffoldTransport: false,
      compatibilityAlias: false,
      productionPreferred: false,
      operatorSupplied: false,
      portExposureRequired: false,
      participantContact: true
    },
    readinessEvidence: {
      readinessScope: "direct_peer_contact",
      distributedReadinessClaimed: false,
      serviceBackendClaimed: false
    },
    contactAttempted: true,
    contactSucceeded: true,
    distributedReadinessClaimed: false,
    elapsedMs: 1,
    failureClass: null,
    failureMessage: null
  };
  const decodedEvidence = decodeContactProofEvidence(encodeContactProofEvidence(evidence));

  t.is(decodedEvidence.protocolFamily, CONTACT_PROTOCOL_FAMILY);
  t.is(decodedEvidence.dispatchCommand, CONTACT_PROOF_DISPATCH_COMMAND);
  t.is(decodedEvidence.selectedTransport.participantContact, true);
  t.is(decodedEvidence.readinessEvidence.distributedReadinessClaimed, false);
});
