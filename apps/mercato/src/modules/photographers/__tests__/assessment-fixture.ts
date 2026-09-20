import type { AssessmentView } from '../lib/assessment-view'

const evaluationId = '11111111-1111-4111-8111-111111111111'
const registrationId = '22222222-2222-4222-8222-222222222222'
const timestamp = '2026-09-20T10:00:00.000Z'
const missing = { status: 'missing' as const, id: null, data: null }
export function emptyAssessmentFixture(): AssessmentView {
  return {
    evaluationId, registration: { id: registrationId, firstName: 'Anna', lastName: 'Photo', email: 'anna@example.test', portfolioRaw: 'https://example.test', submittedAt: timestamp, updatedAt: timestamp },
    owners: { photographerId: evaluationId, personId: evaluationId, dealId: registrationId, links: { person: `/backend/customers/people/${evaluationId}`, deal: `/backend/customers/deals/${registrationId}` } },
    source: 'real', process: { workflowInstanceId: evaluationId, status: 'pending', currentStepId: null, errorCode: null }, stages: [],
    materials: { traces: missing, facts: missing, score: missing, summary: missing }, research: { status: 'unavailable', reason: 'contract_pending' }, researchView: { status: 'unavailable', summary: null, sources: [] },
  }
}
export function assessmentFixture(overrides: Partial<AssessmentView> = {}): AssessmentView {
  const data = emptyAssessmentFixture()
  data.materials.traces = { status: 'available', id: evaluationId, data: { schemaVersion: 1, evaluationId, evaluatedAt: timestamp, discoveryStatus: 'partial', traces: [{ schemaVersion: 1, id: registrationId, kind: 'website', value: 'https://portfolio.example.test', status: 'confirmed', provenance: [{ value: 'Saved discovery evidence', sourceRef: 'javascript:alert(1)', observedAt: timestamp }], observedAt: timestamp, candidateIds: [] }] } }
  data.materials.facts = { status: 'available', id: evaluationId, data: { schemaVersion: 1, evaluationId, evaluatedAt: timestamp, tracesRef: evaluationId, facts: [{ schemaVersion: 1, key: 'category', owner: 'portfolio', state: 'known', value: 'wedding', traceId: registrationId, sourceRef: 'https://portfolio.example.test', observedAt: timestamp, readStatus: 'partial', reason: 'Saved category evidence' }] } }
  data.materials.score = { status: 'available', id: evaluationId, data: { schemaVersion: 1, evaluationId, factsRef: evaluationId, rulesVersion: 'rules-test-v1', evaluatedAt: timestamp, score: 7, matchedRules: [{ ruleId: 'saved-rule', factKey: 'category', sourceRef: 'https://portfolio.example.test', points: 7 }], flags: [], category: 'wedding', suggestedAction: 'observe', unknownFactKeys: ['instagramFollowers'] } }
  return { ...data, ...overrides }
}
