function createLabResources(t) {
  const entries = [];
  let cleaned = false;
  let lastSummary = { opened: 0, closed: 0, leaked: 0 };

  function track(type, obj, closeFn) {
    if (!obj) return obj;
    entries.push({
      type,
      obj,
      closeFn: closeFn || defaultClose(type, obj),
      closed: false
    });
    return obj;
  }

  function trackCorestore(store) {
    return track("corestore", store, async (s) => {
      await s.close();
    });
  }

  function trackSwarm(swarm) {
    return track("swarm", swarm, async (s) => {
      await s.close?.();
      s.destroy?.();
    });
  }

  function trackBase(base) {
    return track("base", base, async (b) => {
      await b.close?.();
    });
  }

  function trackAutobase(base) {
    return track("autobase", base, async (b) => {
      await b.close?.();
    });
  }

  function trackView(view) {
    return track("view", view, async (v) => {
      await v.close?.();
    });
  }

  function trackStream(stream) {
    return track("stream", stream, async (s) => {
      if (typeof s.end === "function") s.end();
      if (typeof s.destroy === "function") s.destroy();
      if (typeof s.close === "function") await s.close();
    });
  }

  async function cleanup() {
    if (cleaned) return lastSummary;
    cleaned = true;

    let closed = 0;
    let leaked = 0;

    for (let i = entries.length - 1; i >= 0; i--) {
      const entry = entries[i];
      if (entry.closed) continue;
      try {
        if (entry.closeFn) {
          await entry.closeFn(entry.obj);
          closed += 1;
        } else {
          leaked += 1;
        }
      } catch {
        leaked += 1;
      } finally {
        entry.closed = true;
      }
    }

    lastSummary = {
      opened: entries.length,
      closed,
      leaked
    };
    return lastSummary;
  }

  if (t?.teardown) t.teardown(() => cleanup());

  return {
    track,
    trackCorestore,
    trackSwarm,
    trackBase,
    trackAutobase,
    trackView,
    trackStream,
    cleanup
  };
}

function defaultClose(type, obj) {
  if (!obj) return null;
  if (type === "stream") {
    return async (s) => {
      if (typeof s.end === "function") s.end();
      if (typeof s.destroy === "function") s.destroy();
      if (typeof s.close === "function") await s.close();
    };
  }
  if (typeof obj.close === "function") {
    return async (x) => {
      await x.close();
    };
  }
  if (typeof obj.destroy === "function") {
    return async (x) => {
      x.destroy();
    };
  }
  return null;
}

export { createLabResources };
