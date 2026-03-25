> Status: Contextual / Exploratory. Not binding for v0. See docs/v0-locked.md.
> Purpose: Shared vocabulary to reduce collaborator friction. If any term here conflicts with v0-locked invariants or canonical labs, v0-locked / labs win.

# Decentralized Organism Ecosystem — Glossary (v0 shared terms)

## Scope note
- This glossary defines **preferred human language** for v0-active concepts and explicitly marks FUTURE / EXPERIMENTAL concepts.
- It does **not** introduce new protocol semantics.
- Metaphors are minimized; where analogies are used (e.g., “UDP”), they are labeled as such.
- Discovery is active in v0; respiration, transient gas, and sponsorship remain FUTURE.

---

## Surfaces, logs, and encoding

## Surface (general)
- **Intuition:** Where irreversible things are recorded.
- **Definition:** An append-only, replayable log of *envelopes* that can be deterministically re-opened and re-derived into a *view*.

## Envelope
- **Intuition:** A wrapper around bytes.
- **Definition:** The serialized container stored in the surface log that includes an envelope `type` and a binary `payload`.
- **Notes:**
  - Some envelopes are **typed events** (v0 event kinds).
  - Some envelopes are **non-typed control/admin** (e.g., operator-only writer admission).

## Typed Event
- **Intuition:** A real “physics event” in v0.
- **Definition:** An envelope whose `type` is one of the v0 event kinds (seed/job/attempt_debit/claim/progress/proposal/ratification), and whose payload decodes under the event codecs.
- **Important:** Typed events are what v0 derivations and intrinsic summaries operate over.

## Non-Typed Envelope
- **Intuition:** Plumbing.
- **Definition:** An envelope that is not one of the v0 typed event kinds, but may exist to support operation (e.g., writer admission).
- **Rule of thumb:** Non-typed envelopes may be present in the underlying log, but many read-only derivations intentionally skip them.

## View
- **Intuition:** The deterministic interpretation of the log.
- **Definition:** A derived, ordered feed produced by deterministic apply rules over the underlying append-only log.
- **Notes:** Most “state” is interpreted from the view, not from any single writer’s local history.

## Event Index
- **Intuition:** The system’s timebase.
- **Definition:** A position in the ordered view. Used for deterministic notions like leases and silence windows.
- **Important:** Many concepts use **event-index distance**, not wall-clock time.

## Canonical Equivalence
- **Intuition:** “Same reality after reopen.”
- **Definition:** Two runs are canonically equivalent if they produce the same ordered sequence of envelopes/events (commonly checked by comparing envelope type + payload bytes).

---

## Discovery (v0)

## Discovery Registry (v0)
- **Intuition:** A public notice board.
- **Definition:** An append-only registry surface that advertises:
  - Concern Surfaces, and
  - other Discovery Registries.
- **Shape:** Stored as a scan-log of entries addressable by sequence index; consumers stream and dedupe locally.
- **Dedupe:** Re-advertisements are allowed; consumers decide how to drop or prefer entries per pass.
- **Non-goals:** contains no jobs and no work coordination; publishes pointers only.

## Discovery Surface (v0)
- **Intuition:** The ecosystem’s map (locally chosen).
- **Definition:** The conceptual union of one or more Discovery Registries that an organism chooses to follow.
- **Important:**
  - There is no global discovery surface.
  - An organism’s discovery surface is local policy.

## Registry Advertisement (v0)
- **Intuition:** “Look over there.”
- **Definition:** A registry entry that points to another Discovery Registry.

## Concern Advertisement (v0)
- **Intuition:** “This problem exists.”
- **Definition:** A registry entry that points to a Concern Surface (base key + optional metadata).
- **Non-claims:** does not assign work, grant authority, or imply quality.

## Flattening (v0)
- **Intuition:** Making sense of many lists.
- **Definition:** A deterministic process by which an organism:
  - traverses registries,
  - follows registry advertisements,
  - collects concern advertisements,
  - applies cycle detection, deduplication, and budget limits.
- **Important:** Flattening is local policy, not global truth.

---

## Concerns and work surfaces (v0)

## Concern (v0)
- **Intuition:** A bounded problem space.
- **Definition:** A domain of work represented by one Concern Surface. Concerns are independent.

## Concern Surface (v0)
- **Intuition:** The world where a single problem lives.
- **Definition:** An append-only event surface (Autobase + derived view) representing one Concern. All jobs, attempts, claims, leases, progress, proposals, and ratifications for that concern occur here.
- **Notes:**
  - “Concern Base Surface” and “Concern Surface” are equivalent; “Concern Surface” is the preferred short form.
  - A surface is “live” only while at least one host/indexer process is running replication + `update()` + `apply`; build scripts that exit do not keep it online.
  - Economics/capacity controls (bond/gas) are **not protocol-active in v0-locked**; any future bond requirements must be explicitly enabled.

## Single Genesis (v0)
- **Intuition:** One beginning.
- **Definition:** Exactly one seed event per concern/base. Reseeding is invalid.

---

## Actors and authority

## Organism (v0)
- **Intuition:** Something that persists and takes responsibility.
- **Definition:** A persistent identity that:
  - observes Discovery Registries and Concern Surfaces,
  - authorizes irreversible mutations on Concern Surfaces by publishing signed events (any gas/cost framing is FUTURE/non-active in v0),
  - survives agent churn and state loss.
- **Important:**
  - The organism is an **authority boundary**.
  - Runtime default is still readonly-first: an organism process does not become writable merely by opening or replicating a surface.
  - The organism can be replaced at the logic level without changing identity.

## Corestore Boundary
- **Intuition:** A Corestore instance is both an authority and observation boundary.
- **Definition:** One `new Corestore(path)` per role process (organism runner, ratifier runner, discovery host, concern host). That process MAY open concern/discovery bases via `corestore.namespace(...)` inside that single instance. Corestores MUST NOT be shared across roles/identities, and additional Corestore instances inside a role process are forbidden unless explicitly declared as a hard boundary.
- **Pass Boundary:** Cached bases/views/Autobase objects MUST be scoped to a single observational pass (or keyed with a pass namespace). Reusing pass-agnostic caches is a violation because it allows hidden coupling and cache bleed between observations.
- **Violations:** (a) multiple Corestore instances inside one role process without explicit boundary; (b) any Corestore shared across roles/identities; (c) pass-crossing caches.
- **Rationale / Failure Modes:** Per-concern/per-pass Corestore construction can exhaust file descriptors; a single Corestore per role controls FD load while pass-scoped caching and namespacing keep observations independent and prevent cache bleed.

## Organism Logic (v0)
- **Intuition:** How an organism decides what to try.
- **Definition:** The internal decision-making and behavior rules an organism uses to:
  - observe surfaces,
  - select opportunities to engage,
  - generate candidate actions/plans/proposals.
- **Clarifications:**
  - Organism Logic does **not** grant authority.
  - Organism Logic should be treated as **propose-only**: it suggests; it does not commit.
  - Logic may change without changing organism identity.

## Agent (v0)
- **Intuition:** A temporary worker.
- **Definition:** An ephemeral process acting on behalf of an organism.
- **Rule:** Agents may plan, compute, test, and propose actions, but have no inherent authority unless they are holding the organism’s signing/commit capability.

## Worker Agent (v0)
- **Intuition:** Does the work.
- **Definition:** Produces patches, analyses, evidence, and plans. Cannot mutate surfaces.

## Signer / Commit Agent (v0)
- **Intuition:** Guards the gate.
- **Definition:** Holds organism authority and may append signed events to a Concern Surface, enforcing invariants.

## Spawner (v0)
- **Intuition:** What causes something to exist.
- **Definition:** An external initiator that creates organisms/agents/surfaces/registries.
- **Non-claim:** A spawner has no standing authority unless it continues acting as an organism/agent.

## Writer
- **Intuition:** “Allowed to append here.”
- **Definition:** A key/identity that has been admitted to append to a surface.
- **Important:** Writer admission is operator/indexer management, not the public onboarding path; it is rarely used for organisms.

## Writer Admission
- **Intuition:** Opening the door.
- **Definition:** The explicit act of adding a writer to a surface (commonly represented by a non-typed envelope).
- **Important:** Unauthorized writes may appear locally, but must not land in the converged view under validation rules. Routine organism onboarding uses optimistic submit + `host.ackWriter`, not admission.
- **Default posture:** Replicas/followers should be assumed readonly unless an authority process explicitly elevates them.

## Optimistic Acknowledgement (`ackWriter`)
- **Intuition:** “Indexer agrees this candidate can count.”
- **Definition:** In optimistic Autobase mode, indexers call `host.ackWriter(node.from.key)` inside `apply` after deterministic verification; only acked candidates are eligible to be applied to the view.
- **Important:** `ackWriter` is not admission and does not confer trust; every node from every key is still validated per-node regardless of prior acks.

## Surface Bond (FUTURE / not active in v0-locked)
- **Intuition:** “What the surface can lose.”
- **Definition:** A hypothetical finite bond declared at surface genesis and locked per job. **Not enforced in current v0-locked implementation.**
- **Important:** Any activation would require an explicit directive and tests; treat existing references as forward-looking only.

---

## v0 event kinds (mechanical lifecycle)

## Job (v0)
- **Intuition:** A public problem statement.
- **Definition:** An event describing a bounded need or opportunity. Jobs invite response; they assign no obligation.
- **Value note:** Jobs may carry bounty/attention intent, but do not guarantee payment.

## Attempt / Attempt Debit (v0)
- **Intuition:** Paying to try.
- **Definition:** A surface event that justifies attempting work on a job. When/if economics activate, an attempt may burn gas; under v0-locked no protocol-level cost is enforced. Attempts precede claims.

## Claim (v0)
- **Intuition:** “I am working on this.”
- **Definition:** A surface event asserting intent to act on a job, paired with a lease.

## Lease (v0)
- **Intuition:** Time-limited exclusivity (by index).
- **Definition:** A bounded exclusivity window measured in event-index distance, not wall-clock time.
- **Rules:**
  - Leases expire deterministically.
  - Renewal requires progress with new evidence.
  - Total lifetime is capped.

## Lease Expiry
- **Intuition:** Silence has consequence.
- **Definition:** The deterministic end of a claim’s exclusivity when its lease window has elapsed without qualifying renewal.

## Progress (v0)
- **Intuition:** Proof something moved forward.
- **Definition:** A surface event attaching new, verifiable evidence to a claim.
- **Note:** “Verifiable” is judged above the base layer (observers/ratifiers); the base records references.

## Proposal (v0)
- **Intuition:** “Here is a shape worth keeping.”
- **Definition:** A candidate structural outcome presented for consideration.

## Ratification (v0)
- **Intuition:** Agreement to make it count.
- **Definition:** An irreversible surface event that accepts a proposal (or outcome) under some ratifier’s criteria.
- **Important:** Ratification is where “economic reality” begins (selection), not where protocol truth begins.

## Evidence
- **Intuition:** Something others can check.
- **Definition:** A byproduct that can be used to support progress/observation (e.g., logs, artifacts, measurements). Evidence may live off-surface; surfaces commonly store an `evidence_ref` to it.

## `payload_ref` / `evidence_ref` / `proposal_ref`
- **Intuition:** Pointers, not payloads.
- **Definition:** Structured reference strings carried in event payloads to point at external content or correlation tokens.
- **Important:** These refs are conventions; the base does not enforce their meaning.

---

## Economics and cost (v0 posture)

## Gas (FUTURE / not protocol-active in v0-locked)
- **Intuition:** Energy already spent that could justify permanence.
- **Definition:** Conceptual irreversible cost an organism might accept to justify surface mutation. **Currently inactive per v0-locked; no economic enforcement is implemented.**
- **If activated:** would be burned (not earned), not a reward, not a balance.

## Work (v0)
- **Intuition:** Everything before commitment.
- **Definition:** Off-surface computation, planning, testing, and preparation. Work is free/unaccounted until published.

## Publication (v0)
- **Intuition:** Making something visible forever.
- **Definition:** The act of surfacing a byproduct via a signed event. Publication is irreversible; in the current v0 implementation it does **not** consume protocol-enforced gas.

---

## Intrinsic layer (v0 additive, read-only)

## Intrinsic Layer
- **Intuition:** Read-only perception of surface behavior.
- **Definition:** Deterministic derivation computed from typed events already present on a surface.
- **Non-goals:** does not emit events, does not mutate surfaces, does not introduce telemetry mechanisms.

## Intrinsic Signals (v0)
- **Intuition:** The only “metrics” v0 admits.
- **Definition:** Facts derived strictly from typed events:
  - attempt activity (attempt rate),
  - claim turnover (claim churn),
  - progress cadence (progress frequency),
  - absence/silence (lease expiry and/or no recent attempt/progress in a window).
- **Important:** No thresholds, alerts, “health,” or scoring are implied.

## Window (intrinsic window)
- **Intuition:** Recentness by event count.
- **Definition:** A trailing slice of the last N typed events used to compute windowed intrinsic facts.

## Absence / Silence (intrinsic)
- **Intuition:** Nothing happened—and that matters.
- **Definition:** A derived condition indicating that no attempts and/or no progress occurred within the configured window, and/or that a lease expired without renewal.
- **Important:** Silence is not a bug; it is a first-class signal.

---

## Observation and settlement (above base, additive ecology)

## Observation (as work)
- **Intuition:** Witnessing costs effort.
- **Definition:** An organism’s act of independently verifying or sensing an actuator effect and publishing its own evidence (often as progress).
- **Important:** Observation is not “delivery confirmation.” It is a competing production of evidence.

## Observer (organism pattern)
- **Intuition:** Witness.
- **Definition:** An organism that watches for effects and publishes evidence/claims about what it observed.
- **Non-claim:** Observers do not define truth; they compete to make evidence legible.

## Ratifier (organism pattern)
- **Intuition:** Selective settlement.
- **Definition:** An organism that decides what counts economically by emitting ratification only when its criteria are met. Any economic impact is selective behavior, not base-protocol enforcement.
- **Important:** Ratifiers provide “guarantees” only as selective economic behavior, never as protocol enforcement.

## Quorum (PoO quorum)
- **Intuition:** “Enough witnesses.”
- **Definition:** A ratifier-defined requirement for independent observations/evidence before ratification occurs.
- **Important:**
  - Quorum is contextual and ratifier-specific.
  - Quorum is not governance; it is selection criteria.

## PoO (Proof of Observation)
- **Intuition:** Reality requires witnesses.
- **Definition:** A family of patterns where outcomes become economically real only when sufficiently observed/corroborated under a ratifier’s criteria.

## Economic Selectivity
- **Intuition:** Paying only for what meets criteria.
- **Definition:** The principle that any “guarantee” is implemented as selective ratification based on evidence/observation, not enforced by the base protocol.

## Economic Reality / “Counts”
- **Intuition:** When something becomes settled.
- **Definition:** An outcome “counts” when it is ratified under some ratifier’s criteria. Prior activity may exist but is not economically settled.

---

## Ecology patterns (v1 additive patterns)

## Sensor (organism pattern)
- **Intuition:** Publisher of opportunities.
- **Definition:** An organism that perceives local events and posts jobs (advertisements of opportunity) onto concern surfaces.
- **Non-claim:** Sensors do not assign work and do not guarantee perception correctness.

## Actuator (organism pattern)
- **Intuition:** Doer under cost.
- **Definition:** An organism that voluntarily engages a job, claims, and publishes evidence of action (progress). Any “pays attempt gas” framing is FUTURE/non-active in v0.
- **Non-claim:** An actuator’s assertion is not automatically economically real.

## Exerciser / Secret Shopper (organism pattern)
- **Intuition:** Applies pressure to reveal competence.
- **Definition:** An organism that posts edge-case jobs designed to elicit failure modes (silence, churn, mismatches) and observes what survives via intrinsic signals and ratifier outcomes.
- **Important:** Exercisers are not orchestrators; they inject opportunities and measure selection.

## Pressure (ecological)
- **Intuition:** Conditions that force adaptation.
- **Definition:** The introduction of opportunities and constraints that change which strategies survive (e.g., adversarial jobs, contested claims, mismatch probes).

## Exposure
- **Intuition:** Being subjected to pressure.
- **Definition:** The state of organisms encountering pressure cases through discovery and voluntary engagement.

## Training (by exposure + selection)
- **Intuition:** Competence emerges, not granted.
- **Definition:** Adaptation that occurs because organisms are exposed to pressure and only certain outcomes are ratified/selected over time.

## Correlation Token (convention)
- **Intuition:** “This evidence belongs to that job.”
- **Definition:** A deterministic token carried through existing reference strings (payload_ref/evidence_ref/proposal_ref) to link related events without adding new schema fields.
- **Note:** Correlation is convention, not protocol enforcement.

---

## Overloaded terms (explicit disambiguations)

## Guarantee
- **Intuition:** Something you can rely on.
- **Definition (this system):** Any reliability property must be implemented above the base as selective behavior (observers/ratifiers). The base layer does not guarantee delivery/correctness.

## Value
- **Intuition:** “Worth.”
- **Definition (this system):**
  - Value is expressed by jobs and ratifier settlement (what gets paid/ratified).
  - Organism logic is not intrinsically valued; it decides whether attempting is worth the cost.
  - Over time, organisms may gain **leverage** (higher chance to be observed/ratified), but that remains contextual.

## Fairness
- **Intuition:** Justice or equal treatment.
- **Definition (this system):** A ratifier-side bias/constraint used as selectivity criteria (optional, contestable, non-protocol). Fairness must not be enforced at the base layer.

## Leverage (economic)
- **Intuition:** Advantage under selection.
- **Definition:** Contextual ability of an organism/strategy to survive and get outcomes ratified under certain pressures/ratifiers. Not a protocol primitive.

---

## Operations and guardrails (v0 posture)

## Validation Mode (`VALIDATION=1`)
- **Intuition:** Strict checking.
- **Definition:** A runtime posture that enforces surface invariants/validation during appends or during read-only validation runs.
- **Important:** Validation does not add new semantics; it enforces the existing ones.

## Replay Stability
- **Intuition:** Reopen yields the same reality.
- **Definition:** A property where closing and reopening a surface yields canonical equivalence of the derived view/log for a given scenario.

## Canonical Labs / Regression Ladder
- **Intuition:** Proof by executable pressure.
- **Definition:** The authoritative harnesses/tests that demonstrate and lock expected behavior. If docs disagree, labs win.

---

## Analogy terms (for onboarding; not protocol primitives)

## UDP Semantics (analogy)
- **Intuition:** No guarantees at the base.
- **Definition:** A teaching analogy: the base behaves like UDP (no delivery/correctness promises). Any reliability must be built above as selective economic behavior.
- **Important:** This is an analogy, not a networking claim.

## Non-Guaranteed Substrate (concept)
- **Intuition:** Reality is allowed to fail.
- **Definition:** The principle that the system does not enforce correctness or delivery at the base; reality emerges through irreversible action, observation, and selective settlement.

---

## FUTURE / NOT ACTIVE IN v0
Concepts explicitly inactive; must not be assumed by agents or tests.

### Respiration (FUTURE)
- **Intuition:** Staying alive by contributing.
- **Definition:** A mechanism converting continuous, observable service into transient gas.

### Transient Gas (FUTURE)
- **Intuition:** Borrowed breath.
- **Definition:** Temporary mutation capacity that decays and cannot justify permanent authority.

### Sponsorship (FUTURE)
- **Intuition:** Risk taken on behalf of another.
- **Definition:** Delegation of gas or liability without transferring authority.

### Executor / Prosper Step (EXPERIMENTAL)
- **Intuition:** A constrained doer loop.
- **Definition:** An organism pattern that reads surface state, filters to legal actions, and commits at most one action per cycle while remaining non-guaranteeing.
- **Status:** Experimental; must not be treated as v0 physics.
