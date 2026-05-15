import test from "brittle";
import {
  CONTACT_PROOF_ARTIFACT_KIND,
  CONTACT_PROOF_CAPABILITY,
  CONTACT_PROOF_CAPABILITY_SCOPE,
  CONTACT_PROOF_DISPATCH_COMMAND,
  CONTACT_PROOF_METHOD,
  CONTACT_PROOF_REQUEST_ENCODING,
  CONTACT_PROOF_RESPONSE_ENCODING,
  CONTACT_PROOF_SCHEMA,
  CONTACT_PROTOCOL_FAMILY,
  CONTACT_PROTOCOL_SCHEMA,
  runDirectContactProof
} from "../_helpers/direct-contact-proof.js";

test("lab-contact-proof.direct-peer proves bounded Protomux RPC over HyperDHT direct peer", { timeout: 20_000 }, async (t) => {
  const evidence = await runDirectContactProof({ timeoutMs: 10_000 });

  t.is(evidence.artifactKind, CONTACT_PROOF_ARTIFACT_KIND);
  t.is(evidence.schema, CONTACT_PROOF_SCHEMA);
  t.is(evidence.protocolFamily, CONTACT_PROTOCOL_FAMILY);
  t.is(evidence.protocolSchema, CONTACT_PROTOCOL_SCHEMA);
  t.is(evidence.requestEncoding, CONTACT_PROOF_REQUEST_ENCODING);
  t.is(evidence.responseEncoding, CONTACT_PROOF_RESPONSE_ENCODING);
  t.is(evidence.dispatchCommand, CONTACT_PROOF_DISPATCH_COMMAND);
  t.is(evidence.protocolSchemaVersion, 2);
  t.is(evidence.dispatchVersion, 2);
  t.is(evidence.proofKind, "mesh_contact_direct_peer_lab");
  t.is(evidence.transportKind, "protomux-rpc");
  t.is(evidence.contactSeam, "hyperdht_direct_peer");
  t.is(evidence.operation, CONTACT_PROOF_METHOD);
  t.is(evidence.capabilityDescriptor.capability, CONTACT_PROOF_CAPABILITY);
  t.is(evidence.capabilityDescriptor.methodName, CONTACT_PROOF_METHOD);
  t.is(evidence.capabilityDescriptor.dispatchCommand, CONTACT_PROOF_DISPATCH_COMMAND);
  t.is(evidence.capabilityDescriptor.requestEncoding, CONTACT_PROOF_REQUEST_ENCODING);
  t.is(evidence.capabilityDescriptor.responseEncoding, CONTACT_PROOF_RESPONSE_ENCODING);
  t.is(evidence.capabilityDescriptor.protocolFamily, CONTACT_PROTOCOL_FAMILY);
  t.is(evidence.capabilityDescriptor.protocolSchema, CONTACT_PROTOCOL_SCHEMA);
  t.is(evidence.capabilityDescriptor.ownerRepo, "mesh-v0-2");
  t.is(evidence.capabilityDescriptor.proofScope, CONTACT_PROOF_CAPABILITY_SCOPE);
  t.is(evidence.capabilityDescriptor.transportKind, "protomux-rpc");
  t.is(evidence.capabilityDescriptor.contactSeam, "hyperdht_direct_peer");
  t.is(evidence.capabilityDescriptor.localLayerDefault, true);
  t.is(evidence.capabilityDescriptor.meshLayerDefault, false);
  t.is(evidence.capabilityDescriptor.discoveryRequired, false);
  t.is(evidence.capabilityDescriptor.participantContact, true);
  t.is(evidence.selectedTransport.transportKind, "protomux-rpc");
  t.is(evidence.selectedTransport.contactSeam, "hyperdht_direct_peer");
  t.is(evidence.selectedTransport.transportRole, "proof_lane");
  t.is(evidence.selectedTransport.scope, "isolated_local_hyperdht");
  t.is(evidence.selectedTransport.scaffoldTransport, false);
  t.is(evidence.selectedTransport.compatibilityAlias, false);
  t.is(evidence.selectedTransport.productionPreferred, false);
  t.is(evidence.selectedTransport.operatorSupplied, false);
  t.is(evidence.selectedTransport.portExposureRequired, false);
  t.is(evidence.selectedTransport.participantContact, true);
  t.is(evidence.readinessEvidence.readinessScope, "direct_peer_contact");
  t.is(evidence.readinessEvidence.distributedReadinessClaimed, false);
  t.is(evidence.distributedReadinessClaimed, false);
  t.is(evidence.contactAttempted, true);
  t.is(evidence.contactSucceeded, true, evidence.failureMessage || "contact should succeed");
  t.ok(typeof evidence.hostPublicKey === "string" && evidence.hostPublicKey.length === 64);
  t.ok(evidence.elapsedMs >= 0);
  t.is(evidence.failureClass, null);
  t.is(evidence.failureMessage, null);
  t.is(evidence.response.requestId, evidence.requestId);
  t.is(evidence.response.responseId, evidence.responseId);
  t.is(evidence.response.participant, "mesh-contact-host");
  t.is(evidence.response.capability, "contact-proof");
  t.is(evidence.response.received, "ping");
});
