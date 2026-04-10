# Adjacent Repo Integration

You are here if:

- mesh is adjacent infrastructure for your repo, not the canon of your repo
- your repo has its own substrate, app model, or domain meaning
- you need the shortest explanation of what mesh should and should not be to you

## The Clean Boundary

- your repo owns domain canon
- mesh owns coordination fabric
- `mesh-ecology-packs` owns the preferred control-plane posture

Mesh gives you:

- discovery of shared lanes
- concern surfaces as bounded coordination state
- readonly/writable posture
- projector/actor helper patterns

Mesh does not give you:

- your app canon
- your world ontology
- a mandatory server/client architecture
- a reason to make topology vocabulary your domain model

## Default Posture

- start readonly
- start concern-oriented, not server-oriented
- start by reusing existing organisms/ratifiers where they already fit
- search for an existing generic actor or convention before writing a repo-specific one
- translate mesh vocabulary into your repo’s canon only at explicit adapter boundaries
- acquire cross-runtime truth through mesh participation or supported APIs, not by reading another runtime's storage

## What You Own

- domain nouns
- canonical events or records
- app or substrate validity rules
- translation of mesh observations into repo-native meaning
- repo-specific actors only when the behavior is truly repo-specific

## What Mesh Owns

- discovery advertisement semantics
- concern materialization semantics
- replica/authority behavior
- generic actor/runtime coordination posture
- hygiene guidance for when a concept should stay local, move to packs, or rise to physics

## Do Not Do This

- do not assume “needs a server setup first”
- do not let mesh ontology silently become your canon
- do not treat operator tooling as the source of truth for your repo
- do not build a second coordination protocol just because mesh terminology feels unfamiliar
- do not default to individualistic organisms or ratifiers when the behavior could be donated upstream
- do not pass store roots, copied data dirs, or filesystem inspection around as an integration seam

## Minimal Path

1. Decide whether you need only observation, a concern surface, or custom actors.
2. Use the corresponding use-case doc in this directory.
3. Keep mesh-shaped data as adapter input until you intentionally normalize it into repo-native forms.
4. If you need a new actor or concern convention, apply the hygiene rubric before making it repo-local.
5. Let packs own control-plane workflows instead of inventing a custom orchestration layer first.

## Related Docs

- [choose-your-role.md](choose-your-role.md)
- [observer-client.md](observer-client.md)
- [app-exposes-concern.md](app-exposes-concern.md)
- [actor-hygiene.md](actor-hygiene.md)
