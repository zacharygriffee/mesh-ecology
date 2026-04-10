# Canonical Mesh Participation Doctrine

Purpose: define what this repo means by `physics proof`, `canonical mesh proof`, and `proper mesh participation` without changing locked v0 protocol/runtime semantics.

This document is doctrine for mesh-facing runtime posture. It is not a protocol change document, not an apply-rule change document, and not a control-plane recipe.

## 1. Layer Split

### Physics proof

Physics proof establishes engine/runtime mechanics that are universal for this repo, for example:

- discovery remains advertise/scan only
- acceptance is derived-view materialization, not append success
- readonly-first replica posture
- explicit writer admission
- replay-safe `concern.apply()` behavior

Physics proof is necessary and should be established once in `mesh-v0-2`. Downstream repos should not need to re-prove the same physics claim if they are relying on the same supported surface.

### Canonical mesh proof

Canonical mesh proof establishes that a mesh-facing actor, workflow, or app actually participates through the mesh in the intended posture.

Canonical mesh proof is about correct use of physics, not re-proving the physics itself.

Examples of canonical mesh proof questions:

- does this actor obtain cross-runtime truth through discovery/concern participation rather than shortcuts
- does this app still work when actors are treated as mesh participants rather than same-host helpers
- does this runtime avoid hidden side channels that bypass the mesh surface

### Probe/test proof

Probe/test proof establishes mechanics, diagnostics, or instrumentation behavior only.

Probe/test proof can be strong evidence for invariants, regressions, and implementation safety, but it is not canonical mesh proof by itself.

## 2. Default Law For Mesh-Facing Actors

For this repo, a mesh-facing actor is any organism, ratifier, concern-facing runtime, or other actor-like runtime that participates in shared cross-runtime mesh behavior.

Default law:

- a mesh-facing actor must obtain cross-runtime truth only through mesh participation on supported surfaces or supported SDK/operator APIs
- a mesh-facing actor must not rely on another runtime's store root, copied local storage, filesystem inspection, or direct-store shortcuts as a truth path
- a mesh-facing actor must not assume another actor shares its machine, process, or local transport environment
- any side-channel behavior between actors is out of canonical posture unless explicitly declared as an exception

This law governs canonical runtime posture and support expectations. It does not by itself add protocol enforcement or mutate `concern.apply()`.

## 3. Actor Classes

### Canonical actor

A canonical actor is:

- store-isolated
- mesh-participating
- boundedly contributive by default
- non-extractive by default

Canonical actors are the default precedent for mesh-facing runtime design in this repo.

### Auxiliary

An auxiliary runtime supports the ecosystem but is not canonical by default.

Examples may include:

- operational wrappers
- deployment helpers
- support tooling that participates around the runtime boundary without defining canonical actor posture

### Probe/test

A probe/test runtime is diagnostic or extractive and is permanently non-candidate unless rewritten into canonical posture.

Probe/test artifacts:

- may prove mechanics
- may diagnose replication or runtime state
- must not be used as canonical actor precedent
- must not be treated as sufficient proof that a mesh-facing app works in canonical posture

## 4. Participation And Contribution

Default posture for canonical actors:

- actors participate through discovery/concern surfaces
- actors should be boundedly contributive rather than purely extractive
- actors that only read, dump, and exit are not canonical actors by default

This does not mean every actor must replicate every concern forever. Some roles, such as roaming organisms, may necessarily have bounded or selective participation. That is acceptable when the behavior is intrinsic to the role and is explicit in the design.

The law here is against silent purely extractive posture being treated as canonical, not against bounded participation required by the role.

## 5. Declared Exceptions

This doctrine intentionally leaves room for real exceptions without weakening the default.

An exception is valid only when it is declared explicitly. A declared exception must state:

- the exception name
- why canonical participation is not the correct default
- what guarantees are weakened or changed
- whether the runtime remains `canonical actor`, `auxiliary`, or `probe/test`
- whether the exception belongs in `mesh-v0-2`, in `mesh-ecology-packs`, or in another repo

Default rule for exceptions:

- exceptions do not redefine the default law
- exceptions are local and explicit, not silently inherited
- an implementation convenience is not by itself a valid exception reason

Example candidate exception class:

- IoT or battery-sensitive participation may justify more leechy or bursty behavior, but that should normally be handled in a dedicated higher-level repo or explicit operational layer rather than redefining canonical posture here

## 6. Non-Mutation Rule For Existing Physics Proof

Current bare-physics and low-level mechanics tests remain valid for physics proof exactly because they test the physics directly.

This repo must not rewrite or distort those tests solely to make them look like canonical actor proofs.

Instead:

- keep physics/mechanics tests as mechanics tests
- classify them correctly
- do not present them as canonical actor precedent
- require canonical mesh proof separately when evaluating mesh-facing apps or actors

## 7. Where This Law Lives

This doctrine belongs in `mesh-v0-2` because it defines canonical runtime posture and mesh-facing actor hygiene.

It should not be pushed into:

- protocol/opcode/keyspace changes
- `concern.apply()` semantic rewrites
- packs-specific control-plane recipes

Downstream role split:

- `mesh-v0-2` defines the law and the classifications
- `mesh-ecology-packs` operationalizes the law and may later audit against it
- other repos may define declared exception classes for their own operational realities, but should not silently weaken the default doctrine here

## 8. Acceptance Standard For This Doctrine

This doctrine is in effect when:

- physics proof is no longer confused with canonical mesh proof
- probe/test artifacts are clearly non-precedential
- mesh-facing actors are expected to adhere to canonical participation unless they declare an exception
- downstream repos can rely on engine mechanics proven here without needing to re-prove the same physics claim
- downstream repos still prove their own canonical usage and app behavior
