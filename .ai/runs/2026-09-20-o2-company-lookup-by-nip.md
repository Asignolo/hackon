# O2 company lookup by NIP

Source doc: .ai/specs/enterprise/2026-09-20-o2-company-lookup-by-nip.md

## Goal and scope

Add one bounded CEIDG lookup tool to the existing Apify provider, then enable O2 to use an evidenced NIP from O1. Reuse tenant credentials, ACL, executor, cost controls and research output. No new UI, schema, dependencies, arbitrary actor execution or CRM writes.

## Implementation Plan

### Phase 1: Company research

1.1 Add verified actor catalog metadata, checksum-validating NIP target, limited result normalizer, tool registration and provider regression tests.
1.2 Extend O2 allowlist, prompt, outcome, sample and loader/contract tests while preserving existing social inputs.
1.3 Run focused tests, configured validation gate, review and demo verification; record actual limitations.

## Risks

External actor availability and paid runs remain subject to existing budgets. Metadata verified from public Apify API on 2026-09-20, pinned build 3.0.7. Live smoke needs configured demo credentials. Runner: local (no running compose app). Full repository dependencies may need installation.

Engine: om-auto-create-pr (steps: 3, --loop: no)

## Progress

PR: #9

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles.

### Phase 1: Company research

- [x] 1.1 Add verified CEIDG provider and tests — 2fa9122c
- [x] 1.2 Connect O2 and test compatibility — 63434c32
- [ ] 1.3 Complete validation, review and demo verification
