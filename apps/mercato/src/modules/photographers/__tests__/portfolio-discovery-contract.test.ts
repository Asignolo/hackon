import { preparePortfolioDiscoveryInput, preparePortfolioDiscoveryMaterial } from '../lib/portfolio-discovery-contract'
import { storedMaterialSchema } from '../data/material-validators'
import { discoveryResearch } from './portfolio-discovery-fixture'

const evaluationId = '11111111-1111-4111-8111-111111111111'
const context = { evaluationId, evaluatedAt: '2026-09-19T12:00:00Z', observedAt: '2026-09-19T12:03:00Z' }
const sources = [{ url: 'https://example.test/contact#email', method: 'page_read', evidence: 'Dane kontaktowe studia.' }]
const attributed = { sources, confidence: 'confirmed', approvalRequired: false }

test('preserves exact registration strings in the four-field O1 input', () => {
  expect(preparePortfolioDiscoveryInput({ firstName: ' Anna ', lastName: 'Nowak', email: 'Anna@example.test', portfolioRaw: '' })).toEqual({
    originalPortfolio: '', registrationEmail: 'Anna@example.test', firstName: ' Anna ', lastName: 'Nowak',
  })
})

test('stores links, NIP and city with provenance and leaves identity confirmation to K1', () => {
  const research = discoveryResearch()
  const result = preparePortfolioDiscoveryMaterial({ ...research, data: { ...research.data,
    links: [{ ...attributed, type: 'contact', url: 'https://example.test/', originalUrl: 'https://example.test/' }],
    nip: [{ ...attributed, originalValue: '1234567890', value: '1234567890', checksumValid: false }],
    city: [{ ...attributed, value: 'Kraków' }],
  } }, context)
  expect(result.material.data.traces.map((trace) => trace.kind)).toEqual(['website', 'nip', 'city'])
  for (const trace of result.material.data.traces) {
    expect(trace).toMatchObject({ status: 'unconfirmed', candidateIds: [], provenance: [{ value: expect.stringContaining(sources[0].evidence), sourceRef: sources[0].url, observedAt: context.observedAt }] })
  }
  expect(result.material.data.traces[1].provenance[0].value).toContain('checksumValid=false')
  expect(result.material.data.traces[0].provenance[0].value).toContain('page_read; confidence=confirmed')
  expect(storedMaterialSchema.safeParse({ photographerId: evaluationId, personId: evaluationId, dealId: evaluationId, material: result.material }).success).toBe(true)
})

test('only exhausted discovery with completed coverage and no failures is complete', () => {
  const result = discoveryResearch()
  const data = { ...result.data, attempts: [{ tool: 'web_search', target: '"anna@example.test"', outcome: 'not_found', detail: 'Brak wyników.' }], stopReason: 'search_exhausted', coverage: Object.fromEntries(Object.keys(result.data.coverage).map((key) => [key, 'not_found'])) }
  expect(preparePortfolioDiscoveryMaterial({ ...result, data }, context).material.data.discoveryStatus).toBe('complete')
  for (const outcome of ['blocked', 'unavailable', 'timeout', 'error']) {
    expect(preparePortfolioDiscoveryMaterial({ ...result, data: { ...data, attempts: [{ tool: 'web_fetch', target: sources[0].url, outcome, detail: 'Failure' }] } }, context).material.data.discoveryStatus).toBe('partial')
  }
  expect(preparePortfolioDiscoveryMaterial({ ...result, data: { ...data, attempts: [] } }, context).material.data.discoveryStatus).toBe('partial')
  expect(preparePortfolioDiscoveryMaterial(result, context).material.data.discoveryStatus).toBe('partial')
  expect(preparePortfolioDiscoveryMaterial({ ...result, data: { ...result.data, stopReason: 'tools_unavailable' } }, context).material.data.discoveryStatus).toBe('unavailable')
})

test('duplicates merge evidence and repeated material retains IDs', () => {
  const result = discoveryResearch()
  const link = { ...attributed, type: 'website', url: 'https://example.test/', originalUrl: 'https://example.test/' }
  const first = preparePortfolioDiscoveryMaterial({ ...result, data: { ...result.data, links: [link] } }, context)
  const second = preparePortfolioDiscoveryMaterial({ ...result, data: { ...result.data, links: [link, { ...link, type: 'contact' }] } }, context)
  expect(second.material).toEqual(first.material)
})

test.each(['javascript:alert(1)', 'https://user:password@example.test'])('rejects unsafe source URLs', (url) => {
  const result = discoveryResearch()
  expect(() => preparePortfolioDiscoveryMaterial({ ...result, data: { ...result.data, city: [{ ...attributed, value: 'Kraków', sources: [{ ...sources[0], url }] }] } }, context)).toThrow()
})
