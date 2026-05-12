# Cleanup Todo

Purpose: keep Mesh focused on concern/job/PUB/RAT mechanics and remove adjacent-app/demo-domain semantics from generic command paths.

## Production Blocker: Remove Adjacent-App Semantics From Mesh CLI

- [x] Remove or relocate adjacent-app control-panel caps from `packages/mesh-operator-cli/bin/mesh.js`.
  - Removed the legacy app-specific responder caps and kept only the generic concern-local responder cap.
  - Target shape: Mesh CLI exposes generic concern/job/responder surfaces only.
  - App-specific responder behavior should live in the app repo, Packs, or a clearly named demo adapter outside Mesh core command behavior.

- [x] Replace app-specific responder validation with generic responder contract validation.
  - Removed app-specific actor/device validation from the Mesh CLI responder.
  - Target shape: Mesh validates cap/job envelope mechanics and leaves actor/device semantics to the actor package or adjacent repo that owns them.

- [x] Replace canned app-specific selector responses.
  - Removed canned actor response payloads from the generic Mesh responder.
  - Target shape: responder output is either generic test/demo-only or delegated to a supplied actor/adapter.

- [x] Keep any hello/demo responder under an explicit demo command or fixture boundary.
  - No demo responder remains in the normal supported responder cap set.

## Acceptance Checks

- [x] `npm test` passes.
- [x] Mesh CLI still supports setup, discovery advertise, job submit, generic responder run, and status.
- [x] No adjacent-app control caps, app-specific actor ids, or app-owned control semantics remain in generic Mesh CLI production paths.
- [x] Any retained demo caps are clearly named demo/proof and excluded from normal-operation docs.
