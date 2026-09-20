import { randomUUID } from 'node:crypto'
import { createContainer } from 'awilix'
import { readEvaluationMaterial } from '../lib/material-store'
import { readApifyResearchResult } from '../lib/apify-research-material'

jest.mock('../lib/material-store', () => ({ readEvaluationMaterial: jest.fn() }))

function fixture() {
  const owner = { id: randomUUID(), photographerId: randomUUID(), personId: randomUUID(), registrationId: randomUUID(), dealId: randomUUID(), evaluationId: randomUUID(), schemaVersion: 1, updatedAt: '2026-09-19T12:00:00Z' }
  const invocationId = randomUUID()
  const partId = randomUUID()
  const payload = { outcome: null, rawOutput: { preserved: null }, o1: { links: [] }, error: 'Controlled failure', toolCalls: [] }
  const manifest = { ...owner, kind: 'apify_research', data: { state: 'finished', invocationId, payloadRefs: [partId] } }
  const part = { ...owner, id: partId, kind: 'apify_research_part', data: { index: 0, invocationId, content: JSON.stringify(payload) } }
  jest.mocked(readEvaluationMaterial).mockImplementation(async (id) => (id === owner.id ? manifest : part) as never)
  return { manifest, part, payload, ctx: { container: createContainer() } }
}

beforeEach(() => jest.clearAllMocks())

test('returns a claimed reference without pretending it is a finished result', async () => {
  const setup = fixture()
  setup.manifest.data.state = 'claimed'
  const result = await readApifyResearchResult(setup.manifest.id, setup.ctx)
  expect(result.payload).toBeNull()
  expect(readEvaluationMaterial).toHaveBeenCalledTimes(1)
})

test('reads the persisted failure payload unchanged', async () => {
  const setup = fixture()
  const result = await readApifyResearchResult(setup.manifest.id, setup.ctx)
  expect(result.payload).toEqual(setup.payload)
})

test.each(['photographerId', 'personId', 'evaluationId', 'registrationId', 'dealId'] as const)('rejects a part with a different %s', async (field) => {
  const setup = fixture()
  setup.part[field] = randomUUID()
  await expect(readApifyResearchResult(setup.manifest.id, setup.ctx)).rejects.toThrow('binding mismatch')
})

test('rejects a reordered or foreign invocation part', async () => {
  const setup = fixture()
  setup.part.data.index = 1
  await expect(readApifyResearchResult(setup.manifest.id, setup.ctx)).rejects.toThrow('binding mismatch')
  setup.part.data.index = 0
  setup.part.data.invocationId = randomUUID()
  await expect(readApifyResearchResult(setup.manifest.id, setup.ctx)).rejects.toThrow('binding mismatch')
})
