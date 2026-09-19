import { prepareTraceFinderInput, prepareTraceFinderMaterial } from '../lib/trace-finder-contract'
import { traceFinderResultSchema } from '../data/trace-finder-validators'
import { storedMaterialSchema } from '../data/material-validators'

const evaluationId = '11111111-1111-4111-8111-111111111111'
const context = { evaluationId, evaluatedAt: '2026-09-19T12:00:00Z', observedAt: '2026-09-19T12:03:00Z' }
const candidate = { url: 'https://example.test/', kind: 'website', name: 'Studio', evidence: 'Kontakt: Anna@example.test', sourceUrl: 'https://example.test/contact#email' }
const research = { kind: 'research', data: { status: 'complete', candidates: [candidate], summary: 'Znaleziono kandydata.', issues: [] } }

test('agent input preserves registration strings and excludes unrelated fields', () => {
  const registration = { id: evaluationId, firstName: ' Anna ', lastName: 'Przykład', email: 'Anna@example.test', portfolioRaw: ' @studio ', tenantId: evaluationId }
  expect(prepareTraceFinderInput(registration)).toEqual({ registrationId: evaluationId, firstName: ' Anna ', lastName: 'Przykład', email: 'Anna@example.test', portfolioRaw: ' @studio ' })
})

test('email discovery creates compatible unconfirmed material with exact source anchors', () => {
  const prepared = prepareTraceFinderMaterial(research, context)
  expect(prepared.material.data.discoveryStatus).toBe('partial')
  expect(prepared.material.data.traces[0]).toMatchObject({
    status: 'unconfirmed', candidateIds: [], observedAt: context.observedAt,
    provenance: [{ value: 'Studio: Kontakt: Anna@example.test', sourceRef: candidate.sourceUrl, observedAt: context.observedAt }],
  })
  expect(prepared.material.data.traces[0]).not.toHaveProperty('ruleId')
  expect(storedMaterialSchema.safeParse({ photographerId: evaluationId, personId: evaluationId, dealId: evaluationId, material: prepared.material }).success).toBe(true)
})

test('empty successful email discovery is not evidence that all discovery paths are exhausted', () => {
  const prepared = prepareTraceFinderMaterial({ kind: 'research', data: { status: 'no_results', candidates: [], summary: 'Brak wyników po e-mailu.', issues: [] } }, context)
  expect(prepared.research.status).toBe('no_results')
  expect(prepared.material.data).toMatchObject({ discoveryStatus: 'partial', traces: [] })
})

test('unavailable search remains unavailable instead of becoming no results', () => {
  const prepared = prepareTraceFinderMaterial({ kind: 'research', data: { status: 'unavailable', candidates: [], summary: 'Wyszukiwanie niedostępne.', issues: ['Brak dostawcy.'] } }, context)
  expect(prepared.material.data.discoveryStatus).toBe('unavailable')
  expect(prepared.research.issues).toEqual(['Brak dostawcy.'])
})

test('replays and reordered candidates retain IDs, duplicates retain distinct evidence', () => {
  const extra = { ...candidate, url: 'https://example.test/second' }
  const first = prepareTraceFinderMaterial({ ...research, data: { ...research.data, candidates: [candidate, extra] } }, context)
  const second = prepareTraceFinderMaterial({ ...research, data: { ...research.data, candidates: [extra, candidate, { ...candidate, evidence: 'Drugie potwierdzenie e-maila.' }] } }, context)
  const original = first.material.data.traces.find((trace) => trace.value === candidate.url)!
  const repeated = second.material.data.traces.find((trace) => trace.value === candidate.url)!
  expect(repeated.id).toBe(original.id)
  expect(repeated.provenance).toHaveLength(2)
  expect(second.material.data.traces).toHaveLength(2)
})

test('hash-routed profiles stay distinct and other public pages map to website', () => {
  const result = prepareTraceFinderMaterial({ ...research, data: { ...research.data, candidates: ['a', 'b'].map((profile) => ({ ...candidate, kind: 'other', url: `https://example.test/#/${profile}` })) } }, context)
  expect(result.material.data.traces).toHaveLength(2)
  expect(result.material.data.traces.map((trace) => trace.kind)).toEqual(['website', 'website'])
})

test.each([
  { ...research.data, candidates: [] },
  { ...research.data, status: 'no_results' },
  { ...research.data, status: 'partial', issues: [] },
  { ...research.data, candidates: Array(6).fill(candidate) },
  { ...research.data, candidates: [{ ...candidate, url: 'javascript:alert(1)' }] },
  { ...research.data, candidates: [{ ...candidate, sourceUrl: 'https://user:password@example.test' }] },
  { ...research.data, candidates: [{ ...candidate, identityConfirmed: true }] },
])('rejects inconsistent, unsafe or oversized research', (data) => {
  expect(traceFinderResultSchema.safeParse({ kind: 'research', data }).success).toBe(false)
})

test('conflicting classifications do not silently overwrite each other', () => {
  expect(() => prepareTraceFinderMaterial({ ...research, data: { ...research.data, candidates: [candidate, { ...candidate, kind: 'instagram' }] } }, context)).toThrow('Conflicting O2 candidate kinds')
})
