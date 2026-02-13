# STYLE

This repo prioritizes deterministic behavior, explicit boundaries, and testable invariants. The codebase is protocol/encoding heavy (Autobase/Hypercore/Hyperbee), so style rules focus on preventing boundary drift.

## Non-negotiable principles

1) Derived view is truth
- “Accepted” means the derived view contains the leaf entry.
- Never treat append() success as acceptance.

2) No authority shortcuts
- Runner/organism/ratifier roles never call addWriter / base.addWriter / addConcernWriter.
- Authority ops (ADD/JOB/STATE genesis) are host-only.

3) No process-global behavioral state
- No global caches that affect correctness.
- Behavioral dedupe and cursors live in the agent state surface (“state bee”) and are persisted.

4) Boundaries are explicit
Encoding, key normalization, apply vs append, replication, and state persistence must be structurally separated.

## Module sizing & layout

File scope
- One behavioral responsibility per file (not one function per file).
- Target size: 50–150 LOC (exceptions allowed when locality is improved).
- A file may contain 3–8 tightly related functions.

When to split into a new file
Split when crossing a boundary:
- encoding/decoding
- key normalization & canonicalization
- apply vs append
- view traversal (streams/iterators)
- retry/cooldown policy
- state persistence

Naming
- Functions are verbs: publishRat, iterateAcceptedPubs, normalizeStrictConfigV1.
- Modules are nouns: ratifier-projector.js, pub-view-iterator.js, agent-state.js.
- Keys must be explicit: concernKey, jobKey, fromKey, attemptToken, ratifierKey, organismKey.
  Avoid ambiguous “key” without a prefix.

## Comments (intent-first, no rot)

Function header
- Each non-trivial function must have exactly one INTENT header comment.

Example:
- INTENT(phase4): Emit optimistic RAT proposals only for accepted PUB leaves; acceptance is derived-view only.

Inline comments
Inline comments are allowed only on boundary lines:
- encoding boundaries (valueEncoding, fixed32, utf8)
- invariants (canonicalization / equality checks)
- apply/append transitions
- replication assumptions

Inline comment rules:
- One line only (no wrapped paragraphs).
- Do not narrate obvious control flow.

No stale comments
- If code changes meaning, update/remove the intent comment in the same diff.
- Never leave historical intent behind.

## Invariants as code

If an invariant matters, make it executable:
- validate buffers are 32 bytes where required
- canonicalize refs at the boundary (ref.k = jobKeyBuf)
- normalize strict econ fields to BigInt at strict-state read boundaries

## State & atomicity

Use the agent state surface (“state bee”) for:
- dedupe markers
- cursors
- cooldown metadata (if persisted)

In-memory caches are permitted only as performance caches and must be reconstructible from persisted state.

Recommended utf8 key format for state bee
- Use z32 for all 32-byte buffers.
- Use prefix paths:
  - accepted/<concernZ32>/<jobZ32>/<attemptZ32>
  - ratified/<concernZ32>/<jobZ32>/<orgZ32>/<attemptZ32>
  - cursor/<concernZ32>

## Tests

- No acceptance seeding.
- No pre-admitting writers.
- Assert acceptance only by derived view leaf presence.
- Prefer deterministic fakeswarm-first tests.
- If adding diagnostics, remove them before finalizing.

## Codex operating mode (required)

For any non-trivial change, Codex must:
1) Produce an investigation report (files + invariants + pitfalls).
2) Produce an implementation plan (minimal diff).
3) Implement.
4) Run relevant tests.

Codex must not:
- introduce topic filtering or routing on sockets
- introduce authority calls from runner/ratifier/organism
- introduce process-global caches for correctness
- bend tests by seeding acceptance

