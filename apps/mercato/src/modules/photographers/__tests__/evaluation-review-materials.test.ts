import type { CommandRuntimeContext } from '@open-mercato/shared/lib/commands'
import { evaluationReviewEnvelopeSchema } from '../data/evaluation-review-validators'
import { readEvaluationReviewMaterials } from '../lib/evaluation-review-materials'
import { readEvaluationMaterial } from '../lib/material-store'

jest.mock('../lib/material-store', () => ({ readEvaluationMaterial: jest.fn() }))
jest.mock('../lib/proposal-review-materials', () => ({ reviewError: async (status: number, key: string) => { throw Object.assign(new Error(key), { status }) } }))

const uuid = (number: number) => `${String(number).padStart(8, '0')}-1111-4111-8111-111111111111`
const payload = { evaluationId: uuid(1), registrationId: uuid(2), photographerId: uuid(3), personId: uuid(4), dealId: uuid(5), factsRef: uuid(6), scoreRef: uuid(7) }
const timestamp = '2026-09-19T12:00:00.000Z'
const context = {} as CommandRuntimeContext
function materials() {
  const common = { evaluationId: payload.evaluationId, registrationId: payload.registrationId, photographerId: payload.photographerId, personId: payload.personId, dealId: payload.dealId, updatedAt: timestamp, schemaVersion: 1 }
  return [
    { ...common, id: payload.factsRef, kind: 'facts', data: { schemaVersion: 1, evaluationId: payload.evaluationId, evaluatedAt: timestamp, facts: [], tracesRef: uuid(8) } },
    { ...common, id: payload.scoreRef, kind: 'score', data: { schemaVersion: 1, evaluationId: payload.evaluationId, evaluatedAt: timestamp, factsRef: payload.factsRef, rulesVersion: 'v1', score: 0, matchedRules: [], flags: ['business_suspended'], category: 'unknown', suggestedAction: 'review', unknownFactKeys: [] } },
  ]
}
beforeEach(() => jest.resetAllMocks())

test('reads immutable snapshots through scoped material reader', async () => {
  const snapshots = materials()
  jest.mocked(readEvaluationMaterial).mockImplementation(async (id) => snapshots.find((entry) => entry.id === id) as never)
  await expect(readEvaluationReviewMaterials(payload, context)).resolves.toEqual(snapshots)
  expect(readEvaluationMaterial).toHaveBeenCalledWith(payload.factsRef, context)
  expect(readEvaluationMaterial).toHaveBeenCalledWith(payload.scoreRef, context)
})

test.each(['registrationId', 'photographerId', 'personId', 'dealId', 'evaluationId'] as const)('refuses foreign %s', async (key) => {
  const snapshots = materials()
  snapshots[1][key] = uuid(90)
  jest.mocked(readEvaluationMaterial).mockImplementation(async (id) => snapshots.find((entry) => entry.id === id) as never)
  await expect(readEvaluationReviewMaterials(payload, context)).rejects.toMatchObject({ status: 409 })
})

test.each(['factsRef', 'evaluatedAt', 'flags'] as const)('refuses inconsistent %s', async (key) => {
  const snapshots = materials()
  if (key === 'factsRef') snapshots[1].data.factsRef = uuid(90)
  if (key === 'evaluatedAt') snapshots[1].data.evaluatedAt = '2026-09-18T12:00:00.000Z'
  if (key === 'flags') snapshots[1].data.flags = []
  jest.mocked(readEvaluationMaterial).mockImplementation(async (id) => snapshots.find((entry) => entry.id === id) as never)
  await expect(readEvaluationReviewMaterials(payload, context)).rejects.toMatchObject({ status: 409 })
})

test('refuses unsafe intent payloads and action substitution', () => {
  const envelope = { options: [{ id: 'review', label: 'Review', actions: [{ type: 'photographers.evaluation.review', risk: 'high', payload }] }] }
  expect(evaluationReviewEnvelopeSchema.safeParse(envelope).success).toBe(true)
  expect(evaluationReviewEnvelopeSchema.safeParse({ ...envelope, options: [{ ...envelope.options[0], actions: [] }] }).success).toBe(false)
  const action = envelope.options[0].actions[0]
  expect(evaluationReviewEnvelopeSchema.safeParse({ options: [{ ...envelope.options[0], actions: [{ ...action, type: 'photographers.message.accept' }] }] }).success).toBe(false)
  expect(evaluationReviewEnvelopeSchema.safeParse({ options: [{ ...envelope.options[0], actions: [{ ...action, payload: { ...payload, body: 'Not a reference' } }] }] }).success).toBe(false)
})
