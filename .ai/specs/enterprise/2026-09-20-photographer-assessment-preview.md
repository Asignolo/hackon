# Photographer assessment preview

Status: integrated with saved Apify O2 and demo workflow v3.

## Scope

Read-only continuation of `2026-09-19-photographer-hidden-potential-mvp.md` for the parallel Agent 4 task. Registration, CRM person/opportunity links, persisted workflow status, o1 sources, facts/category, score/rationale and missing data appear on `/backend/photographers/assessment?evaluationId=<uuid>&registrationId=<uuid>`. No identity confirmation or business mutations. The demo launch result links to the assessment.

## Read contract

`GET /api/photographers/assessments/{evaluationId}?registrationId={uuid}` returns `AssessmentResponse` in `photographers/data/assessment-validators.ts`; OpenAPI is exported by the route.

- Registration: original first/last name, email, portfolio text, timestamps and ID.
- Owners: photographer entity ID, person profile ID, deal ID and links, or null while CRM is pending/unavailable.
- Source: real, demo_fixture, unknown. Demo payloads are excluded. Unknown origin is explicitly warned about.
- Process: workflow ID, actual status, current step ID and safe error code. No success inferred from existence of CRM or runs.
- Stages: latest workflow step instances; saved summary statuses only when no actual steps are available.
- Materials: traces/facts/score/summary slots with status, material ID and typed data. Each material passes existing encrypted integrity/ownership checks. Invalid references (facts→traces, score→facts) suppress dependent data.
- O1: optional separately bound original O1 traces, independent of normalized scoring traces.
- Research: saved Apify manifest and payload parts, bound to the evaluation owners and workflow; run errors never display as completed. The separate frontend ResearchView supports waiting, partial, completed, failed and unavailable, plus source read statuses and summary. This is a display contract, not a replacement o2 storage schema.

All reads use authenticated tenant/selected organization, existing wildcard-aware RBAC and encryption helpers. Features: photographers.view, photographers.evaluations.view, customers.people.view, customers.deals.view, customers.pipelines.view, customers.interactions.view, workflows.instances.view. Responses are no-store. Scope changes remount the loader and abort stale requests. HTTP 401/403, 404, invalid input and read errors have distinct states. External links permit only credential-free HTTP(S).

## Integrated bindings

1. Demo v3 supplies the assessment link with the actual evaluationId and registrationId.
2. O2 reads persisted Apify manifest/parts via the authorized reader. Explicit workflow refs take precedence; ownership/workflow mismatches are rejected.
3. `context.demoScore.result` supplies exact final tracesRef/factsRef/scoreRef. Original O1 sources remain separately readable through `context.o1Result.result.tracesRef`.
4. PL/EN stage labels include prepare_o2, apify_o2 and normalize. Other locales currently use English fallback values.

## Migration & Backward Compatibility

Additive app-local page, endpoint and read adapter. Existing response fields remain compatible; new O1 and research fields are additive. No database changes, dependencies or mutations in the read boundary. Run `yarn generate` after integration.

## Verification

- Unit/component: pending/partial/completed/failed, partial o2 presentation, demo exclusion, missing and corrupt materials, RBAC/scoping, ID/revision mismatch, unsafe URLs, organization switch and stale response cancellation.
- Integration: `TC-PHOTOGRAPHERS-027-assessment-view.spec.ts` creates and cleans its own registration/CRM fixture; covers real GET pending/no-store, not-found registration, page render, no writes and controlled 403 on refresh. Executed against the integrated checkout; see the integration run report.
- Visual: actual component and application CSS in isolated test-only browser host, pending/partial/completed/failed, desktop and narrow viewport. No live o2 run claimed.

## Changelog

- 2026-09-20: Added read-only assessment preview and explicit integration boundaries.
- 2026-09-20: Connected demo v3, saved O2, original O1 sources and final score references; added navigation and real API/browser verification.
