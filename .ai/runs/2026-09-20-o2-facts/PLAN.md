# Demo o2 → facts → existing scoring

Scope: user-authorized isolated Agent 3 slice. No workflow, UI, agent definition,
provider, DI, shared schema, database or global scoring edits.

- [x] Read OUTCOME, normalized provider shapes, material schemas and scoring workflow.
- [x] Implement pure normalization and explicit demo source assumption.
- [x] Classify explicit specialties and retain the source text.
- [x] Store through the existing material command and call the existing calculator.
- [x] Test full, partial, empty, unknown, failure and scoring regression paths.

The existing agent runtime supports schema-bound research classification (see
agent_examples support.ticket_triage), but no existing photographer classifier
exists. A small conservative phrase classifier is sufficient for controlled demo
examples and avoids another model call, prompt and asynchronous run. It handles
explicit Polish/English specialty phrases only, declines negation or multiple
specialties, and returns unknown otherwise. It does not inspect identity or
compare independent sources for attribution.

## Integration contract

Files: photographers/lib/demo-o2-facts.ts and demo-o2-evaluation.ts.

`normalizeDemoO2Facts(outcome, { evaluationId, evaluatedAt })` accepts either the
existing OUTCOME data object or `{ kind: 'research', data: OUTCOME }`. Returns
`{ traces: TracesSnapshot, facts: ResearchFact[], category: PhotographerCategory }`.
It performs no storage reads or writes.

`storeDemoO2Evaluation(input, outcome, ctx: CommandRuntimeContext)` returns:
`{ tracesRef, factsRef, scoreRef, rulesVersion, reviewRequired }`.

Exact input:
```
{
  mode: 'demo',
  sourceAssumption: 'demo-o1-sources-belong-to-photographer-v1',
  evaluationId: UUID,
  evaluatedAt: ISO timestamp with offset,
  o2ResultRef: UUID,
  owners: { registrationId: UUID, photographerId: UUID, personId: UUID, dealId: UUID },
  rulesSnapshot: HiddenPotentialRules
}
```

Call only server-side after the Agent 2 reader has authorized and checked that the
saved o2 result belongs to the same tenant, organization, evaluation and CRM
owners. `outcome` must be that immutable saved result, not an untrusted browser
payload. Reader remains external to this slice. `ctx` is the initiator's scoped
command context. The material command enforces RBAC, owner relationships,
encryption, tenant/organization scope and immutable operation identity. Freeze
`evaluatedAt`, result reference and rules at evaluation start; identical retries
reuse material operation IDs, and changed content under one operation conflicts.
The three writes are sequential, not one transaction: retry safely completes
partial writes; no score is returned before all writes succeed.

This function calls `calculateEvaluationScore`, the exact calculator used by
`scorePhotographerWorkflow`, then saves its result. It does not invoke the workflow
wrapper because that wrapper requires the persisted current step to be `score`
and its context to already contain factsRef. An integrator using that wrapper
should instead store normalized traces/facts in the preceding step, bind factsRef
in persisted workflow context and let the existing score transition run. Do not
run both scoring paths for one evaluation.

## Mapping

- Instagram `data.followersCount` → `instagramFollowers` (integer >= 0).
- Maps place `data.reviewsCount` → `googleMapsReviews`; `data.rating` →
  `googleMapsRating` (0–5). The reviews tool's aggregate fields are fallback when
  place lacks a usable field. Never use sampleSize or individual review ratings.
- Instagram biography/businessCategory, Facebook description/category, Maps
  primaryCategory/categories → category using explicit specialty phrases.
  Source text, field name, URL and provider observedAt are retained in trace
  provenance. Generic photographer, missing content, negation, or several
  specialties → unknown (category fact absent; existing score emits unknown).
- All other facts remain absent/unknown: no registry, post dates, engagement,
  follower growth, printing, website freshness/ownership, calendar or gallery
  inference. A website link alone proves none of those facts.

Only `ok: true` complete/partial provider responses with valid matching envelope
metadata are consumed. Invalid JSON/metadata, failed reads and fields listed in
unavailableFields are omitted. Numeric strings, negatives and fractions for
counts are not coerced. Zero is preserved. No observation timestamp is invented.
Input is bounded to the agent's four calls; duplicate tool results are rejected.
No model confidence or approvalRequired gate is applied in the demo.

Confirmed traces carry ruleId `demo-o1-sources-belong-to-photographer-v1` and the
same explicit marker in provenance. Global confirmed-source validation is
unchanged. Do not expose this adapter as a production scoring endpoint.

## Integrator tasks

No required DI or common-schema changes. Import the function in the integrating
module; if EXECUTE_FUNCTION is chosen, register a scoped wrapper in DI there.
Connect Agent 2's authorized reader, stable result ref, evaluation/owner binding,
original rules snapshot and the intended workflow step. Agent 4 can read facts
and score using the existing material API; classification evidence is in traces.
No new API/UI surface needs integration coverage in this slice. Validate real
storage and the full workflow after integration (existing TC-025 covers the
scoring/material path); this slice's persistence tests use the command bus mock.

## Validation

Runner: local; no running compose app found. Targeted Jest includes new adapter
cases plus unchanged calculator and workflow scoring tests. Full application
build and real-database workflow test are not implied by those unit tests.

Final results: **87/87 tests passed, 5 suites** (demo-o2-facts,
evaluation-scoring, evaluation-scoring-workflow, material-store,
material-command). Focused TypeScript compilation of both new production files
passed. ESLint on all three TS files passed (existing Next pages-directory
warning only). `git diff --check` passed. No auto-discovered file changed, so
`yarn generate` is not required. Full monorepo/app build and live database/E2E
were not run; they remain integration validation, not a claimed result here.

Re-run from the worktree root:
```
node node_modules/jest/bin/jest.js --config apps/mercato/jest.config.cjs --runInBand --runTestsByPath apps/mercato/src/modules/photographers/__tests__/demo-o2-facts.test.ts apps/mercato/src/modules/photographers/__tests__/evaluation-scoring.test.ts apps/mercato/src/modules/photographers/__tests__/evaluation-scoring-workflow.test.ts apps/mercato/src/modules/photographers/__tests__/material-store.test.ts apps/mercato/src/modules/photographers/__tests__/material-command.test.ts
```

Invocation from the integrating server-side function:
```
const savedOutcome = await readAuthorizedO2Result(o2ResultRef, ctx)
const result = await storeDemoO2Evaluation({
  mode: 'demo',
  sourceAssumption: DEMO_O1_SOURCE_ASSUMPTION,
  evaluationId, evaluatedAt, o2ResultRef,
  owners: { registrationId, photographerId, personId, dealId },
  rulesSnapshot,
}, savedOutcome, ctx)
```
`readAuthorizedO2Result` is an illustrative integration call, not an export of
this slice. It must validate the binding described above and enforce permission
to run the evaluation before calling this internal server helper.
