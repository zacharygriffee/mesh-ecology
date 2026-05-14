import crypto from "crypto";
import net from "net";
import DHT from "hyperdht";
import ProtomuxRPC from "protomux-rpc";

const CONTACT_PROOF_SCHEMA = "mesh-v0-2/contact-proof/direct-peer/v1";
const CONTACT_PROOF_ARTIFACT_KIND = "mesh_contact_proof_evidence";
const CONTACT_PROOF_METHOD = "capability.echo";

async function runDirectContactProof({
  requestPayload = { capability: "contact-proof", input: "ping" },
  timeoutMs = 10_000
} = {}) {
  const started = Date.now();
  const requestId = `mesh-contact-request:${crypto.randomBytes(8).toString("hex")}`;
  const responseId = `mesh-contact-response:${crypto.randomBytes(8).toString("hex")}`;
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

  try {
    server = hostNode.createServer((socket) => {
      const rpc = new ProtomuxRPC(socket);
      serverRpcs.add(rpc);
      socket.once("close", () => serverRpcs.delete(rpc));
      socket.once("error", () => serverRpcs.delete(rpc));
      rpc.respond(CONTACT_PROOF_METHOD, (raw) => {
        const request = parseJsonBuffer(raw);
        return jsonBuffer({
          responseId,
          requestId: request.requestId,
          participant: "mesh-contact-host",
          capability: request.capability,
          received: request.input,
          ok: true
        });
      });
    });

    await withTimeout(server.listen(hostKeyPair), timeoutMs, "host-listen");
    contactAttempted = true;
    clientSocket = clientNode.connect(hostKeyPair.publicKey);
    clientRpc = new ProtomuxRPC(clientSocket);

    const rawResponse = await withTimeout(
      clientRpc.request(
        CONTACT_PROOF_METHOD,
        jsonBuffer({
          requestId,
          participant: "mesh-contact-client",
          ...requestPayload
        }),
        { timeout: timeoutMs }
      ),
      timeoutMs,
      "rpc-request"
    );
    responsePayload = parseJsonBuffer(rawResponse);
    contactSucceeded = responsePayload?.ok === true && responsePayload?.requestId === requestId;
    if (!contactSucceeded) {
      failureClass = "semantic_response_mismatch";
      failureMessage = "direct contact response did not preserve request identity";
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
      productionPreferred: false
    },
    readinessEvidence: {
      readinessScope: "direct_peer_contact",
      distributedReadinessClaimed: false
    },
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

function parseJsonBuffer(raw) {
  return JSON.parse(Buffer.from(raw).toString("utf8"));
}

function jsonBuffer(value) {
  return Buffer.from(JSON.stringify(value));
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
  CONTACT_PROOF_METHOD,
  CONTACT_PROOF_SCHEMA,
  runDirectContactProof
};
