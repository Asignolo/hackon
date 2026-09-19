import { factsSnapshotSchema, researchFactSchema, type ResearchFact } from '../data/evaluation-validators'
import { calculateEvaluationScore } from '../lib/evaluation-scoring'
import { DEFAULT_HIDDEN_POTENTIAL_RULES } from '../lib/rules-config'

const evaluationId = '10000000-0000-4000-8000-000000000001'
const factsRef = '10000000-0000-4000-8000-000000000002'
const evaluatedAt = '2026-09-19T12:00:00Z'
function fact(key: ResearchFact['key'], value: unknown, readStatus = 'ok'): ResearchFact {
  const owner = ['nipConfirmed', 'businessStartedAt', 'vatStatus', 'photographicPkd', 'businessStatus'].includes(key)
    ? 'registry' : key.startsWith('instagram') || key.startsWith('facebook') ? 'social' : 'portfolio'
  return researchFactSchema.parse({
    schemaVersion: 1, key, value, state: value === null ? 'unknown' : 'known', owner,
    traceId: evaluationId, sourceRef: `https://example.com/${key}`, observedAt: evaluatedAt, readStatus,
  })
}
function score(facts: ResearchFact[], date = evaluatedAt, rules = DEFAULT_HIDDEN_POTENTIAL_RULES) {
  return calculateEvaluationScore({ facts: factsSnapshotSchema.parse({
    schemaVersion: 1, evaluationId, evaluatedAt: date, tracesRef: evaluationId, facts,
  }), factsRef, rules })
}
const fullFacts = () => [
  fact('nipConfirmed', true), fact('businessStartedAt', '2020-01-01T00:00:00Z'),
  fact('vatStatus', 'active'), fact('photographicPkd', true), fact('showsPrint', true),
  fact('instagramLastPostAt', evaluatedAt), fact('instagramFollowers', 1000),
  fact('instagramEngagement', { rate: 0.03, analyzedPostCount: 12 }),
  fact('facebookLastPostAt', evaluatedAt), fact('ownDomain', true), fact('websiteCurrent', true),
  fact('bookingCalendar', true), fact('gallerySystem', 'other'), fact('googleMapsReviews', 20),
  fact('googleMapsRating', 4.7), fact('category', 'wedding'), fact('businessStatus', 'active'),
]

describe('calculateEvaluationScore', () => {
  it('caps all fifteen rules, preserves source explanations, and is independent of fact order', () => {
    const result = score(fullFacts())
    expect(result.score).toBe(100)
    expect(result.matchedRules).toHaveLength(15)
    expect(result.matchedRules.reduce((sum, rule) => sum + rule.points, 0)).toBe(120)
    expect(result.matchedRules.every((rule) => rule.sourceRef === `https://example.com/${rule.factKey}`)).toBe(true)
    expect(result.suggestedAction).toBe('qualify_contact')
    expect(score(fullFacts().reverse())).toEqual(result)
  })

  it('reports missing and explicit unknown facts without awarding points or flags', () => {
    const result = score([fact('nipConfirmed', null, 'unavailable'), fact('category', 'unknown'), fact('gallerySystem', 'unknown')])
    expect(result.score).toBe(0)
    expect(result.flags).toEqual([])
    expect(result.category).toBe('unknown')
    expect(result.unknownFactKeys).toHaveLength(18)
    expect(result.suggestedAction).toBe('observe')
  })

  it.each([
    ['2024-09-19T11:59:59.999Z', 20], ['2024-09-19T12:00:00Z', 0],
    ['2024-09-19T12:00:00.001Z', 0], ['2027-01-01T00:00:00Z', 0],
  ])('uses strict calendar age for %s', (date, expected) => {
    expect(score([fact('businessStartedAt', date)]).score).toBe(expected)
  })

  it('treats a leap-day second anniversary as February 28 in UTC', () => {
    const facts = [fact('businessStartedAt', '2024-02-29T12:00:00Z')]
    expect(score(facts, '2026-02-28T12:00:00Z').score).toBe(0)
    expect(score(facts, '2026-02-28T12:00:00.001Z').score).toBe(20)
  })

  it.each(['instagramLastPostAt', 'facebookLastPostAt'] as const)('checks both ends of the recent-post interval for %s', (key) => {
    expect(score([fact(key, evaluatedAt)]).score).toBe(5)
    expect(score([fact(key, '2026-08-20T12:00:00.001Z')]).score).toBe(5)
    expect(score([fact(key, '2026-08-20T12:00:00Z')]).score).toBe(0)
    expect(score([fact(key, '2026-09-19T12:00:00.001Z')]).score).toBe(0)
  })

  it('does not award engagement points for fewer than twelve posts', () => {
    expect(score([fact('instagramEngagement', { rate: 1, analyzedPostCount: 11 }, 'partial')]).score).toBe(0)
    expect(score([fact('instagramEngagement', { rate: 0.02999, analyzedPostCount: 12 })]).score).toBe(0)
    expect(score([fact('instagramEngagement', { rate: 0.03, analyzedPostCount: 12 })]).score).toBe(5)
  })

  it.each([
    ['instagramFollowers', 999], ['googleMapsReviews', 19], ['googleMapsRating', 4.69],
    ['gallerySystem', 'none'], ['showsPrint', false], ['vatStatus', 'exempt'],
  ] as const)('does not award a nonmatching %s rule', (key, value) => {
    expect(score([fact(key, value)]).score).toBe(0)
  })

  it('qualifies at 60, observes at 59, and preserves unknown category', () => {
    const facts = [fact('nipConfirmed', true), fact('businessStartedAt', '2020-01-01T00:00:00Z'), fact('vatStatus', 'active'), fact('ownDomain', true)]
    expect(score(facts)).toMatchObject({ score: 60, suggestedAction: 'qualify_contact', category: 'unknown' })
    const rules = { ...DEFAULT_HIDDEN_POTENTIAL_RULES, weights: { ...DEFAULT_HIDDEN_POTENTIAL_RULES.weights, ownDomain: 4 } }
    expect(score(facts, evaluatedAt, rules)).toMatchObject({ score: 59, suggestedAction: 'observe' })
  })

  it('keeps commercial photographers in observation even with maximum score', () => {
    expect(score(fullFacts().map((entry) => entry.key === 'category' ? fact('category', 'product_commercial') : entry)))
      .toMatchObject({ score: 100, suggestedAction: 'observe' })
  })

  it.each(['suspended', 'removed'] as const)('gives business flags precedence over category and score for %s', (status) => {
    const facts = fullFacts().map((entry) => entry.key === 'businessStatus' ? fact('businessStatus', status)
      : entry.key === 'photographicPkd' ? fact('photographicPkd', false)
        : entry.key === 'category' ? fact('category', 'product_commercial') : entry)
    expect(score(facts)).toMatchObject({ score: 100, suggestedAction: 'review', flags: ['non_photographic_pkd', `business_${status}`] })
  })

  it('rejects duplicate canonical facts instead of double-counting', () => {
    expect(() => score([fact('showsPrint', true), fact('showsPrint', true)])).toThrow()
  })
})
