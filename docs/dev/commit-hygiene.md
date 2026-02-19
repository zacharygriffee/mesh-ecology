# Commit Hygiene (Ecology)

Use scope-split commits so runtime changes stay reviewable and process docs do not get mixed into feature diffs.

## Scope buckets

1. Feature/runtime
- `src/**`
- `scripts/**`
- `organisms/**`
- `ratifiers/**`
- `packs/**`
- `test/**`
- `docs/dev/**` (when directly tied to behavior/tests)

2. Process docs
- `AGENTS.md`
- `AGENT_PROMPT.md`

3. Mechanical docs-libs
- `docs/libs/**` (rename/move-only changes)

## Rule

Do not mix buckets in one commit.

## Local check

```bash
npm run commit:check-scope
```

The checker reads staged files and fails if multiple buckets are present.

## Recommended commit sequence

1. Feature commit (`feat`/`fix`): runtime + tests + behavior docs.
2. Process-doc commit (`docs`): `AGENTS.md` / `AGENT_PROMPT.md` only.
3. Mechanical rename commit (`chore(docs)`): `docs/libs/**` rename-only.
