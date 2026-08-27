# Knowledge packs

Knowledge packs attach optional, source-attributed annotations to verified port observations. The
loader reads JSON files on every scan, so edits take effect without restarting the app.

## Locations and precedence

1. `resources/packs/` — built-in packs
2. the app user-data `packs/` directory — machine-specific packs
3. `.portviz/packs/` — workspace-specific packs

Later locations override earlier packs with the same `id`. Set `enabledByDefault` to `false` in an
override to disable that ID. Disable all pack evaluation from Settings.

## Example

```json
{
  "schemaVersion": 1,
  "id": "example.local-service",
  "name": "Example local service",
  "version": 1,
  "enabledByDefault": true,
  "rules": [
    {
      "id": "process-hint",
      "when": {
        "all": [
          { "field": "process.name", "contains": "example" },
          { "field": "endpoint.port", "min": 3000, "max": 9999 }
        ]
      },
      "annotate": {
        "service.family": "example",
        "service.kind": "local-api"
      },
      "confidence": 0.85
    }
  ]
}
```

## Match fields

- `process.name`
- `process.path`
- `process.commandLine`
- `endpoint.protocol`
- `endpoint.address`
- `endpoint.port`
- `endpoint.state`
- `endpoint.exposure`
- `service.label`

Conditions support `equals`, `contains`, `oneOf`, `min`, and `max`. All conditions in a rule must
match. Regular expressions and executable code are deliberately excluded from data packs; advanced
enrichers should run through a future isolated plugin boundary.

Validate contributions against `resources/packs/knowledge-pack.schema.json`. Use narrow evidence,
conservative confidence values, stable annotation keys, and no credentials or user-specific paths.
