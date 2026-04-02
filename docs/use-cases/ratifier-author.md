# Ratifier Author

You are here if:

- you are authoring a ratifier only
- you want to observe jobs/PUBs and emit RAT proposals
- you need selective edge policy without changing concern apply

## Use This Surface

Use the ratifier actor contract and runner/runtime helpers already present in this repo.

Canonical shape:

- default export object
- `name`
- `async onTick(ctx, api)`

Model from existing ratifiers before inventing a new shape.

## Default Posture

- ratifier runtime is readonly-first
- ratifier is a proposer helper, not the deciding authority
- selectivity belongs in ratifier logic
- acceptance proof is derived-view materialization of `rat/...`
- new ratifier work should search for an existing generic fit before specializing

## What You Own

- ratifier selection criteria
- evidence or policy checks at the edge
- when to propose a RAT and with what determination/tier
- repo-specific selectivity only when it cannot be stated as a generic reusable policy first

## What Mesh Owns

- concern apply and deterministic acceptance
- discovery/concern traversal semantics
- replica/authority posture
- runner and warmset behavior
- hygiene guidance for when a ratifier should be reused, donated to packs, or kept local

## Do Not Do This

- do not put ratifier-specific selectivity into concern apply
- do not assume your ratifier becomes authoritative by being careful
- do not conflate observed PUB existence with accepted RAT existence
- do not author a one-off ratifier before checking whether the policy already exists or can be donated upstream

## Minimal Path

1. Start from an existing ratifier example.
2. Check whether the policy belongs in your repo, in packs, or is already available.
3. Keep the actor contract exact.
4. Publish through `api.publish.rat(...)`.
5. Confirm acceptance only when the derived `rat/...` leaf appears.

## Related Docs

- [../organism-contract.md](../organism-contract.md)
- [../protocol.md](../protocol.md)
- [../runtime-support-policy.md](../runtime-support-policy.md)
- [actor-hygiene.md](actor-hygiene.md)
