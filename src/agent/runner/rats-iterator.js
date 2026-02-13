function createRatsIterator({
  concernBase,
  getRatView,
  viewRatEncoding
}) {
  // INTENT(phase1-style): Stream accepted RAT leaves from the derived rat view using stable job->ratifier->organism->attempt traversal.
  return (async function* iterateAcceptedRats() {
    const ratView = getRatView(concernBase);
    for await (const jobEntry of ratView.createReadStream()) {
      const jobKey = jobEntry.key;
      if (!jobKey) continue;
      const jobSub = ratView.sub(jobKey);
      for await (const ratifierEntry of jobSub.createReadStream()) {
        const ratifierKey = ratifierEntry.key;
        if (!ratifierKey) continue;
        const ratifierSub = jobSub.sub(ratifierKey);
        for await (const orgEntry of ratifierSub.createReadStream()) {
          const organismKey = orgEntry.key;
          if (!organismKey) continue;
          // Boundary: decode leaf values with concern RAT view encoding.
          const attemptStream = ratifierSub.sub(organismKey).createReadStream({ valueEncoding: viewRatEncoding });
          for await (const { key: attemptKey, value } of attemptStream) {
            const attemptBuf = value?.ref?.a || attemptKey;
            yield { jobKey, ratifierKey, organismKey, attempt: attemptBuf, value };
          }
        }
      }
    }
  })();
}

export { createRatsIterator };
