# Generic Cap Guardrails

Mesh-owned interop caps should stay generic and concern-local.

Do not add new adjacent-repo cap namespaces. Examples include app/repo names
under `cap/<repo>/...`.

Use a Mesh-owned concern convention instead:

- `cap/concern/call-for-responses/v1`
- `cap/concern/request-review/v1`
- `cap/concern/request-admission/v1`
- `cap/concern/request-observation/v1`

Carry producer-specific meaning in payload fields:

```json
{
  "profile": "local_layer_need_call",
  "producer": {
    "repo": "sample-adapter",
    "surface": "local-layer"
  }
}
```

This keeps Mesh from becoming an app/domain ontology. Adjacent repos own their
domain semantics; Mesh owns generic concern-local coordination and evidence
conventions.

Run the tripwire with:

```bash
npm run caps:check
```

App-specific caps should be replaced with a generic `cap/concern/.../v1`
convention unless the user explicitly authorizes a compatibility exception.
