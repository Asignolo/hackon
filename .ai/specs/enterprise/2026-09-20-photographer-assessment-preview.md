# Photographer assessment preview

Status: implemented read boundary and view; integration with new o2 and workflow contracts pending.

## Scope

Read-only continuation of `2026-09-19-photographer-hidden-potential-mvp.md` for the parallel Agent 4 task. Registration, CRM person/opportunity links, persisted workflow status, o1 sources, facts/category, score/rationale and missing data appear on `/backend/photographers/assessment?evaluationId=<uuid>&registrationId=<uuid>`. No identity confirmation or business mutations. Existing launch forms and other agents' adapters remain unchanged.

## Read contract

`GET /api/photographers/assessments/{evaluationId}?registrationId={uuid}` returns `AssessmentResponse` in `photographers/data/assessment-validators.ts`; OpenAPI is exported by the route.

- Registration: original first/last name, email, portfolio text, timestamps and ID.
- Owners: photographer entity ID, person profile ID, deal ID and links, or null while CRM is pending/unavailable.
- Source: real, demo_fixture, unknown. Demo payloads are excluded. Unknown origin is explicitly warned about.
- Process: workflow ID, actual status, current step ID and safe error code. No success inferred from existence of CRM or runs.
- Stages: latest workflow step instances; saved summary statuses only when no actual steps are available.
- Materials: traces/facts/score/summary slots with status, material ID and typed data. Each material passes existing encrypted integrity/ownership checks. Invalid references (facts→traces, score→facts) suppress dependent data.
- Research: unavailable/contract_pending until o2 storage contract is merged. The separate frontend ResearchView supports waiting, partial, completed, failed and unavailable, plus source read statuses and summary. This is a display contract, not a replacement o2 storage schema.

All reads use authenticated tenant/selected organization, existing wildcard-aware RBAC and encryption helpers. Features: photographers.view, photographers.evaluations.view, customers.people.view, customers.deals.view, customers.pipelines.view, customers.interactions.view, workflows.instances.view. Responses are no-store. Scope changes remount the loader and abort stale requests. HTTP 401/403, 404, invalid input and read errors have distinct states. External links permit only credential-free HTTP(S).

## Integration hooks

1. Agent 1: link to the page with actual evaluationId and registrationId. Adapt the workflow context filter and `assessmentWorkflowSource` when its final context/workflow ID differs; keep explicit demo provenance.
2. Agent 2: add the final persisted o2 contract to `assessment-validators.ts` and read it in `assessment-read.ts`. Map it in `toAssessmentView` in `assessment-view.ts`, using `researchViewSchema`; never import test fixtures into application code.
3. Agent 3: persist material registration/owner/evaluation IDs and exact tracesRef/factsRef chain. Existing facts and score schemas are already rendered. Extend mappings if the final contract changes.
4. Extend locale step names for new workflow step IDs. PL/EN copy included; other locales currently use English fallback values.

## Migration & Backward Compatibility

Additive app-local page, endpoint and read adapter. No existing API changes, database changes, dependencies, workflow behavior changes or mutations. Run `yarn generate` after integration.

## Verification

- Unit/component: pending/partial/completed/failed, partial o2 presentation, demo exclusion, missing and corrupt materials, RBAC/scoping, ID/revision mismatch, unsafe URLs, organization switch and stale response cancellation.
- Integration: `TC-PHOTOGRAPHERS-027-assessment-view.spec.ts` creates and cleans its own registration/CRM fixture; covers real GET pending/no-store, not-found registration, page render, no writes and controlled 403 on refresh. Requires an app serving this checkout; not executed in this task.
- Visual: actual component and application CSS in isolated test-only browser host, pending/partial/completed/failed, desktop and narrow viewport. No live o2 run claimed.

## Changelog

- 2026-09-20: Added read-only assessment preview and explicit integration boundaries.
