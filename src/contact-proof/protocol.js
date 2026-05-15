import {
  Router,
  decode as decodeDispatchMessage,
  encode as encodeDispatchMessage,
  version as dispatchVersion
} from "../../protocol/contact-proof/hyperdispatch/index.js";
import {
  decode as decodeProtocolMessage,
  encode as encodeProtocolMessage,
  version as protocolVersion
} from "../../protocol/contact-proof/hyperschema/index.js";

const CONTACT_PROTOCOL_FAMILY = "mesh-contact-proof";
const CONTACT_PROTOCOL_SCHEMA = "mesh-v0-2/contact-proof/direct-peer/v1";
const CONTACT_PROOF_REQUEST_ENCODING = "@mesh-contact/contact-proof-request";
const CONTACT_PROOF_RESPONSE_ENCODING = "@mesh-contact/contact-proof-response";
const CONTACT_PROOF_EVIDENCE_ENCODING = "@mesh-contact/contact-proof-evidence";
const CONTACT_PROOF_DISPATCH_COMMAND = "@mesh-contact/capability-echo";
const CONTACT_PROOF_CAPABILITY = "contact-proof";
const CONTACT_PROOF_METHOD = "capability.echo";
const CONTACT_PROOF_CAPABILITY_SCOPE = "bounded_direct_participant_contact";
const PARTICIPANT_CAPABILITIES_REQUEST_ENCODING = "@mesh-contact/participant-capabilities-request";
const PARTICIPANT_CAPABILITIES_RESPONSE_ENCODING = "@mesh-contact/participant-capabilities-response";
const PARTICIPANT_CAPABILITIES_DISPATCH_COMMAND = "@mesh-contact/participant-capabilities-get";
const PARTICIPANT_CAPABILITIES_METHOD = "participant.capabilities.get";

function createContactProofCapabilityDescriptor() {
  return {
    capability: CONTACT_PROOF_CAPABILITY,
    methodName: CONTACT_PROOF_METHOD,
    dispatchCommand: CONTACT_PROOF_DISPATCH_COMMAND,
    requestEncoding: CONTACT_PROOF_REQUEST_ENCODING,
    responseEncoding: CONTACT_PROOF_RESPONSE_ENCODING,
    protocolFamily: CONTACT_PROTOCOL_FAMILY,
    protocolSchema: CONTACT_PROTOCOL_SCHEMA,
    ownerRepo: "mesh-v0-2",
    proofScope: CONTACT_PROOF_CAPABILITY_SCOPE,
    transportKind: "protomux-rpc",
    contactSeam: "hyperdht_direct_peer",
    localLayerDefault: true,
    meshLayerDefault: false,
    discoveryRequired: false,
    participantContact: true
  };
}

function encodeContactProofRequest(value) {
  return encodeDispatchMessage(CONTACT_PROOF_DISPATCH_COMMAND, value);
}

function decodeContactProofRequest(value) {
  const decoded = decodeDispatchMessage(value);
  if (decoded.name !== CONTACT_PROOF_DISPATCH_COMMAND) {
    throw new Error(`unexpected contact proof dispatch command: ${decoded.name}`);
  }
  return decoded.value;
}

async function dispatchContactProofRequest(value, handler) {
  const router = new Router();
  router.add(CONTACT_PROOF_DISPATCH_COMMAND, handler);
  router.add(PARTICIPANT_CAPABILITIES_DISPATCH_COMMAND, () => {
    throw new Error(`unexpected participant capabilities dispatch on ${CONTACT_PROOF_DISPATCH_COMMAND}`);
  });
  return await router.dispatch(value);
}

function encodeParticipantCapabilitiesRequest(value) {
  return encodeDispatchMessage(PARTICIPANT_CAPABILITIES_DISPATCH_COMMAND, value);
}

function decodeParticipantCapabilitiesRequest(value) {
  const decoded = decodeDispatchMessage(value);
  if (decoded.name !== PARTICIPANT_CAPABILITIES_DISPATCH_COMMAND) {
    throw new Error(`unexpected participant capabilities dispatch command: ${decoded.name}`);
  }
  return decoded.value;
}

async function dispatchParticipantCapabilitiesRequest(value, handler) {
  const router = new Router();
  router.add(CONTACT_PROOF_DISPATCH_COMMAND, () => {
    throw new Error(`unexpected contact proof dispatch on ${PARTICIPANT_CAPABILITIES_DISPATCH_COMMAND}`);
  });
  router.add(PARTICIPANT_CAPABILITIES_DISPATCH_COMMAND, handler);
  return await router.dispatch(value);
}

function encodeContactProofResponse(value) {
  return encodeProtocolMessage(CONTACT_PROOF_RESPONSE_ENCODING, value);
}

function decodeContactProofResponse(value) {
  return decodeProtocolMessage(CONTACT_PROOF_RESPONSE_ENCODING, value);
}

function encodeParticipantCapabilitiesResponse(value) {
  return encodeProtocolMessage(PARTICIPANT_CAPABILITIES_RESPONSE_ENCODING, value);
}

function decodeParticipantCapabilitiesResponse(value) {
  return decodeProtocolMessage(PARTICIPANT_CAPABILITIES_RESPONSE_ENCODING, value);
}

function encodeContactProofEvidence(value) {
  return encodeProtocolMessage(CONTACT_PROOF_EVIDENCE_ENCODING, value);
}

function decodeContactProofEvidence(value) {
  return decodeProtocolMessage(CONTACT_PROOF_EVIDENCE_ENCODING, value);
}

export {
  CONTACT_PROOF_CAPABILITY,
  CONTACT_PROOF_CAPABILITY_SCOPE,
  CONTACT_PROOF_DISPATCH_COMMAND,
  CONTACT_PROOF_EVIDENCE_ENCODING,
  CONTACT_PROOF_METHOD,
  CONTACT_PROOF_REQUEST_ENCODING,
  CONTACT_PROOF_RESPONSE_ENCODING,
  CONTACT_PROTOCOL_FAMILY,
  CONTACT_PROTOCOL_SCHEMA,
  PARTICIPANT_CAPABILITIES_DISPATCH_COMMAND,
  PARTICIPANT_CAPABILITIES_METHOD,
  PARTICIPANT_CAPABILITIES_REQUEST_ENCODING,
  PARTICIPANT_CAPABILITIES_RESPONSE_ENCODING,
  createContactProofCapabilityDescriptor,
  decodeContactProofEvidence,
  decodeContactProofRequest,
  decodeContactProofResponse,
  decodeParticipantCapabilitiesRequest,
  decodeParticipantCapabilitiesResponse,
  dispatchContactProofRequest,
  dispatchParticipantCapabilitiesRequest,
  dispatchVersion,
  encodeContactProofEvidence,
  encodeContactProofRequest,
  encodeContactProofResponse,
  encodeParticipantCapabilitiesRequest,
  encodeParticipantCapabilitiesResponse,
  protocolVersion
};
