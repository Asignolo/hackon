---
kind: research
---
```json
{
  "type": "object",
  "additionalProperties": false,
  "required": ["status", "candidates", "summary", "issues"],
  "properties": {
    "status": { "type": "string", "enum": ["complete", "partial", "no_results", "unavailable"] },
    "candidates": {
      "type": "array",
      "items": {
        "type": "object",
        "additionalProperties": false,
        "required": ["url", "kind", "name", "evidence", "sourceUrl"],
        "properties": {
          "url": { "type": "string", "minLength": 1 },
          "kind": { "type": "string", "enum": ["website", "instagram", "facebook", "google_maps", "other"] },
          "name": { "type": "string", "minLength": 1 },
          "evidence": { "type": "string", "minLength": 1 },
          "sourceUrl": { "type": "string", "minLength": 1 }
        }
      }
    },
    "summary": { "type": "string", "minLength": 1 },
    "issues": { "type": "array", "items": { "type": "string", "minLength": 1 } }
  }
}
```

Return the research data object itself, not a data wrapper. Candidates are unconfirmed public traces, never identity decisions. Use only observed public HTTP(S) URLs for url and sourceUrl. At most five candidates; keep name under 200 characters, evidence under 1000, summary under 2000, and each issue under 500. Return at most ten issues.

complete requires at least one candidate. no_results and unavailable require an empty candidates array. partial and unavailable require at least one concrete issue. Do not return no_results for a search provider error or degraded search. A snippet-only candidate must say so in evidence. Use Polish for name, evidence, summary and issues where appropriate; preserve actual source names and URLs.
