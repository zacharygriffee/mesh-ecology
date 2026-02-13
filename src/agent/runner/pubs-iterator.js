import b4a from "b4a";

function createPubsIterator({
  concernBase,
  concernHex,
  acceptedByConcern,
  rememberAccepted,
  getPublishView,
  viewPubEncoding
}) {
  // INTENT(phase1-style): Stream accepted PUB leaves from the derived view and record per-concern dedupe markers.
  return (async function* iterateAcceptedPubs() {
    const publishView = getPublishView(concernBase);
    const seen = acceptedByConcern.get(concernHex) || new Set();
    for await (const jobEntry of publishView.createReadStream()) {
      const jobKey = jobEntry.key;
      if (!jobKey) continue;
      const jobSub = publishView.sub(jobKey);
      for await (const fromEntry of jobSub.createReadStream()) {
        const fromKey = fromEntry.key;
        if (!fromKey) continue;
        const attemptStream = jobSub.sub(fromKey).createReadStream({ valueEncoding: viewPubEncoding });
        for await (const { key: attemptKey, value } of attemptStream) {
          const attemptBuf = value?.ref?.a || attemptKey;
          const jobHex = b4a.toString(jobKey, "hex");
          const attemptHex = b4a.toString(attemptBuf, "hex");
          const id = `${jobHex}:${attemptHex}`;
          if (seen.has(id)) continue;
          rememberAccepted(concernHex, id);
          yield { jobKey, attempt: attemptBuf, value };
        }
      }
    }
  })();
}

export { createPubsIterator };
