import { setTimeout as delay } from "timers/promises";

function waitForCorePeers(core, { min = 1, timeoutMs }) {
  if (!core || typeof core.on !== "function") throw new Error("core EventEmitter required");
  if (!(timeoutMs > 0)) throw new Error("timeoutMs must be > 0");

  return new Promise((resolve, reject) => {
    const start = Date.now();
    let peerCount = core.peers ? core.peers.length : null;
    if (peerCount === null) {
      reject(new Error("core.peers not exposed; cannot track peer-add/peer-remove"));
      return;
    }
    const update = () => {
      peerCount = core.peers.length;
      if (peerCount >= min) finish(true);
    };
    const finish = (reached) => {
      cleanup();
      resolve({ reached, peers: peerCount, elapsedMs: Date.now() - start });
    };
    const cleanup = () => {
      core.off?.("peer-add", update);
      core.off?.("peer-remove", update);
    };
    core.on("peer-add", update);
    core.on("peer-remove", update);
    update();
    delay(timeoutMs).then(() => finish(peerCount >= min));
  });
}

function waitForCoreAppend(core, { timeoutMs }) {
  if (!core || typeof core.on !== "function") throw new Error("core EventEmitter required");
  if (!(timeoutMs > 0)) throw new Error("timeoutMs must be > 0");
  return new Promise((resolve) => {
    const start = Date.now();
    const done = () => {
      cleanup();
      resolve({ appended: true, length: core.length, elapsedMs: Date.now() - start });
    };
    const cleanup = () => {
      core.off?.("append", done);
    };
    core.on("append", done);
    delay(timeoutMs).then(() => {
      cleanup();
      resolve({ appended: false, length: core.length, elapsedMs: Date.now() - start });
    });
  });
}

function waitForCoreAppendWithData(core, { timeoutMs, predicate }) {
  if (!core || typeof core.on !== "function") throw new Error("core EventEmitter required");
  if (!(timeoutMs > 0)) throw new Error("timeoutMs must be > 0");
  const pred = predicate || ((data) => data != null && data !== false);
  return new Promise((resolve) => {
    const start = Date.now();
    let settled = false;
    const cleanup = () => {
      core.off?.("append", onAppend);
    };
    const finish = (appended, data) => {
      if (settled) return;
      settled = true;
      cleanup();
      resolve({ appended, data, length: core.length, elapsedMs: Date.now() - start });
    };
    const onAppend = async () => {
      try {
        const idx = core.length - 1;
        const data = await core.get(idx);
        if (pred(data)) finish(true, data);
      } catch {
        // ignore read errors, keep waiting
      }
    };
    core.on("append", onAppend);
    delay(timeoutMs).then(() => finish(false, null));
  });
}

export { waitForCorePeers, waitForCoreAppend, waitForCoreAppendWithData };
