# mesh-v0-2

Mesh ecology v0 repository.

Naming note:
- use `mesh-ecology` for the GitHub repo name or repo URL
- use `mesh-v0-2` for the local checkout and workspace directory
- sibling repos should refer to this checkout as `(adjacent mesh-v0-2)` when describing it as an adjacent dependency

## Owns

- primitive runtime and coordination semantics
- locked invariants, protocol rules, and authority behavior
- supported engine surfaces, SDK, and operator CLI packages
- runtime-facing runbooks, labs, and compatibility notes

## Does Not Own

- control-plane posture, deployment-program canon, or pack taxonomy
- adjacent product canon or app-specific policy
- supervisory instance composition owned by `mindful`
- product-bridge doctrine owned by `interactive-fiction-concern-surface`
- ontology and substrate-research canon owned by `Virtualia`

## Adjacent Repos

- `mesh-ecology-packs` is the preferred control-plane layer for operational workflows and adjacent-repo conventions
- `mindful` consumes this repo as a read-only and authority-capable substrate, not as a place to redefine deployment posture
- `interactive-fiction-concern-surface` consumes this repo as adjacent runtime infrastructure through explicit bridge boundaries
- `Virtualia` may pressure substrate language, but it does not own runtime or control-plane canon here

## Start Here

- Practical use cases (adjacent repos, apps, actor authors): [docs/use-cases/README.md](docs/use-cases/README.md)
- Doc precedence map: [docs/doc-map.md](docs/doc-map.md)
- Locked invariants (highest authority): [docs/v0-locked.md](docs/v0-locked.md)
- Protocol details: [docs/protocol.md](docs/protocol.md)
- Bring-up guide ("run the four"): [docs/runbooks/bring-up.md](docs/runbooks/bring-up.md)

## Use Cases

- Use-case hub: [docs/use-cases/README.md](docs/use-cases/README.md)
- Choose your role: [docs/use-cases/choose-your-role.md](docs/use-cases/choose-your-role.md)
- Observer/client: [docs/use-cases/observer-client.md](docs/use-cases/observer-client.md)
- App exposes a concern: [docs/use-cases/app-exposes-concern.md](docs/use-cases/app-exposes-concern.md)
- Organism author: [docs/use-cases/organism-author.md](docs/use-cases/organism-author.md)
- Ratifier author: [docs/use-cases/ratifier-author.md](docs/use-cases/ratifier-author.md)
- Adjacent repo integration: [docs/use-cases/adjacent-repo-integration.md](docs/use-cases/adjacent-repo-integration.md)

## Runtime + Operator Docs

- CLI authority runbook: [docs/runbooks/cli-authority.md](docs/runbooks/cli-authority.md)
- Hetzner deploy runbook: [docs/runbooks/hetzner-deploy.md](docs/runbooks/hetzner-deploy.md)
- Release bundle runbook: [docs/runbooks/release-bundle.md](docs/runbooks/release-bundle.md)
- Runtime support policy: [docs/runtime-support-policy.md](docs/runtime-support-policy.md)
- Runtime consumer migration note: [docs/runtime-consumer-migration.md](docs/runtime-consumer-migration.md)

## Labs + Testing Docs

- Ecology labs guidance: [docs/dev/ecology-labs.md](docs/dev/ecology-labs.md)
- Two-transport labs: [docs/dev/two-transport-labs.md](docs/dev/two-transport-labs.md)
- Test hygiene audit: [docs/dev/test-hygiene-audit.md](docs/dev/test-hygiene-audit.md)

## SDK Docs (`packages/mesh-sdk`)

- SDK overview: [packages/mesh-sdk/README.md](packages/mesh-sdk/README.md)
- Bare/node dual-runtime audit: [packages/mesh-sdk/docs/dual-runtime-audit.md](packages/mesh-sdk/docs/dual-runtime-audit.md)
- Hashport audit: [packages/mesh-sdk/docs/hashport-audit.md](packages/mesh-sdk/docs/hashport-audit.md)
- Bare node-compat notes: [docs/bare/node-compat.md](docs/bare/node-compat.md)

## Domain References

- Organism contract: [docs/organism-contract.md](docs/organism-contract.md)
- Organism traversal: [docs/organism-traversal.md](docs/organism-traversal.md)
- Economy contract: [docs/economy-contract.md](docs/economy-contract.md)
- Economy walkthrough: [docs/economy-walkthrough.md](docs/economy-walkthrough.md)
- Glossary: [docs/glossary.md](docs/glossary.md)

## Contributor Guidance

- Agent/edit constraints: [AGENTS.md](AGENTS.md)
- Agent prompt conventions: [AGENT_PROMPT.md](AGENT_PROMPT.md)
- Style guide: [STYLE.md](STYLE.md)
