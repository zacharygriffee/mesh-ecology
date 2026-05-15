import crypto from "crypto";
import net from "net";
import DHT from "hyperdht";
import ProtomuxRPC from "protomux-rpc";
import {
  CONTACT_PROOF_CAPABILITY,
  CONTACT_PROOF_CAPABILITY_SCOPE,
  CONTACT_PROOF_DISPATCH_COMMAND,
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
  decodeContactProofResponse,
  decodeParticipantCapabilitiesResponse,
  dispatchContactProofRequest,
  dispatchParticipantCapabilitiesRequest,
  dispatchVersion,
  encodeContactProofRequest,
  encodeContactProofResponse,
  encodeParticipantCapabilitiesRequest,
  encodeParticipantCapabilitiesResponse,
  protocolVersion
} from "./protocol.js";

const CONTACT_PROOF_SCHEMA = "mesh-v0-2/contact-proof/direct-peer/v1";
const CONTACT_PROOF_ARTIFACT_KIND = "mesh_contact_proof_evidence";

async function runDirectContactProof({
  requestPayload = { capability: CONTACT_PROOF_CAPABILITY, input: "ping" },
  timeoutMs = 10_000
} = {}) {
  const started = Date.now();
  const requestId = `mesh-contact-request:${crypto.randomBytes(8).toString("hex")}`;
  const responseId = `mesh-contact-response:${crypto.randomBytes(8).toString("hex")}`;
  const capabilityRequestId = `mesh-capabilities-request:${crypto.randomBytes(8).toString("hex")}`;
  const capabilityResponseId = `mesh-capabilities-response:${crypto.randomBytes(8).toString("hex")}`;
  const port = await allocateTcpPort();
  const bootstrapNode = `127.0.0.1:${port}`;
  const bootstrap = DHT.bootstrapper(port, "127.0.0.1");
  const hostNode = new DHT({ bootstrap: [bootstrapNode] });
  const clientNode = new DHT({ bootstrap: [bootstrapNode] });
  const hostKeyPair = DHT.keyPair();
  const serverRpcs = new Set();
  let server;
  let clientSocket;
  let clientRpc;
  let contactAttempted = false;
  let contactSucceeded = false;
  let failureClass = null;
  let failureMessage = null;
  let responsePayload = null;
  let capabilityAdvertisement = null;

  try {
    server = hostNode.createServer((socket) => {
      const rpc = new ProtomuxRPC(socket);
      serverRpcs.add(rpc);
      socket.once("close", () => serverRpcs.delete(rpc));
      socket.once("error", () => serverRpcs.delete(rpc));
      rpc.respond(CONTACT_PROOF_METHOD, async (raw) => {
        const response = await dispatchContactProofRequest(raw, (request) => ({
          responseId,
          requestId: request.requestId,
          participant: "mesh-contact-host",
          capability: request.capability,
          received: request.input,
          ok: true
        }));
        return encodeContactProofResponse(response);
      });
      rpc.respond(PARTICIPANT_CAPABILITIES_METHOD, async (raw) => {
        const response = await dispatchParticipantCapabilitiesRequest(raw, (request) => ({
          responseId: capabilityResponseId,
          requestId: request.requestId,
          participant: "mesh-contact-host",
          protocolFamily: CONTACT_PROTOCOL_FAMILY,
          protocolSchema: CONTACT_PROTOCOL_SCHEMA,
          capabilities: [createContactProofCapabilityDescriptor()]
        }));
        return encodeParticipantCapabilitiesResponse(response);
      });
    });

    await withTimeout(server.listen(hostKeyPair), timeoutMs, "host-listen");
    contactAttempted = true;
    clientSocket = clientNode.connect(hostKeyPair.publicKey);
    clientRpc = new ProtomuxRPC(clientSocket);

    const rawResponse = await withTimeout(
      clientRpc.request(
        CONTACT_PROOF_METHOD,
        encodeContactProofRequest({
          requestId,
          participant: "mesh-contact-client",
          ...requestPayload
        }),
        { timeout: timeoutMs }
      ),
      timeoutMs,
      "rpc-request"
    );
    responsePayload = decodeContactProofResponse(rawResponse);
    const rawCapabilityAdvertisement = await withTimeout(
      clientRpc.request(
        PARTICIPANT_CAPABILITIES_METHOD,
        encodeParticipantCapabilitiesRequest({
          requestId: capabilityRequestId,
          participant: "mesh-contact-client"
        }),
        { timeout: timeoutMs }
      ),
      timeoutMs,
      "capabilities-request"
    );
    capabilityAdvertisement = decodeParticipantCapabilitiesResponse(rawCapabilityAdvertisement);
    const capabilityAdvertisementSucceeded =
      capabilityAdvertisement?.requestId === capabilityRequestId &&
      capabilityAdvertisement?.capabilities?.some((capability) =>
        capability?.capability === CONTACT_PROOF_CAPABILITY &&
        capability?.methodName === CONTACT_PROOF_METHOD &&
        capability?.contactSeam === "hyperdht_direct_peer"
      ) === true;
    contactSucceeded = responsePayload?.ok === true &&
      responsePayload?.requestId === requestId &&
      capabilityAdvertisementSucceeded;
    if (!contactSucceeded) {
      failureClass = "semantic_response_mismatch";
      failureMessage = "direct contact response or capability advertisement did not preserve expected identity";
    }
  } catch (err) {
    failureClass = classifyContactFailure(err);
    failureMessage = err?.message || String(err);
  } finally {
    await closeDirectContactResources({ clientRpc, clientSocket, serverRpcs, server, hostNode, clientNode, bootstrap });
  }

  return {
    artifactKind: CONTACT_PROOF_ARTIFACT_KIND,
    schema: CONTACT_PROOF_SCHEMA,
    protocolFamily: CONTACT_PROTOCOL_FAMILY,
    protocolSchema: CONTACT_PROTOCOL_SCHEMA,
    protocolSchemaVersion: protocolVersion,
    dispatchVersion,
    requestEncoding: CONTACT_PROOF_REQUEST_ENCODING,
    responseEncoding: CONTACT_PROOF_RESPONSE_ENCODING,
    dispatchCommand: CONTACT_PROOF_DISPATCH_COMMAND,
    capabilitiesRequestEncoding: PARTICIPANT_CAPABILITIES_REQUEST_ENCODING,
    capabilitiesResponseEncoding: PARTICIPANT_CAPABILITIES_RESPONSE_ENCODING,
    capabilitiesDispatchCommand: PARTICIPANT_CAPABILITIES_DISPATCH_COMMAND,
    proofKind: "mesh_contact_direct_peer_lab",
    transportKind: "protomux-rpc",
    contactSeam: "hyperdht_direct_peer",
    participantA: "mesh-contact-host",
    participantB: "mesh-contact-client",
    operation: CONTACT_PROOF_METHOD,
    methodName: CONTACT_PROOF_METHOD,
    requestId,
    responseId: responsePayload?.responseId || responseId,
    hostPublicKey: Buffer.from(hostKeyPair.publicKey).toString("hex"),
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
      distributedReadinessClaimed: false
    },
    capabilityDescriptor: createContactProofCapabilityDescriptor(),
    capabilityAdvertisement,
    bootstrapNodes: [bootstrapNode],
    contactAttempted,
    contactSucceeded,
    distributedReadinessClaimed: false,
    elapsedMs: Date.now() - started,
    response: responsePayload,
    failureClass,
    failureMessage
  };
}

function classifyContactFailure(err) {
  const code = err?.code || "";
  const message = err?.message || String(err);
  if (code === "ERR_DIRECT_CONTACT_TIMEOUT") return "contact_timeout";
  if (/timeout/i.test(message)) return "contact_timeout";
  if (/listen/i.test(message)) return "host_listen_failure";
  if (/rpc|request/i.test(message)) return "rpc_contact_failure";
  return "contact_failure";
}

async function withTimeout(promise, timeoutMs, phase) {
  let timer;
  try {
    return await Promise.race([
      promise,
      new Promise((_, reject) => {
        timer = setTimeout(() => {
          const err = new Error(`${phase} timed out after ${timeoutMs}ms`);
          err.code = "ERR_DIRECT_CONTACT_TIMEOUT";
          err.phase = phase;
          reject(err);
        }, timeoutMs);
      })
    ]);
  } finally {
    clearTimeout(timer);
  }
}

async function allocateTcpPort() {
  return await new Promise((resolve, reject) => {
    const server = net.createServer();
    server.on("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      const port = address && typeof address === "object" ? address.port : null;
      server.close(() => {
        if (port) resolve(port);
        else reject(new Error("could not allocate local bootstrap port"));
      });
    });
  });
}

async function closeDirectContactResources({ clientRpc, clientSocket, serverRpcs, server, hostNode, clientNode, bootstrap }) {
  if (clientRpc) {
    try {
      clientRpc.destroy();
    } catch {}
  }
  if (clientSocket) {
    try {
      clientSocket.destroy();
    } catch {}
  }
  for (const rpc of serverRpcs || []) {
    try {
      rpc.destroy();
    } catch {}
  }
  await server?.close?.().catch(() => {});
  await clientNode?.destroy?.({ force: true }).catch(() => {});
  await hostNode?.destroy?.({ force: true }).catch(() => {});
  await bootstrap?.destroy?.().catch(() => {});
}

export {
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
  PARTICIPANT_CAPABILITIES_DISPATCH_COMMAND,
  PARTICIPANT_CAPABILITIES_METHOD,
  PARTICIPANT_CAPABILITIES_REQUEST_ENCODING,
  PARTICIPANT_CAPABILITIES_RESPONSE_ENCODING,
  runDirectContactProof
};
