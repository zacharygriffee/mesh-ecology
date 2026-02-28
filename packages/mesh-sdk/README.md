# @mesh/mesh-sdk

Thin in-process SDK for participation and observation.

## Scope

This package is a minimal facade for consumer apps (Pear/Electron, agent tooling):

- `state()`
- `trace({ jobKey })`
- `proposePub(...)`
- `proposeRat(...)`
- `waitForMaterialization(...)`
- `watchState(...)` (simple polling)

It does **not** replace operator tooling:

- `@mesh/mesh-operator-cli`
- `mesh-ecology-packs` `live:ctl`

## Design constraints

- No protocol changes.
- No process supervision/systemd/deploy behavior.
- No writer admission mutation.
- No doctor artifact writes.
- JSON contracts are schema-versioned:
  - state: `mesh-ecology-packs/state/v1`
  - trace: `mesh-ecology-packs/trace/v1`

## Example

```js
import createFakeSwarm from "fakeswarm";
import { createMeshClient } from "@mesh/mesh-sdk";

const topics = new Map();
const swarm = createFakeSwarm({ topics });

const client = createMeshClient({
  storeRoot: "./store/sdk-client",
  concernKeys: ["<concernKeyZ32>"],
  swarm
});

const state = await client.state();
const trace = await client.trace({ jobKey: "<jobKeyZ32>" });
```
