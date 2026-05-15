import test from "brittle";
import {
  CONTACT_PROOF_CAPABILITY,
  CONTACT_PROOF_CAPABILITY_SCOPE,
  CONTACT_PROOF_DISPATCH_COMMAND,
  CONTACT_PROOF_METHOD,
  CONTACT_PROOF_REQUEST_ENCODING,
  CONTACT_PROOF_RESPONSE_ENCODING,
  CONTACT_PROTOCOL_FAMILY,
  CONTACT_PROTOCOL_SCHEMA,
  createContactProofCapabilityDescriptor,
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
    capability: CONTACT_PROOF_CAPABILITY,
    input: "ping"
  };
  const encodedRequest = encodeContactProofRequest(request);
  const decodedRequest = decodeContactProofRequest(encodedRequest);

  t.alike(decodedRequest, request);
  t.is(protocolVersion, 2);
  t.is(dispatchVersion, 2);

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
    operation: CONTACT_PROOF_METHOD,
    methodName: CONTACT_PROOF_METHOD,
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
    capabilityDescriptor: createContactProofCapabilityDescriptor(),
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
  t.is(decodedEvidence.capabilityDescriptor.capability, CONTACT_PROOF_CAPABILITY);
  t.is(decodedEvidence.capabilityDescriptor.methodName, CONTACT_PROOF_METHOD);
  t.is(decodedEvidence.capabilityDescriptor.proofScope, CONTACT_PROOF_CAPABILITY_SCOPE);
  t.is(decodedEvidence.capabilityDescriptor.ownerRepo, "mesh-v0-2");
  t.is(decodedEvidence.capabilityDescriptor.localLayerDefault, true);
  t.is(decodedEvidence.capabilityDescriptor.meshLayerDefault, false);
  t.is(decodedEvidence.capabilityDescriptor.discoveryRequired, false);
  t.is(decodedEvidence.selectedTransport.participantContact, true);
  t.is(decodedEvidence.readinessEvidence.distributedReadinessClaimed, false);
});
