# Choose Your Role

Purpose: route a new consumer to the smallest correct surface.

## If you are mostly reading state

Use: [observer-client.md](observer-client.md)

You are here if:

- you want `state()`, `trace()`, watch-style observation, or bounded proposal helpers
- you do not want writer admission, host lifecycle, or process orchestration
- you are integrating mesh into an app or adjacent repo and need a thin client surface

## If your app owns a concern

Use: [app-exposes-concern.md](app-exposes-concern.md)

You are here if:

- your app wants one or more concern surfaces to exist as its bounded shared lanes
- your app wants mesh-side organisms or ratifiers to work against those concerns
- your app should define domain meaning, but not invent its own coordination protocol

## If you are writing only an organism

Use: [organism-author.md](organism-author.md)

You are here if:

- you want to observe concerns and propose PUB work
- you are not trying to redefine concern apply rules
- you need actor contract guidance and acceptance-proof reminders

## If you are writing only a ratifier

Use: [ratifier-author.md](ratifier-author.md)

You are here if:

- you want to observe jobs/PUBs and propose RAT outcomes
- your selectivity or policy should stay at the edge, not in concern apply
- you need the actor contract plus ratifier-specific constraints

## If you are integrating mesh into a broader substrate or app repo

Use: [adjacent-repo-integration.md](adjacent-repo-integration.md)

You are here if:

- mesh is adjacent infrastructure, not the canon of your repo
- you are tempted to invent server/client or central-API semantics first
- you need a clean ownership boundary between your repo and mesh

## Quick defaults

- default adjacent-repo posture: readonly observation first
- default control-plane posture: packs-led, not custom orchestration
- default replica posture: `readonly`
- default authority posture: explicit and rare
