import { randomUUID } from 'node:crypto'
import { asValue, createContainer } from 'awilix'
import { findOneWithDecryption } from '@open-mercato/shared/lib/encryption/find'
import { WorkflowInstance } from '@open-mercato/core/modules/workflows/data/entities'
import { scoreDemoWorkflow } from '../lib/demo-scoring-workflow'
import { readApifyResearchResult } from '../lib/apify-research-material'
import { storeDemoO2Evaluation } from '../lib/demo-o2-evaluation'
import { DEFAULT_HIDDEN_POTENTIAL_RULES } from '../lib/rules-config'

jest.mock('@open-mercato/shared/lib/encryption/find', () => ({ findOneWithDecryption: jest.fn() }))
jest.mock('../lib/apify-research-material', () => ({ readApifyResearchResult: jest.fn() }))
jest.mock('../lib/demo-o2-evaluation', () => ({ storeDemoO2Evaluation: jest.fn() }))

function fixture() {
  const scope = { tenantId: randomUUID(), organizationId: randomUUID() }
  const prepared = { requestId: randomUUID(), registrationId: randomUUID(), evaluationId: randomUUID(), evaluatedAt: '2026-09-20T12:00:00Z', photographerId: randomUUID(), personId: randomUUID(), dealId: randomUUID(), userId: randomUUID(), source: 'registration' }
  const apifyResearchRef = randomUUID()
  const apifyRunId = randomUUID()
  const o1 = { runId: randomUUID(), tracesRef: randomUUID() }
  const instance = Object.assign(new WorkflowInstance(), { id: randomUUID(), version: 3, workflowId: 'photographers.demo-evaluation', currentStepId: 'normalize', ...scope, context: { demo: prepared, demoRules: DEFAULT_HIDDEN_POTENTIAL_RULES, apifyResearchRef, apifyRunId, o1Result: { result: o1 } } })
  const material = { ...prepared, data: { stepId: 'apify_o2', runId: apifyRunId, workflowInstanceId: instance.id, userId: prepared.userId, o1RunId: o1.runId, tracesRef: o1.tracesRef, evaluatedAt: prepared.evaluatedAt, state: 'finished', runStatus: 'ok' }, payload: { outcome: { kind: 'research', data: { schemaVersion: 1, status: 'partial', results: [], skipped: [], summary: 'Controlled result' } } } }
  const em = { name: 'default', fork: jest.fn() }
  em.fork.mockReturnValue(em)
  const container = createContainer()
  const userHasAllFeatures = jest.fn().mockResolvedValue(true)
  container.register({ em: asValue(em), rbacService: asValue({ userHasAllFeatures }) })
  jest.mocked(findOneWithDecryption).mockResolvedValue(instance)
  jest.mocked(readApifyResearchResult).mockResolvedValue(material as never)
  jest.mocked(storeDemoO2Evaluation).mockResolvedValue({ tracesRef: randomUUID(), factsRef: randomUUID(), scoreRef: randomUUID(), rulesVersion: 'controlled', reviewRequired: true })
  const context = { workflowInstance: instance, workflowContext: instance.context, userId: prepared.userId }
  return { container, context, instance, prepared, material, apifyResearchRef, userHasAllFeatures }
}

beforeEach(() => jest.clearAllMocks())

test('passes the authorized persisted partial O2 result and frozen rules to normalization', async () => {
  const setup = fixture()
  await scoreDemoWorkflow({ apifyResearchRef: setup.apifyResearchRef }, setup.context, setup.container)
  expect(readApifyResearchResult).toHaveBeenCalledWith(setup.apifyResearchRef, expect.objectContaining({ selectedOrganizationId: setup.instance.organizationId }))
  expect(storeDemoO2Evaluation).toHaveBeenCalledWith(expect.objectContaining({ evaluationId: setup.prepared.evaluationId, o2ResultRef: setup.apifyResearchRef, rulesSnapshot: DEFAULT_HIDDEN_POTENTIAL_RULES }), setup.material.payload.outcome, expect.anything())
})

test.each(['error', 'invalid_input'])('rejects O2 %s without storing a score', async (status) => {
  const setup = fixture()
  setup.material.payload.outcome.data.status = status
  await expect(scoreDemoWorkflow({ apifyResearchRef: setup.apifyResearchRef }, setup.context, setup.container)).rejects.toThrow('did not complete')
  expect(storeDemoO2Evaluation).not.toHaveBeenCalled()
})

test('missing frozen rules never falls back to current defaults', async () => {
  const setup = fixture()
  delete (setup.instance.context as Record<string, unknown>).demoRules
  await expect(scoreDemoWorkflow({ apifyResearchRef: setup.apifyResearchRef }, setup.context, setup.container)).rejects.toThrow()
  expect(storeDemoO2Evaluation).not.toHaveBeenCalled()
})

test.each(['evaluationId', 'registrationId', 'photographerId', 'personId', 'dealId'] as const)('rejects mismatched %s', async (field) => {
  const setup = fixture()
  setup.material[field] = randomUUID()
  await expect(scoreDemoWorkflow({ apifyResearchRef: setup.apifyResearchRef }, setup.context, setup.container)).rejects.toThrow('owner mismatch')
  expect(storeDemoO2Evaluation).not.toHaveBeenCalled()
})

test.each(['workflowInstanceId', 'o1RunId', 'tracesRef', 'userId', 'runId', 'stepId'] as const)('rejects mismatched provenance %s', async (field) => {
  const setup = fixture()
  setup.material.data[field] = randomUUID()
  await expect(scoreDemoWorkflow({ apifyResearchRef: setup.apifyResearchRef }, setup.context, setup.container)).rejects.toThrow('provenance mismatch')
  expect(storeDemoO2Evaluation).not.toHaveBeenCalled()
})

test('rejects a nonterminal or failed persisted runtime', async () => {
  const setup = fixture()
  setup.material.data.runStatus = 'error'
  await expect(scoreDemoWorkflow({ apifyResearchRef: setup.apifyResearchRef }, setup.context, setup.container)).rejects.toThrow('did not complete')
  expect(storeDemoO2Evaluation).not.toHaveBeenCalled()
})

test('denied access stops before reading or scoring material', async () => {
  const setup = fixture()
  setup.userHasAllFeatures.mockResolvedValue(false)
  await expect(scoreDemoWorkflow({ apifyResearchRef: setup.apifyResearchRef }, setup.context, setup.container)).rejects.toThrow('access denied')
  expect(readApifyResearchResult).not.toHaveBeenCalled()
  expect(storeDemoO2Evaluation).not.toHaveBeenCalled()
})
