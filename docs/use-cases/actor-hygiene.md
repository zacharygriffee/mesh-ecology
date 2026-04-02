# Actor Hygiene

You are here if:

- your repo needs an organism, ratifier, or concern-side convention
- you want to avoid creating actors that are too repo-specific to be broadly useful
- you need the shortest rule for deciding local-only vs donate-to-packs vs elevate-to-physics

## Boundary

- `mesh-v0-2` owns physics, locked invariants, and generic actor/runtime posture
- `mesh-ecology-packs` owns the preferred control-plane posture and intake for reusable operational conventions
- your repo owns domain canon, app meaning, and repo-specific adapters

This means hygiene lands here as guidance, not as new protocol behavior.

## Default Authoring Posture

- search before you specialize
- reuse an existing organism or ratifier when it already fits
- if the behavior can be generic, shape it generically first
- donate reusable actors or conventions upstream instead of canonizing them privately
- keep repo-local actors for domain-specific policy, not for convenience alone

## Promotion Rubric

Choose the narrowest destination that still preserves reuse:

1. Keep it repo-local when the actor depends on repo-specific canon, artifacts, or business rules.
2. Donate it to `mesh-ecology-packs` when the actor or convention is operationally reusable across multiple repos.
3. Elevate it to `mesh-v0-2` only when it changes the generic runtime posture or defines an invariant-bearing concept that should exist even without packs.

## Before You Add A New Actor

1. Check whether the behavior already exists in this repo or in `mesh-ecology-packs`.
2. Ask whether the selection logic is really domain-specific or just currently undocumented.
3. If it can be expressed without repo canon, write it as a generic actor or convention.
4. If it is genuinely repo-specific, keep the adapter boundary explicit so mesh vocabulary does not become your app canon.

## Do Not Do This

- do not start by inventing a bespoke actor family when an existing one can be reused
- do not treat private convenience as proof that a concept belongs in physics
- do not move control-plane intake or deployment policy into `mesh-v0-2`
- do not promote a repo-specific concern convention into core unless it carries invariant-level meaning

## Related Docs

- [adjacent-repo-integration.md](adjacent-repo-integration.md)
- [organism-author.md](organism-author.md)
- [ratifier-author.md](ratifier-author.md)
- [../runtime-support-policy.md](../runtime-support-policy.md)
