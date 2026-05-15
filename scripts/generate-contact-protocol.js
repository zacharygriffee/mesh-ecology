import Hyperdispatch from "hyperdispatch";
import Hyperschema from "hyperschema";

const SCHEMA_DIR = new URL("../protocol/contact-proof/hyperschema/", import.meta.url).pathname;
const DISPATCH_DIR = new URL("../protocol/contact-proof/hyperdispatch/", import.meta.url).pathname;

const schema = Hyperschema.from(SCHEMA_DIR);
const contact = schema.namespace("mesh-contact");

contact.register({
  name: "transport-descriptor",
  fields: [
    { name: "transportKind", type: "string", required: true },
    { name: "contactSeam", type: "string", required: true },
    { name: "transportRole", type: "string", required: true },
    { name: "scope", type: "string", required: true },
    { name: "scaffoldTransport", type: "bool" },
    { name: "compatibilityAlias", type: "bool" },
    { name: "productionPreferred", type: "bool" },
    { name: "operatorSupplied", type: "bool" },
    { name: "portExposureRequired", type: "bool" },
    { name: "participantContact", type: "bool" }
  ]
});

contact.register({
  name: "readiness-evidence",
  fields: [
    { name: "readinessScope", type: "string", required: true },
    { name: "distributedReadinessClaimed", type: "bool" },
    { name: "serviceBackendClaimed", type: "bool" }
  ]
});

contact.register({
  name: "capability-descriptor",
  fields: [
    { name: "capability", type: "string", required: true },
    { name: "methodName", type: "string", required: true },
    { name: "dispatchCommand", type: "string", required: true },
    { name: "requestEncoding", type: "string", required: true },
    { name: "responseEncoding", type: "string", required: true },
    { name: "protocolFamily", type: "string", required: true },
    { name: "protocolSchema", type: "string", required: true },
    { name: "ownerRepo", type: "string", required: true },
    { name: "proofScope", type: "string", required: true },
    { name: "transportKind", type: "string", required: true },
    { name: "contactSeam", type: "string", required: true },
    { name: "localLayerDefault", type: "bool" },
    { name: "meshLayerDefault", type: "bool" },
    { name: "discoveryRequired", type: "bool" },
    { name: "participantContact", type: "bool" }
  ]
});

contact.register({
  name: "contact-proof-request",
  fields: [
    { name: "requestId", type: "string", required: true },
    { name: "participant", type: "string", required: true },
    { name: "capability", type: "string", required: true },
    { name: "input", type: "string", required: true }
  ]
});

contact.register({
  name: "contact-proof-response",
  fields: [
    { name: "responseId", type: "string", required: true },
    { name: "requestId", type: "string", required: true },
    { name: "participant", type: "string", required: true },
    { name: "capability", type: "string", required: true },
    { name: "received", type: "string", required: true },
    { name: "ok", type: "bool" }
  ]
});

contact.register({
  name: "participant-capabilities-request",
  fields: [
    { name: "requestId", type: "string", required: true },
    { name: "participant", type: "string", required: true }
  ]
});

contact.register({
  name: "participant-capabilities-response",
  fields: [
    { name: "responseId", type: "string", required: true },
    { name: "requestId", type: "string", required: true },
    { name: "participant", type: "string", required: true },
    { name: "protocolFamily", type: "string", required: true },
    { name: "protocolSchema", type: "string", required: true },
    { name: "capabilities", type: "@mesh-contact/capability-descriptor", array: true, required: true }
  ]
});

contact.register({
  name: "contact-proof-evidence",
  fields: [
    { name: "artifactKind", type: "string", required: true },
    { name: "schema", type: "string", required: true },
    { name: "protocolFamily", type: "string", required: true },
    { name: "protocolSchema", type: "string", required: true },
    { name: "requestEncoding", type: "string", required: true },
    { name: "responseEncoding", type: "string", required: true },
    { name: "dispatchCommand", type: "string", required: true },
    { name: "proofKind", type: "string", required: true },
    { name: "transportKind", type: "string", required: true },
    { name: "contactSeam", type: "string", required: true },
    { name: "participantA", type: "string", required: true },
    { name: "participantB", type: "string", required: true },
    { name: "operation", type: "string", required: true },
    { name: "methodName", type: "string", required: true },
    { name: "requestId", type: "string", required: true },
    { name: "responseId", type: "string", required: true },
    { name: "hostPublicKey", type: "string", required: true },
    { name: "selectedTransport", type: "@mesh-contact/transport-descriptor", required: true },
    { name: "readinessEvidence", type: "@mesh-contact/readiness-evidence", required: true },
    { name: "contactAttempted", type: "bool" },
    { name: "contactSucceeded", type: "bool" },
    { name: "distributedReadinessClaimed", type: "bool" },
    { name: "elapsedMs", type: "uint" },
    { name: "failureClass", type: "string" },
    { name: "failureMessage", type: "string" },
    { name: "capabilityDescriptor", type: "@mesh-contact/capability-descriptor" },
    { name: "capabilityAdvertisement", type: "@mesh-contact/participant-capabilities-response" }
  ]
});

Hyperschema.toDisk(schema, SCHEMA_DIR, { esm: true });

const hyperdispatch = Hyperdispatch.from(SCHEMA_DIR, DISPATCH_DIR);
const dispatch = hyperdispatch.namespace("mesh-contact");

dispatch.register({
  name: "capability-echo",
  requestType: "@mesh-contact/contact-proof-request"
});

dispatch.register({
  name: "participant-capabilities-get",
  requestType: "@mesh-contact/participant-capabilities-request"
});

Hyperdispatch.toDisk(hyperdispatch, DISPATCH_DIR, { esm: true });
