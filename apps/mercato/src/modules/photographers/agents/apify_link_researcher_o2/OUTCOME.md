---
kind: research
---
```json
{
  "type": "object",
  "additionalProperties": false,
  "required": ["schemaVersion", "status", "results", "skipped", "summary"],
  "properties": {
    "schemaVersion": { "const": 1 },
    "status": { "type": "string", "enum": ["complete", "partial", "no_data", "no_targets", "invalid_input", "error"] },
    "results": {
      "type": "array",
      "items": {
        "type": "object",
        "additionalProperties": false,
        "required": ["tool", "url", "confidence", "approvalRequired", "status", "actorRunId", "observedAt", "resultJson", "error"],
        "properties": {
          "tool": { "type": "string", "enum": ["integration_apify.scrape_ceidg_company", "integration_apify.scrape_instagram_profile", "integration_apify.scrape_facebook_page", "integration_apify.scrape_google_maps_place", "integration_apify.scrape_google_maps_reviews"] },
          "url": { "type": "string", "minLength": 1 },
          "confidence": { "type": "string", "enum": ["confirmed", "probable", "unconfirmed"] },
          "approvalRequired": { "type": "boolean" },
          "status": { "type": "string", "enum": ["complete", "partial", "no_data", "error"] },
          "actorRunId": { "type": "string", "nullable": true },
          "observedAt": { "type": "string", "nullable": true },
          "resultJson": { "type": "string", "nullable": true },
          "error": { "type": "string", "nullable": true }
        }
      }
    },
    "skipped": {
      "type": "array",
      "items": {
        "type": "object",
        "additionalProperties": false,
        "required": ["url", "reason"],
        "properties": {
          "url": { "type": "string", "nullable": true },
          "reason": { "type": "string", "minLength": 1 }
        }
      }
    },
    "summary": { "type": "string", "minLength": 1 }
  }
}
```

resultJson is JSON.stringify of the full normalized provider response. It preserves
the social and company registry data shapes without maintaining a duplicate provider
schema here. Tool traces remain the authoritative record. Submit this data object
directly; the runtime adds the research envelope.

For the CEIDG tool, url identifies the input NIP evidence from O1, not a registry
entry. The normalized provider result in resultJson carries the returned NIP and
company fields; preserve the input attribution flags without asserting ownership.
