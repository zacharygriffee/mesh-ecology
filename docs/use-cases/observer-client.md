# Observer / Client

You are here if:

- you need read-only observation from an app, tool, or adjacent repo
- you want light in-process participation without host lifecycle control
- you do not want to reason about discovery roaming, writer admission, or process topology first

## Use This Surface

Use `@mesh/mesh-sdk` as the default client surface.

Typical operations:

- `state()`
- `trace({ jobKey })`
- `watchState(...)`
- bounded `proposePub(...)` / `proposeRat(...)` only if your app truly needs them

## Default Posture

- concern/discovery replicas are `readonly`
- no writer admission
- no process lifecycle control
- no assumption that your app is the control plane
- client truth comes from joined mesh surfaces or supported SDK calls, not from another runtime's store root

## What You Own

- your app’s domain model, UI, and local logic
- choosing which concern keys to observe
- deciding whether observed mesh data becomes local display, adapter input, or local-only context

## What Mesh Owns

- concern/discovery runtime semantics
- proposal, intake, and materialization semantics
- replication and materialization behavior
- authority/writer posture
- packs-led control-plane operations

## Do Not Do This

- do not assume mesh means “server/client app”
- do not embed `mesh-operator-cli` behavior into your app runtime
- do not treat append success as acceptance proof
- do not treat proposal intake or local observation as shared canonical concern truth
- do not infer writable authority from opening or replicating a surface
- do not read another runtime's filesystem or corestore as a shortcut for observation
- do not treat diagnostic inspectors or test labs as application integration precedent

## Minimal Path

1. Obtain a concern key or discovery key from an operator-controlled environment.
2. Use `@mesh/mesh-sdk` to observe state and trace.
3. Treat mesh outputs as bounded shared coordination state, not as your app canon unless you explicitly translate them.

## Related Docs

- [../../packages/mesh-sdk/README.md](../../packages/mesh-sdk/README.md)
- [../runtime-support-policy.md](../runtime-support-policy.md)
- [../runtime-consumer-migration.md](../runtime-consumer-migration.md)
