import { loadFileAgentDir } from '@open-mercato/enterprise/modules/agent_orchestrator/lib/sdk/defineFileAgent'
import path from 'node:path'
import { classifyDemoPhotographer, DEMO_O1_SOURCE_ASSUMPTION, normalizeDemoO2Facts } from '../lib/demo-o2-facts'
import { storeDemoO2Evaluation } from '../lib/demo-o2-evaluation'
import { calculateEvaluationScore } from '../lib/evaluation-scoring'
import { DEFAULT_HIDDEN_POTENTIAL_RULES } from '../lib/rules-config'
import { storeMaterialSchema } from '../data/material-validators'
import { materialOperationId } from '../lib/material-codec'
import { readEvaluationMaterial } from '../lib/material-store'

jest.mock('../lib/material-store', () => ({ readEvaluationMaterial: jest.fn() }))

import type { CommandRuntimeContext } from '@open-mercato/shared/lib/commands'

const evaluationId = '10000000-0000-4000-8000-000000000001'
const evaluatedAt = '2026-09-20T12:00:00Z'
const observedAt = '2026-09-19T10:00:00Z'
const evaluation = { evaluationId, evaluatedAt }
function result(platform: 'instagram' | 'facebook' | 'google_maps', data: Record<string, unknown>, status = 'complete', suffix?: string) {
  const tool = `integration_apify.scrape_${suffix ?? (platform === 'instagram' ? 'instagram_profile' : platform === 'facebook' ? 'facebook_page' : 'google_maps_place')}`
  const url = `https://${platform === 'instagram' ? 'instagram.com' : platform === 'facebook' ? 'facebook.com' : 'google.com'}/studio`
  const provider = { ok: true, status, platform, canonicalUrl: url, sourceUrl: url, observedAt, actorRunId: 'fixture', data, unavailableFields: [], diagnostics: [] }
  return { tool, url, confidence: 'unconfirmed', approvalRequired: true, status, actorRunId: 'fixture', observedAt, resultJson: JSON.stringify(provider), error: null }
}
function outcome(results: ReturnType<typeof result>[] = []) {
  return { schemaVersion: 1, status: results.length ? 'complete' : 'no_targets', results, skipped: [], summary: 'Controlled fixture' }
}
const full = () => outcome([
  result('instagram', { followersCount: 1250, biography: 'Fotografia ślubna' }),
  result('facebook', { description: 'Wedding photographer', rating: 5, ratingCount: 300 }),
  result('google_maps', { reviewsCount: 30, rating: 4.9, primaryCategory: 'Photographer' }),
])

test('controlled fixture conforms to the existing OUTCOME and maps only provider facts with provenance', () => {
  const agent = loadFileAgentDir(path.join(__dirname, '..', 'agents', 'apify_link_researcher_o2'))!
  expect(agent.entry.schema.safeParse({ kind: 'research', data: full() }).success).toBe(true)
  const normalized = normalizeDemoO2Facts({ kind: 'research', data: full() }, evaluation)
  expect(normalized.category).toBe('wedding')
  expect(normalized.facts.map((fact) => fact.key)).toEqual(['instagramFollowers', 'googleMapsReviews', 'googleMapsRating', 'category'])
  for (const fact of normalized.facts) {
    expect(fact.observedAt).toBe(observedAt)
    expect(normalized.traces.traces.find((trace) => trace.id === fact.traceId)).toMatchObject({ status: 'confirmed', ruleId: DEMO_O1_SOURCE_ASSUMPTION })
  }
  expect(normalized.traces.traces[0].provenance).toEqual(expect.arrayContaining([expect.objectContaining({ value: JSON.stringify({ field: 'biography', text: 'Fotografia ślubna' }) })]))
})

test.each([null, undefined, '1000', -1, 1.5])('does not fabricate follower count from %p', (followersCount) => {
  const normalized = normalizeDemoO2Facts(outcome([result('instagram', { followersCount }, 'partial')]), evaluation)
  expect(normalized.facts).toEqual([])
  expect(normalized.category).toBe('unknown')
})

test('preserves real zero and partial read time', () => {
  expect(normalizeDemoO2Facts(outcome([result('instagram', { followersCount: 0 }, 'partial')]), evaluation).facts[0]).toMatchObject({ value: 0, readStatus: 'partial', observedAt })
})

test.each(['no_targets', 'no_data', 'error', 'invalid_input'])('empty %s produces empty facts and unknown category', (status) => {
  const normalized = normalizeDemoO2Facts({ ...outcome(), status }, evaluation)
  expect(normalized.facts).toEqual([])
  expect(normalized.category).toBe('unknown')
  expect(normalized.traces.discoveryStatus).toBe('unavailable')
})

test.each([
  ['Wedding photographer', 'wedding'], ['Fotografia rodzinna', 'family_newborn'],
  ['Fotograf przedszkolny', 'school_preschool'], ['Event photography', 'reportage_events'],
  ['Fotografia produktowa', 'product_commercial'], ['Landscape photography', 'other'],
  ['Photographer', 'unknown'], ['Nie wykonuję fotografii ślubnej', 'unknown'],
  ['Wedding photographer and product photographer', 'unknown'], ['', 'unknown'],
])('classifies explicit specialties conservatively: %s', (text, expected) => {
  expect(classifyDemoPhotographer(text)).toBe(expected)
})

test('ignores invalid JSON, failed and unavailable fields without blocking useful siblings', () => {
  const unavailable = result('instagram', { followersCount: 3000 })
  unavailable.resultJson = JSON.stringify({ ...JSON.parse(unavailable.resultJson), unavailableFields: [{ field: 'followersCount', reason: 'redacted' }] })
  const broken = result('facebook', { description: 'Wedding photographer' })
  broken.resultJson = '{'
  const normalized = normalizeDemoO2Facts(outcome([unavailable, broken, result('google_maps', { rating: 4.9 })]), evaluation)
  expect(normalized.facts.map((fact) => fact.key)).toEqual(['googleMapsRating'])
  expect(normalizeDemoO2Facts(outcome([result('instagram', { followersCount: 3000 }, 'error')]), evaluation).facts).toEqual([])
})

test('uses place aggregate before reviews and never treats sample size as review count', () => {
  const normalized = normalizeDemoO2Facts(outcome([
    result('google_maps', { rating: 2, sampleSize: 10 }, 'partial', 'google_maps_reviews'),
    result('google_maps', { rating: 4.8 }),
  ]), evaluation)
  expect(normalized.facts).toEqual([expect.objectContaining({ key: 'googleMapsRating', value: 4.8 })])
})

test('stores linked traces, facts and unchanged calculator output through the command bus', async () => {
  const snapshots: Array<ReturnType<typeof storeMaterialSchema.parse>> = []
  const execute = jest.fn(async (_name: string, options: { input: unknown }) => {
    const parsed = storeMaterialSchema.parse(options.input)
    snapshots.push(parsed)
    if (parsed.snapshot.material.kind === 'facts') jest.mocked(readEvaluationMaterial).mockResolvedValue({ ...parsed.snapshot, ...parsed.snapshot.material, evaluationId } as never)
    return { result: { id: materialOperationId(parsed.operationId, 'stored') } }
  })
  const ctx = { container: { resolve: () => ({ execute }) } } as unknown as CommandRuntimeContext
  const input = {
    mode: 'demo', sourceAssumption: DEMO_O1_SOURCE_ASSUMPTION, ...evaluation,
    o2ResultRef: materialOperationId(evaluationId, 'o2'),
    owners: { registrationId: evaluationId, photographerId: evaluationId, personId: evaluationId, dealId: evaluationId },
    rulesSnapshot: DEFAULT_HIDDEN_POTENTIAL_RULES,
  }
  const output = await storeDemoO2Evaluation(input, full(), ctx)
  const facts = snapshots[1].snapshot.material
  const score = snapshots[2].snapshot.material
  expect(facts.kind).toBe('facts')
  expect(score.kind).toBe('score')
  if (facts.kind !== 'facts' || score.kind !== 'score') throw new Error('Unexpected fixture kind')
  expect(score.data).toEqual(calculateEvaluationScore({ facts: facts.data, factsRef: output.factsRef, rules: DEFAULT_HIDDEN_POTENTIAL_RULES }))
  expect(score.data.score).toBe(15)
  expect(facts.data.tracesRef).toBe(output.tracesRef)
  expect(score.data.unknownFactKeys).toContain('instagramEngagement')
  expect(await storeDemoO2Evaluation(input, full(), ctx)).toEqual(output)
  expect(execute.mock.calls.every(([name]) => name === 'photographers.evaluation.store_material')).toBe(true)
  await expect(storeDemoO2Evaluation({ ...input, mode: 'production' }, full(), ctx)).rejects.toThrow()
})

test('empty persisted evaluation uses the existing zero score and unknown category', async () => {
  const materials: Array<ReturnType<typeof storeMaterialSchema.parse>> = []
  const execute = jest.fn(async (_name: string, options: { input: unknown }) => {
    const parsed = storeMaterialSchema.parse(options.input)
    materials.push(parsed)
    if (parsed.snapshot.material.kind === 'facts') jest.mocked(readEvaluationMaterial).mockResolvedValue({ ...parsed.snapshot, ...parsed.snapshot.material, evaluationId } as never)
    return { result: { id: materialOperationId(parsed.operationId, 'stored') } }
  })
  const ctx = { container: { resolve: () => ({ execute }) } } as unknown as CommandRuntimeContext
  await storeDemoO2Evaluation({
    mode: 'demo', sourceAssumption: DEMO_O1_SOURCE_ASSUMPTION, ...evaluation,
    o2ResultRef: evaluationId, owners: { registrationId: evaluationId, photographerId: evaluationId, personId: evaluationId, dealId: evaluationId },
    rulesSnapshot: DEFAULT_HIDDEN_POTENTIAL_RULES,
  }, outcome(), ctx)
  expect(materials[2].snapshot.material).toMatchObject({ kind: 'score', data: { score: 0, category: 'unknown', suggestedAction: 'observe' } })
})

test('failed authorized material write stops the pipeline', async () => {
  const execute = jest.fn().mockRejectedValue(new Error('Denied'))
  const ctx = { container: { resolve: () => ({ execute }) } } as unknown as CommandRuntimeContext
  await expect(storeDemoO2Evaluation({
    mode: 'demo', sourceAssumption: DEMO_O1_SOURCE_ASSUMPTION, ...evaluation,
    o2ResultRef: evaluationId, owners: { registrationId: evaluationId, photographerId: evaluationId, personId: evaluationId, dealId: evaluationId },
    rulesSnapshot: DEFAULT_HIDDEN_POTENTIAL_RULES,
  }, full(), ctx)).rejects.toThrow('Denied')
  expect(execute).toHaveBeenCalledTimes(1)
})

test('calculates from the reread stored facts and refuses changed ownership', async () => {
  const owners = { registrationId: evaluationId, photographerId: evaluationId, personId: evaluationId, dealId: evaluationId }
  const materials: Array<ReturnType<typeof storeMaterialSchema.parse>> = []
  const execute = jest.fn(async (_name: string, options: { input: unknown }) => {
    const parsed = storeMaterialSchema.parse(options.input)
    materials.push(parsed)
    if (parsed.snapshot.material.kind === 'facts') {
      jest.mocked(readEvaluationMaterial).mockResolvedValue({ ...parsed.snapshot, ...parsed.snapshot.material, evaluationId,
        data: { ...parsed.snapshot.material.data, facts: [] },
      } as never)
    }
    return { result: { id: materialOperationId(parsed.operationId, 'stored') } }
  })
  const ctx = { container: { resolve: () => ({ execute }) } } as unknown as CommandRuntimeContext
  const input = { mode: 'demo', sourceAssumption: DEMO_O1_SOURCE_ASSUMPTION, ...evaluation, o2ResultRef: evaluationId, owners, rulesSnapshot: DEFAULT_HIDDEN_POTENTIAL_RULES }
  await storeDemoO2Evaluation(input, full(), ctx)
  expect(materials[2].snapshot.material).toMatchObject({ kind: 'score', data: { score: 0, category: 'unknown' } })
  jest.mocked(readEvaluationMaterial).mockImplementation(async () => ({ kind: 'facts', evaluationId, ...owners,
    photographerId: materialOperationId(evaluationId, 'other'), data: { evaluatedAt, tracesRef: materialOperationId(materialOperationId(evaluationId, `demo-o2:${evaluationId}:traces`), 'stored') },
  } as never))
  execute.mockImplementation(async (_name: string, options: { input: unknown }) => {
    const parsed = storeMaterialSchema.parse(options.input)
    return { result: { id: materialOperationId(parsed.operationId, 'stored') } }
  })
  await expect(storeDemoO2Evaluation(input, full(), ctx)).rejects.toThrow('owner mismatch')
})
