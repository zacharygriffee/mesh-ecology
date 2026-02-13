# Naming Token Refactor Report

## Summary of renames
- Standardized 32-byte buffer identifiers from `*Id` to `*Key` and clarified attempt token naming across concern/organism/ratifier logic and validity helpers/tests (e.g., organismKey, ratifierKey, attemptToken).
- Updated validation helpers and docs to reflect the `attemptToken` terminology and renamed helper `normalizeAttemptToken`.
- Aligned integration/log messaging to the new naming while preserving encoded field names.

## Schema safety
- Encoded field names and codec paths remain unchanged (e.g., event fields `jK/oK/aK`, ref `a`, view paths `pub/<jobKey>/<oK>/<aK>`).
- Aliasing used where needed to keep wire keys stable, e.g.:
  - `const { jK: jobKey, oK: organismKey, aK: attemptToken } = value;` (wire fields unchanged).
  - Ratification view lookups remain `.sub(RAT_KEY).sub(jobKey).sub(ratifierKey).sub(organismKey).get(attemptToken)`.
  - Validation getters still receive on-wire fields; only local variable names updated (`attemptToken`, `ratifierKey`).

## Tests
- Command: `npm test`
- Result: PASS (48/48 tests, 106 assertions).
