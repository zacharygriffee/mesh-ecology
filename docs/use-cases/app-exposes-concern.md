# App Exposes a Concern

You are here if:

- your app wants a bounded shared lane for jobs, publications, and ratifications
- your app should define the domain meaning of that concern
- you want generic or conventional mesh-side organisms/ratifiers to work against it

## Use This Surface

Use a concern surface as the shared coordination lane and discovery as the pointer fabric that advertises it.

In practice:

- your app or operator environment exposes the concern host
- discovery advertises the concern
- organisms and ratifiers attach as helpers

## Default Posture

- concern authority stays explicit and operator-controlled
- generic organisms/ratifiers are helpers, not the deciding authority
- replicas remain `readonly` by default

## What You Own

- the domain meaning of jobs, refs, notes, and receipts around your concern
- the conventions your ecosystem expects for refs or artifacts
- when a concern should exist and what it is “for”

## What Mesh Owns

- concern apply and materialization semantics
- discovery advertisement mechanics
- optimistic proposal intake
- runner, organism, and ratifier helper posture

## Do Not Do This

- do not move your domain canon into mesh jargon
- do not invent a parallel server/client protocol when a concern surface is the real shared lane
- do not make organisms or ratifiers the deciding authority
- do not encode edge policy into discovery

## Minimal Path

1. Define the concern your app needs.
2. Expose or attach to a concern host.
3. Advertise that concern through discovery.
4. Let mesh-side organisms/ratifiers consume the concern through conventional refs and bounded actor logic.
5. Keep app-level meaning outside the engine and translate mesh output into app-native semantics where needed.

## Related Docs

- [../protocol.md](../protocol.md)
- [../runbooks/cli-authority.md](../runbooks/cli-authority.md)
- [../runtime-support-policy.md](../runtime-support-policy.md)
