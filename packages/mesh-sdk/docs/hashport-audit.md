# HashPort Audit (Recon Only)

## Scope
- Requested scan targets:
  - `packages/mesh-sdk/**`
  - `packages/mesh-v0-2/**` (not present in this repo)
  - runtime code at repo root `src/**` (actual ecology runtime location)

## What Exists Today

### `packages/mesh-sdk/**`
- No direct hashing imports/usages found (`hash`, `blake`, `hypercore-crypto`, `sodium`, `createHash`).
- `mesh-sdk` currently reaches hashing logic transitively by loading runtime modules from root `src/`:
  - `packages/mesh-sdk/src/platform/node/index.js` -> dynamic import of `src/concern.js`
  - `packages/mesh-sdk/src/platform/bare/index.js` -> dynamic import of `src/concern.js`

### Runtime hashing usage (`src/**`)
- `src/concern/keys.js`
  - `Krypto.hash(...)` for keyspace constants (`JOB_KEY`, `PUB_KEY`, `RAT_KEY`, `STATE_KEY`, econ totals).
- `src/concern/strict-state.js`
  - `Krypto.hash(...)` for strict config key derivation.
- `src/util/createKeyPair.js`
  - `Krypto.hash(...)` for namespaced topic/key material helpers.
- `src/concern/publish.js`, `src/util/random32.js`, `src/util/createSeedMaterial.js`
  - `Krypto.randomBytes(...)` (not hashing, but part of same crypto stack).

## Blake2b-256 Primitive Availability

Yes, a suitable primitive already exists in the dependency graph.

- `hypercore-crypto@3.6.1`:
  - `hash(data, out?)` allocates 32-byte output and calls `sodium.crypto_generichash_batch(...)`.
  - This corresponds to libsodium generic hash (BLAKE2b family) with 32-byte output (blake2b-256 shape).

Dependency chain in this repo:
- `hypercore-crypto` -> `sodium-universal` -> `sodium-native` -> `require-addon` / `which-runtime`

## Candidate Backends

| Backend | Where found | Runtime status | Node builtin risk | Notes |
|---|---|---|---|---|
| `hypercore-crypto.hash(...)` | `node_modules/hypercore-crypto/index.js` and runtime call sites above | Dual (Node + Bare in this ecosystem) | Low in consumer code (no direct builtin imports in `hypercore-crypto`) | Best fit: already canonical in runtime code and returns 32-byte digest. |
| `sodium-universal.crypto_generichash[_batch](...)` | `node_modules/sodium-universal/*` (transitive) | Dual via `sodium-native`/runtime-native bindings | Low at API layer; native binding plumbing underneath | Lower-level API; more manual buffering than `hypercore-crypto.hash`. |
| `node:crypto` / `crypto.createHash(...)` | Node builtin (not currently used for protocol hashes) | Node-only | High for Bare/core portability | Not suitable for canonical HashPort if Bare-safe core is required. |

## Import/Builtin Risk Notes

- `hypercore-crypto` itself does not import Node builtins in its top-level module.
- `sodium-native` uses `require-addon`; `require-addon` has conditional exports:
  - Bare path: `lib/bare.js` (no Node builtins)
  - Node path: `lib/node.js` (uses `fs`/`url`)
- Risk is manageable if imports go through package entrypoints (normal resolution); avoid deep-importing Node-specific internals.

## Recommendation (for future implementation)

- Canonical HashPort backend for **both Node and Bare**: `hypercore-crypto.hash(...)`.
- Do not introduce `node:crypto` hashing in `mesh-sdk` core.
- Keep core builtin-free by injecting hash capability via platform adapter/port wiring (no runtime sniffing).
- If HashPort moves into published `@mesh/mesh-sdk` source (instead of only transitive runtime usage), add explicit `hypercore-crypto` dependency in `packages/mesh-sdk/package.json`.

