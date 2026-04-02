# Organism Author

You are here if:

- you are authoring a single organism or a small family of organisms
- you want to propose PUB work against concerns
- you do not intend to redefine concern apply or writer governance

## Use This Surface

Use the organism actor contract and runner/runtime helpers already present in this repo.

Canonical shape:

- default export object
- `name`
- `async onTick(ctx, api)`

Copy from existing patterns before inventing a new structure.

## Default Posture

- organism runtime is readonly-first
- organism is a proposer helper by default
- writable elevation is explicit and advanced
- acceptance proof is derived-view materialization, not append success
- new organism work should search for an existing generic fit before specializing

## What You Own

- organism selection logic
- how it observes jobs or attempts
- its publish decisions
- any local work-journal behavior required for restart-safe phases
- repo-specific policy only when that policy cannot be made generic first

## What Mesh Owns

- concern/discovery semantics
- apply-time validation and acceptance
- replica/authority posture
- runner shell and concern warming behavior
- hygiene guidance for when an organism should be reused, donated to packs, or kept local

## Do Not Do This

- do not treat discovery as scheduling
- do not call success on append as acceptance
- do not move policy into concern apply
- do not assume writable authority just because an organism can propose work
- do not author a new organism family before checking whether an existing or generic version already fits

## Minimal Path

1. Start from an existing organism example.
2. Check whether the behavior belongs in your repo, in packs, or is already available.
3. Keep the actor contract exact.
4. Publish through the actor APIs.
5. Confirm completion only after the derived `pub/...` leaf materializes.

## Related Docs

- [../organism-contract.md](../organism-contract.md)
- [../protocol.md](../protocol.md)
- [../runtime-support-policy.md](../runtime-support-policy.md)
- [actor-hygiene.md](actor-hygiene.md)
