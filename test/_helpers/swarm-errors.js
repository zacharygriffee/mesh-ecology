const MAX_TRANSPORT_ERROR_SAMPLES = 5;

function attachSwarmConnectionErrorSink({ swarm, evidence, getPhase, label }) {
  if (!swarm || typeof swarm.on !== "function") return () => {};

  const bucket = ensureTransportErrorsBucket(evidence);
  let detached = false;

  const onConn = (stream, info) => {
    if (!stream || typeof stream.on !== "function") return;
    const peer = formatPeer(info);

    stream.on("error", (err) => {
      bucket.count += 1;
      if (bucket.samples.length >= MAX_TRANSPORT_ERROR_SAMPLES) return;
      bucket.samples.push({
        when: Date.now(),
        phase: safePhase(getPhase),
        code: err?.code || null,
        message: err?.message || String(err),
        peer,
        label: label || null
      });
    });
  };

  swarm.on("connection", onConn);

  return () => {
    if (detached) return;
    detached = true;
    if (typeof swarm.off === "function") {
      swarm.off("connection", onConn);
      return;
    }
    if (typeof swarm.removeListener === "function") {
      swarm.removeListener("connection", onConn);
    }
  };
}

function ensureTransportErrorsBucket(evidence) {
  if (!evidence || typeof evidence !== "object") {
    return { count: 0, samples: [] };
  }
  if (!evidence.transportErrors || typeof evidence.transportErrors !== "object") {
    evidence.transportErrors = { count: 0, samples: [] };
    return evidence.transportErrors;
  }
  if (!Array.isArray(evidence.transportErrors.samples)) evidence.transportErrors.samples = [];
  if (typeof evidence.transportErrors.count !== "number") evidence.transportErrors.count = 0;
  return evidence.transportErrors;
}

function safePhase(getPhase) {
  if (typeof getPhase !== "function") return "unknown";
  try {
    return getPhase() || "unknown";
  } catch {
    return "unknown";
  }
}

function formatPeer(info) {
  const peer = info?.publicKey || info?.id || null;
  if (!peer) return null;
  if (typeof peer === "string") return peer;
  if (Buffer.isBuffer(peer)) return peer.toString("hex");
  if (peer?.buffer && Buffer.isBuffer(peer.buffer)) return peer.buffer.toString("hex");
  return String(peer);
}

export { attachSwarmConnectionErrorSink };
