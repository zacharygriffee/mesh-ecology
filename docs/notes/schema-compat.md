Schema Compatibility Notes

Why duplicate fields exist
- Some stored records keep duplicate tier fields (e.g., `t` and `tr`) to stay compatible with earlier writers and to confine agents to explicit shapes instead of “simplifying” schemas.
- Ingress event fields are what projector/handlers emit; stored view fields are what concern.apply persists after validation. The persisted shape may include both legacy (`t`) and canonical (`tr`) keys.
- Older data may contain only `t`; new writes may include both. Readers must treat them as the same tier value.
- Agent confinement: keeping both keys reduces ambiguity so automated agents don’t infer missing fields or collapse the schema.
- This duplication is a storage compatibility/convenience detail, not a new protocol semantic.

Example rat record (view storage)
```json
{
  "d": "accept",
  "tr": "debug",
  "t": "debug",
  "cap": "debug.meta.value/v1",
  "ref": { "k": "<jobKey>", "a": "<attemptToken>", "t": "meta.value/v1" },
  "note": "auto-accepted by debug projector"
}
```
