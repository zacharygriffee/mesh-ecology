function createConcernViewGetters({
  JOB_KEY,
  PUB_KEY,
  RAT_KEY,
  jobEncoding,
  viewPubEncoding,
  viewRatEncoding,
  normalizeKeyToBuffer
}) {
  // INTENT(phase-c1-style): Provide concern derived-view accessors with the exact keyspace and valueEncoding boundaries used by apply/publish flows.
  function getPublishView(concern) {
    // Boundary: pub/* leaf decoding is pinned to viewPubEncoding.
    return concern.view.sub(PUB_KEY, { valueEncoding: viewPubEncoding });
  }

  function getRatView(concern) {
    // Boundary: rat/* leaf decoding is pinned to viewRatEncoding.
    return concern.view.sub(RAT_KEY, { valueEncoding: viewRatEncoding });
  }

  function getJobView(concern) {
    // Boundary: job/* remains append-only and decoded with jobEncoding.
    return concern.view.sub(JOB_KEY, { valueEncoding: jobEncoding });
  }

  async function getPublishViewByJob(concern, jobKey) {
    const jobKeyBuf = normalizeKeyToBuffer(jobKey);
    const view = getPublishView(concern).sub(jobKeyBuf, { valueEncoding: viewPubEncoding });
    return view.createReadStream();
  }

  return { getPublishView, getRatView, getJobView, getPublishViewByJob };
}

export { createConcernViewGetters };
