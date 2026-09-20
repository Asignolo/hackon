# Agent 4 handoff — photographer assessment preview

## Delivered

Read-only guarded page: `/backend/photographers/assessment?evaluationId=<uuid>&registrationId=<uuid>`.

API: `GET /api/photographers/assessments/<evaluationId>?registrationId=<uuid>`.

Registration and CRM links, actual workflow status/latest stage attempts, saved o1 sources, facts/category, saved score and rules, missing facts, partial data, missing/corrupt/unavailable results, failed process, forbidden/not-found states. No identity approval, message action, writes or demo injection. Refresh performs GET only. Organization changes abort outstanding requests and remove old data.

Full response, ACL list and integration hooks: `.ai/specs/enterprise/2026-09-20-photographer-assessment-preview.md`.

## Files and ownership

All application files below are under `apps/mercato/src/modules/photographers/`:

- `data/assessment-validators.ts`: API contract.
- `lib/assessment-read.ts`: scoped server adapter and workflow/source bindings.
- `api/assessments/[evaluationId]/route.ts`: authorized GET + OpenAPI.
- `lib/assessment-view.ts`: client loader, response validation, view mapping and safe source URLs.
- `components/AssessmentPage.tsx`: scoped async load, refresh, missing/access/error states.
- `components/AssessmentDetails.tsx`: presentation, including normalized `ResearchDetails`.
- `backend/photographers/assessment/{page.tsx,page.meta.ts}`: guarded route.
- `i18n/{pl,en,de,es,ko}.json`: added assessment labels; PL/EN provided, other locales currently English fallback.
- `__tests__/assessment-{client,read,route}.test.ts`, `assessment-view.test.tsx`, `assessment-fixture.ts`: controlled test data and regression coverage.
- `__integration__/TC-PHOTOGRAPHERS-027-assessment-view.spec.ts`: self-cleaning real API + page smoke coverage for integrated environment.

No changes to other agents' adapters/workflows or demo launch forms.

## Integrator work

1. Add navigation from the real launch result to the page with its real registration/evaluation IDs. The page intentionally has no unbound menu item.
2. Confirm final workflow ID/context shape in `assessmentWorkflowSource` and the workflow lookup in `assessment-read.ts`. Current binding understands top-level IDs, `demo` and `o1Preparation.result`; do not infer real provenance from an arbitrary run.
3. Connect persisted o2 material via `assessment-validators.ts` and `assessment-read.ts`, then map it in `toAssessmentView`. Until then the normal app explicitly reports o2 unavailable/contract_pending. Partial o2 presentation is implemented and tested, not live-connected.
4. Keep exact evaluation/registration/CRM owners and material links (`facts.tracesRef`, `score.factsRef`). Extend final fact/schema mappings only if Agent 3 changes the existing contracts.
5. Run `yarn generate`, the full project gate and TC-PHOTOGRAPHERS-027 after integration. Validate a real o1→o2→score run; none is claimed by this change.

## Validation

Runner: local. `yarn generate` passed (unrelated generated changes discarded). Native app typecheck passed. 56 focused service/route/client/component tests passed across four suites, including scoped access, reference mismatches, conflicting workflows, stale summaries, pending/partial/completed/failed, demo exclusion, shared transport ForbiddenError and organization-switch cancellation.

Browser: actual components/application CSS in a separate test-only host, with real shared API transport and controlled data. Checked desktop/narrow viewport, pending/partial/completed/failed and 403. No horizontal overflow at the browser's minimum 500px width; unsafe source URL rendered as text, not a link. This is component visual QA, not end-to-end QA against the live database or o2.

Full build did not pass: default Turbopack rejects dependencies symlinked outside this isolated worktree. Alternative Webpack build reports missing optional `@valkey/valkey-glide` and `fs`/`tls`/`net` resolution through existing dependencies outside Photographers. No framework/dependency changes were made to work around those failures.

The live app serves the main checkout. Playwright discovers the new integration smoke test (1 test); it is shipped for the integrated checkout; no real database E2E result is claimed.
