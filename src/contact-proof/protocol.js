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
  return await router.dispatch(value);
}

function encodeContactProofResponse(value) {
  return encodeProtocolMessage(CONTACT_PROOF_RESPONSE_ENCODING, value);
}

function decodeContactProofResponse(value) {
  return decodeProtocolMessage(CONTACT_PROOF_RESPONSE_ENCODING, value);
}

function encodeContactProofEvidence(value) {
  return encodeProtocolMessage(CONTACT_PROOF_EVIDENCE_ENCODING, value);
}

function decodeContactProofEvidence(value) {
  return decodeProtocolMessage(CONTACT_PROOF_EVIDENCE_ENCODING, value);
}

export {
  CONTACT_PROOF_DISPATCH_COMMAND,
  CONTACT_PROOF_EVIDENCE_ENCODING,
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
};
