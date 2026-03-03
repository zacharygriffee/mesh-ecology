# Dual Runtime Audit (Node + Bare)

Date: 2026-03-01
Scope: `packages/mesh-sdk` (audit only; no behavior changes)

## Current Module/Entry/Exports

- Module format: ESM (`"type": "module"` in `packages/mesh-sdk/package.json`).
- Entrypoints:
  - `main`: `./index.js`
  - package `exports["."]`: `./index.js`
  - `index.js` re-exports `createMeshClient` from `./src/client.js`.
- `imports` map currently present:
  - `path` -> `bare-path` (condition `bare`) / `path` (default)
  - `node:path` -> `bare-path` (condition `bare`) / `node:path` (default)

## Build/Publish Summary

- No package-local build scripts in `packages/mesh-sdk/package.json`.
- No transpilation/bundling step defined for this package; source is shipped/executed as JS.
- Package is currently private (`"private": true`), so no publish pipeline is configured from this package manifest.

## Builtin Usage Inventory

### A) Direct usage in `packages/mesh-sdk` entry/source files

| File | Import | Purpose | Proposed platform API replacement |
|---|---|---|---|
| `packages/mesh-sdk/src/client.js` | `import path from "path"` | Resolve `storeRoot` to absolute path in `createMeshClient` | Inject path ops via runtime adapter (e.g. `platform.path.resolve`) or keep alias-based indirection to `bare-path` for Bare |
| `packages/mesh-sdk/package.json` | `imports` keys `path` / `node:path` | Runtime mapping for Bare vs Node path implementation | Keep this pattern, but ensure future Bare entry uses only adapter/aliased path calls |

Notes from explicit+implicit search (`import`, `require`, `import()`):
- No direct `fs`, `os`, `net`, `tls`, `stream`, `child_process`, `worker_threads`, or `node:*` usage in `packages/mesh-sdk/index.js` and `packages/mesh-sdk/src/**`.
- `path` is the only direct Node builtin currently imported by SDK source.

### B) Transitive dependencies with top-level builtin pulls (reachable from `@mesh/mesh-sdk`)

| File (dependency) | Import | Purpose | Proposed platform API replacement |
|---|---|---|---|
| `node_modules/hypercore-storage/index.js` | `require("path")`, `require("fs")` | Corestore backing storage paths and filesystem access | Isolate behind a storage adapter boundary for Bare entry (no direct Node fs/path in Bare-reachable branch) |
| `node_modules/device-file/index.js` | `require("fs")`, `require("path")` | Device file creation/validation and lock file location | Replace with Bare-compatible storage/locking primitive or runtime capability shim |
| `node_modules/hypercore-storage/migrations/0/index.js` | `require("fs")`, `require("path")` | On-disk migration file traversal | Keep Node-only migration path out of Bare entry reachability |
| `node_modules/fd-lock/index.js` | `require("fs")` | File descriptor lock lifecycle | Swap to platform lock abstraction for Bare-capable path |
| `node_modules/require-addon/lib/node.js` | `require("fs")` (also `require("url")`) | Native addon resolution path for Node host | Ensure Bare path uses Bare addon resolver branch only |
| `node_modules/hypercore/index.js` | `require("events")` | EventEmitter base class | Accept if Bare runtime provides compatible events shim; otherwise adapter/shim boundary |
| `node_modules/ready-resource/index.js` | `require("events")` | Resource lifecycle emitter | Same as above (events shim/compat layer) |
| `node_modules/events-universal/default.js` | `require("events")` | Node events bridge implementation | Use Bare-compatible events implementation in Bare-reachable branch |

## Risk Graph (Bare Entrypoint Reachability)

Future Bare entrypoint must keep this reachable set builtin-free (or runtime-abstracted):

`@mesh/mesh-sdk/index.js` -> `src/client.js` -> `../../../src/ensureCorestore.js` -> `corestore` -> `hypercore-storage` -> (`device-file` -> `fd-lock`) and migration/addon loader paths.

Additional reachable chain through concern/discovery surfaces:

`src/client.js` -> `../../../src/discovery.js` / `../../../src/concern.js` -> `autobase` / `hyperbee` / `hypercore` (includes `events` dependency).

Practical risk: even without behavioral changes, importing/instantiating current SDK path reaches Node-centric storage modules. A future Bare entry should split/adapter-gate these imports so the Bare-reachable graph does not force Node fs/path/addon codepaths.

## Audit Method

- Read package metadata and entry files in `packages/mesh-sdk/`.
- Ran explicit+implicit import scans over `packages/mesh-sdk/index.js` and `packages/mesh-sdk/src/**`.
- Performed static reachability scan from `packages/mesh-sdk/index.js` and recorded reachable builtin imports at dependency top-level.
