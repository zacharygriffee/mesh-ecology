Split Discovery Scan vs Job Execution (default demo strategy)
============================================================

Scope
- Default, v0-aligned strategy to separate discovery scanning from execution for organism/ratifier.
- No protocol changes; discovery stays advertising-only and append-only.
- Queue is local-only; not published to any surface.
- Status: informative legacy demo strategy, not a normative actor guide.
- "observer" below means a mesh-participating scan role, not a direct-store probe or filesystem reader.

1) Current behavior re: duplicates / guards
- Optimistic pubs: concern.apply enforces job exists and uniqueness per (jobKey, fromKey, attemptToken); duplicates are rejected before ack/apply.
- Optimistic rats: concern.apply enforces job exists, attempt exists, and uniqueness per (jobKey, ratifierKey, organismKey, attemptToken); duplicates rejected.
- Jobs: simple `put`; no guard against multiple similar jobs.
- No guard against multiple organisms working the same job; no “first ratified wins.” Multiple winners are allowed; uniqueness is only per writer/ratifier identity.

2) Proposed split-loop architecture (demo default)
- Loop 1: Discovery Scan (observer)
  - Traverse discovery registries via sequence-cursored Hypercore logs `{ t, k32, v }`.
  - For each concern ad, cold-open concern briefly (`updateWithTimeout`, optional bounded `getWait`), read up to SCAN_JOB_BUDGET items, extract candidates.
  - Candidate (local-only):
    - `kind`: "jobPub" | "jobRat"
    - `concernKey`: k32
    - `jobKey`: k32
    - `attemptToken?`, `writerKey?`, `ratifierKey?`
    - `meta?`
    - `seqHint` (optional: discovery/concern seq)
    - `expiresAt` (TTL or retry cap marker)
  - Dedupe per pass on (kind, concernKey, jobKey, attemptToken?, writerKey?, ratifierKey?); drop duplicates.
  - Expire after TTL or N failed revalidations.
  - Budgets: max REGISTRY_SCAN/pass; max CONCERNS_PER_PASS opened; max SCAN_JOB_BUDGET per concern; max CANDIDATES_PER_PASS enqueued.
- Loop 2: Execution (worker)
  - Consume queue FIFO or small shuffle.
  - Revalidate against concern before action:
    - Job exists.
    - For pubs: attemptToken not already present for (job, writer); ref matches job.
    - For rats: attempt exists; ratification not present for (ratifier, org, attempt).
  - On pass: optimistic append + `update`; optional bounded `getWait` for local visibility.
  - On fail: drop/mark spent; no endless retries.
- getWait placement: optional bounded on first read in scan loop; optional bounded after append in execute loop.
- Example budgets: REGISTRY_SCAN 1–2, CONCERNS_PER_PASS 10, SCAN_JOB_BUDGET 32, CANDIDATES_PER_PASS 64, EXEC_WORK_BUDGET 32.

3) Guardrails (MUST / MUST NOT)
MUST
- Cursor discovery by sequence index; no key ranges.
- Dedupe by advertised key (`k32`) and candidate identity.
- Enforce scan/open and candidate/exec budgets.
- Revalidate at commit time; queue is advisory only.
- Apply warm-window or bounded rechecks to avoid cold-open false negatives (warm-window amortizes latency; bounded rechecks revisit within the same pass).
MUST NOT
- Publish queue state to discovery or concern surfaces.
- Treat discovery order/frequency as priority/scheduling.
- Assume immediate visibility after cold-open; never rely on single read.
- Add new protocol semantics or winner rules in concern.apply.

4) Warm-window vs split-loop
- Warm-window (keep N concerns open): simple, good latency/liveness; higher steady FDs; needs eviction; can blur pass isolation.
- Split-loop (scan → queue → execute): lower steady FDs; clear separation of observe vs act; easier to budget/test; more moving parts and needs revalidation; risk of false negatives if scan too cold without warm-window or bounded rechecks.
- Recommended default: split-loop with small warm-window or bounded rechecks for liveness.

5) Lab implications (conceptual)
1) Cold-open false negative avoidance: scan without warm-window; bounded `getWait` or short revisit should detect jobs arriving just after first open.
2) Queue revalidation handles conflict: enqueue pub, then ratify before execution; worker drops candidate after revalidation detects existing rat.
3) Budget enforcement prevents churn: many concerns; ensure scan/exec budgets bound opens and candidate count; no FD growth beyond limits.

Notes
- Discovery remains advertising-only; no scheduling semantics.
- Concern apply uniqueness stays per writer/ratifier; multiple winners possible by design.
- Genesis/gas/bond semantics are intentionally out of scope for this snapshot.
