---
kind: research
---
```json
{
  "type": "object",
  "additionalProperties": false,
  "required": [
    "schemaVersion",
    "status",
    "stopReason",
    "portfolio",
    "links",
    "nip",
    "city",
    "coverage",
    "approvalRequired",
    "attempts",
    "summary"
  ],
  "properties": {
    "schemaVersion": {
      "const": 1
    },
    "status": {
      "type": "string",
      "enum": [
        "complete",
        "partial",
        "no_results",
        "no_portfolio",
        "invalid_input"
      ]
    },
    "stopReason": {
      "type": "string",
      "enum": [
        "search_exhausted",
        "budget_exhausted",
        "no_portfolio",
        "invalid_input",
        "tools_unavailable"
      ]
    },
    "portfolio": {
      "type": "object",
      "additionalProperties": false,
      "required": [
        "kind",
        "originalValue",
        "normalizedValue",
        "resolvedUrl",
        "status"
      ],
      "properties": {
        "kind": {
          "type": "string",
          "enum": [
            "website_url",
            "social_profile_url",
            "google_maps_url",
            "gallery_url",
            "domain",
            "account_name",
            "missing",
            "invalid"
          ]
        },
        "originalValue": {
          "type": "string",
          "nullable": true
        },
        "normalizedValue": {
          "type": "string",
          "minLength": 1,
          "nullable": true
        },
        "resolvedUrl": {
          "type": "string",
          "minLength": 1,
          "nullable": true
        },
        "status": {
          "type": "string",
          "enum": [
            "resolved",
            "partial",
            "unresolved"
          ]
        }
      }
    },
    "links": {
      "type": "array",
      "items": {
        "type": "object",
        "additionalProperties": false,
        "required": [
          "type",
          "originalUrl",
          "url",
          "confidence",
          "approvalRequired",
          "sources"
        ],
        "properties": {
          "type": {
            "type": "string",
            "enum": [
              "website",
              "contact",
              "instagram",
              "facebook",
              "google_maps"
            ]
          },
          "originalUrl": {
            "type": "string",
            "minLength": 1
          },
          "url": {
            "type": "string",
            "minLength": 1
          },
          "confidence": {
            "type": "string",
            "enum": [
              "confirmed",
              "probable",
              "unconfirmed",
              "conflict"
            ]
          },
          "approvalRequired": {
            "type": "boolean"
          },
          "sources": {
            "type": "array",
            "minItems": 1,
            "items": {
              "type": "object",
              "additionalProperties": false,
              "required": [
                "url",
                "method",
                "evidence"
              ],
              "properties": {
                "url": {
                  "type": "string",
                  "minLength": 1
                },
                "method": {
                  "type": "string",
                  "enum": [
                    "page_read",
                    "page_link",
                    "search_result",
                    "redirect"
                  ]
                },
                "evidence": {
                  "type": "string",
                  "minLength": 1
                }
              }
            }
          }
        }
      }
    },
    "nip": {
      "type": "array",
      "items": {
        "type": "object",
        "additionalProperties": false,
        "required": [
          "originalValue",
          "value",
          "checksumValid",
          "confidence",
          "approvalRequired",
          "sources"
        ],
        "properties": {
          "originalValue": {
            "type": "string",
            "minLength": 1
          },
          "value": {
            "type": "string",
            "minLength": 1
          },
          "checksumValid": {
            "type": "boolean"
          },
          "confidence": {
            "type": "string",
            "enum": [
              "confirmed",
              "probable",
              "unconfirmed",
              "conflict"
            ]
          },
          "approvalRequired": {
            "type": "boolean"
          },
          "sources": {
            "type": "array",
            "minItems": 1,
            "items": {
              "type": "object",
              "additionalProperties": false,
              "required": [
                "url",
                "method",
                "evidence"
              ],
              "properties": {
                "url": {
                  "type": "string",
                  "minLength": 1
                },
                "method": {
                  "type": "string",
                  "enum": [
                    "page_read",
                    "page_link",
                    "search_result",
                    "redirect"
                  ]
                },
                "evidence": {
                  "type": "string",
                  "minLength": 1
                }
              }
            }
          }
        }
      }
    },
    "city": {
      "type": "array",
      "items": {
        "type": "object",
        "additionalProperties": false,
        "required": [
          "value",
          "confidence",
          "approvalRequired",
          "sources"
        ],
        "properties": {
          "value": {
            "type": "string",
            "minLength": 1
          },
          "confidence": {
            "type": "string",
            "enum": [
              "confirmed",
              "probable",
              "unconfirmed",
              "conflict"
            ]
          },
          "approvalRequired": {
            "type": "boolean"
          },
          "sources": {
            "type": "array",
            "minItems": 1,
            "items": {
              "type": "object",
              "additionalProperties": false,
              "required": [
                "url",
                "method",
                "evidence"
              ],
              "properties": {
                "url": {
                  "type": "string",
                  "minLength": 1
                },
                "method": {
                  "type": "string",
                  "enum": [
                    "page_read",
                    "page_link",
                    "search_result",
                    "redirect"
                  ]
                },
                "evidence": {
                  "type": "string",
                  "minLength": 1
                }
              }
            }
          }
        }
      }
    },
    "coverage": {
      "type": "object",
      "additionalProperties": false,
      "required": [
        "website",
        "contact",
        "instagram",
        "facebook",
        "google_maps",
        "nip"
      ],
      "properties": {
        "website": {
          "type": "string",
          "enum": [
            "found",
            "not_found",
            "blocked",
            "error",
            "not_checked"
          ]
        },
        "contact": {
          "type": "string",
          "enum": [
            "found",
            "not_found",
            "blocked",
            "error",
            "not_checked"
          ]
        },
        "instagram": {
          "type": "string",
          "enum": [
            "found",
            "not_found",
            "blocked",
            "error",
            "not_checked"
          ]
        },
        "facebook": {
          "type": "string",
          "enum": [
            "found",
            "not_found",
            "blocked",
            "error",
            "not_checked"
          ]
        },
        "google_maps": {
          "type": "string",
          "enum": [
            "found",
            "not_found",
            "blocked",
            "error",
            "not_checked"
          ]
        },
        "nip": {
          "type": "string",
          "enum": [
            "found",
            "not_found",
            "blocked",
            "error",
            "not_checked"
          ]
        }
      }
    },
    "approvalRequired": {
      "type": "boolean"
    },
    "attempts": {
      "type": "array",
      "items": {
        "type": "object",
        "additionalProperties": false,
        "required": [
          "tool",
          "target",
          "outcome",
          "detail"
        ],
        "properties": {
          "tool": {
            "type": "string",
            "enum": [
              "web_search",
              "web_fetch",
              "run_skill_script"
            ]
          },
          "target": {
            "type": "string",
            "minLength": 1
          },
          "outcome": {
            "type": "string",
            "enum": [
              "opened",
              "found",
              "not_found",
              "dead",
              "empty",
              "blocked",
              "unavailable",
              "timeout",
              "error"
            ]
          },
          "detail": {
            "type": "string",
            "minLength": 1
          }
        }
      }
    },
    "summary": {
      "type": "string",
      "minLength": 1
    }
  }
}
```

Return the inner data object as the outcome argument of submit_outcome, never a JSON string or
an extra kind/data wrapper. Runtime wraps it as { kind: 'research', data }.

All fields are required. Empty arrays mean no source-backed candidates; never manufacture an
empty candidate, a URL or a NIP. Do not echo registration email/name as discovered facts.
Original portfolio is preserved verbatim, including blank text; originalValue may be null only
when malformed input did not contain a string. Unknown normalizedValue/resolvedUrl is null.
All link/source/resolved URLs must be absolute HTTP(S) URLs without credentials. A source is the
actual page/result where the item was observed, not a guessed search-engine URL.

Each source method is literal: page_read = observed readable content, page_link = an observed
outgoing link, search_result = returned result/snippet/content clearly identified as such,
redirect = a destination actually reported by a fetch. Evidence is a brief Polish paraphrase
explaining attribution, not a copy of a whole page or a claim that an unopened page was read.

Per-item confidence is confirmed/probable/unconfirmed/conflict. Only confirmed items can have
approvalRequired false; every other level requires true. A NIP with checksumValid false cannot
be confirmed or automatically used for a registry lookup. Top-level approvalRequired is true
when any retained item requires review or competing identities remain unresolved. Missing NIP
alone does not require approval. These flags do not create a proposal or human task.

Keep at most one link for each of website/contact/instagram/facebook/google_maps. Merge duplicate
observations and sources. Preserve distinct NIP candidates, with source evidence for each; do
not merge different people under one identity. A city is an observed clue, not required for
completion. No follower/activity/profile datasets or actor configuration belong in the result.

Coverage found means a sourced candidate exists, even when it requires review. Not_found means
a completed usable check found no candidate. Blocked/error mean the check was prevented or
failed; not_checked means it was not attempted. If there is a usable sourced candidate despite
another failed attempt, use found and record the failure in attempts/summary.

Status and stopping rules:
- complete requires all five link types confirmed, at least one confirmed checksum-valid NIP,
  approvalRequired false, all coverage found, and search_exhausted. A missing or dead supplied
  portfolio does not prevent complete discovery from email; its own status remains unresolved.
  A discovered website belongs in links, never replaces the original supplied portfolio.
- partial means at least one sourced item exists but complete is not justified. Missing city
  alone is not a reason for partial. A single confirmed profile without the other targets is partial.
- no_results means links/nip/city are all empty after attempted discovery. stopReason and coverage
  distinguish a completed negative search from unfinished checks and infrastructure failures.
- no_portfolio status and stopReason are deprecated, retained only so historical results remain
  readable. Never emit them in new runs. For missing portfolio, keep portfolio.kind missing,
  status unresolved and normalizedValue/resolvedUrl null; search the exact full email and
  return complete, partial or no_results according to evidence and actual stopping conditions.
  Missing or dead portfolio never implies low potential or that the person is not a target customer.
- invalid_input requires unresolved portfolio, null resolvedUrl, empty item/attempt arrays,
  all coverage not_checked, approvalRequired false and stopReason invalid_input. Describe the
  malformed input briefly without inventing replacement values.
- search_exhausted means the defined discovery path is finished, never blocked/error/not_checked
  coverage or known incomplete extraction preventing relevant checks. Never infer global absence.
- budget_exhausted means a call/time/depth/step budget stopped useful remaining work; preserve
  completed evidence and leave untouched coverage not_checked.
- tools_unavailable means infrastructure prevented remaining discovery. Preserve findings and
  distinguish unavailable/error/blocked attempts from not_found.

attempts records actual tool calls, including retries; a query is recorded verbatim as target.
Do not invent calls to satisfy completeness. Record helper failures with tool run_skill_script;
successful checksum checks need not duplicate the NIP data in attempts. Summary explains both
findings and limitations in concise Polish. Cross-field rules above are behavioral instructions;
the supported JSON Schema validates structure but cannot express conditional relationships.
