import { randomUUID } from 'node:crypto'
import { asValue, createContainer } from 'awilix'
import { createModuleQueue } from '@open-mercato/queue'
import { findOneWithDecryption, findWithDecryption } from '@open-mercato/shared/lib/encryption/find'
import { WorkflowInstance } from '@open-mercato/core/modules/workflows/data/entities'
import type { ScoreSnapshot } from '../data/evaluation-validators'
import { dispatchEvaluationReview, processEvaluationReviewJob } from '../lib/evaluation-review-workflow'
import { readEvaluationMaterial } from '../lib/material-store'
import { publishEvaluationReview } from '../lib/evaluation-review-publication'

jest.mock('@open-mercato/queue', () => ({ createModuleQueue: jest.fn() }))
jest.mock('@open-mercato/shared/lib/encryption/find', () => ({ findOneWithDecryption: jest.fn(), findWithDecryption: jest.fn() }))
jest.mock('../lib/material-store', () => ({ readEvaluationMaterial: jest.fn() }))
jest.mock('../lib/evaluation-review-publication', () => ({ publishEvaluationReview: jest.fn() }))
jest.mock('../lib/demo-operation-lock', () => ({ withDemoOperationLock: jest.fn(async (_container, _key, operation) => operation()) }))

function fixture() {
  const job = { workflowInstanceId: randomUUID(), tenantId: randomUUID(), organizationId: randomUUID(), userId: randomUUID(), operationId: randomUUID(), scoreRef: randomUUID() }
  const scope = { tenantId: job.tenantId, organizationId: job.organizationId }
  const references = { registrationId: randomUUID(), evaluationId: randomUUID(), photographerId: randomUUID(), personId: randomUUID(), dealId: randomUUID(), evaluatedAt: '2026-09-19T10:00:00Z' }
  const receipt = { scoreRef: job.scoreRef, factsRef: randomUUID(), rulesVersion: '1', reviewRequired: true }
  const instance = Object.assign(new WorkflowInstance(), { id: job.workflowInstanceId, workflowId: 'photographers.hidden_potential', ...scope, status: 'PAUSED', currentStepId: 'review', metadata: { initiatedBy: job.userId }, context: { ...references, scoreResult: { result: receipt }, evaluationReviewDispatch: { result: { operationId: job.operationId } } } })
  const data: ScoreSnapshot = { schemaVersion: 1, evaluationId: references.evaluationId, factsRef: receipt.factsRef, rulesVersion: receipt.rulesVersion, evaluatedAt: references.evaluatedAt, score: 0, matchedRules: [], flags: ['business_suspended'], category: 'unknown', suggestedAction: 'review', unknownFactKeys: [] }
  const { evaluatedAt, ...owners } = references
  const material = { ...owners, id: job.scoreRef, schemaVersion: 1, updatedAt: evaluatedAt, kind: 'score', data }
  const attempts = [{ id: randomUUID(), status: 'ACTIVE' }]
  const em = { fork: jest.fn(), name: 'default' }
  em.fork.mockReturnValue(em)
  const userHasAllFeatures = jest.fn().mockResolvedValue(true)
  const container = createContainer()
  container.register({ em: asValue(em), rbacService: asValue({ userHasAllFeatures }) })
  const enqueue = jest.fn().mockResolvedValue(undefined)
  const close = jest.fn().mockResolvedValue(undefined)
  jest.mocked(createModuleQueue).mockReturnValue({ enqueue, close } as never)
  jest.mocked(findOneWithDecryption).mockResolvedValue(instance)
  jest.mocked(findWithDecryption).mockResolvedValue(attempts as never)
  jest.mocked(readEvaluationMaterial).mockResolvedValue(material as never)
  jest.mocked(publishEvaluationReview).mockResolvedValue({ status: 'awaiting_review', runId: randomUUID(), proposalId: randomUUID() })
  const context = { workflowInstance: instance, workflowContext: instance.context, userId: job.userId }
  return { job, scope, references, receipt, instance, material, attempts, container, enqueue, close, userHasAllFeatures, context, run: () => processEvaluationReviewJob(job, container), dispatch: () => dispatchEvaluationReview({}, context, container) }
}
beforeEach(() => jest.clearAllMocks())

test('dispatches only a scoped reference job and closes the queue', async () => {
  const setup = fixture()
  setup.instance.currentStepId = 'disposition'
  setup.instance.status = 'RUNNING'
  const result = await setup.dispatch()
  expect(Object.keys(result)).toEqual(['operationId'])
  expect(setup.enqueue).toHaveBeenCalledWith({ ...setup.job, operationId: result.operationId }, { delayMs: 500 })
  expect(setup.close).toHaveBeenCalledTimes(1)
  expect(publishEvaluationReview).not.toHaveBeenCalled()
})

test('checks authorization before reading or publishing', async () => {
  const setup = fixture()
  setup.userHasAllFeatures.mockResolvedValue(false)
  await expect(setup.run()).rejects.toThrow('access denied')
  await expect(setup.dispatch()).rejects.toThrow('access denied')
  expect(findOneWithDecryption).not.toHaveBeenCalled()
  expect(setup.enqueue).not.toHaveBeenCalled()
  expect(publishEvaluationReview).not.toHaveBeenCalled()
})

test('publishes refs from a flagged owned score with scoped queries', async () => {
  const setup = fixture()
  await setup.run()
  expect(publishEvaluationReview).toHaveBeenCalledWith(setup.job, setup.attempts[0].id, { registrationId: setup.references.registrationId, evaluationId: setup.references.evaluationId, photographerId: setup.references.photographerId, personId: setup.references.personId, dealId: setup.references.dealId, factsRef: setup.receipt.factsRef, scoreRef: setup.job.scoreRef }, setup.container)
  for (const call of jest.mocked(findOneWithDecryption).mock.calls) { expect(call[2]).toEqual(expect.objectContaining(setup.scope)); expect(call[4]).toEqual(setup.scope) }
  expect(jest.mocked(findWithDecryption).mock.calls[0][2]).toEqual(expect.objectContaining({ ...setup.scope, branchInstanceId: null }))
})

test.each(['COMPLETED', 'CANCELLED', 'FAILED'])('ignores an obsolete %s instance', async (status) => {
  const setup = fixture(); setup.instance.status = status as WorkflowInstance['status']
  await expect(setup.run()).resolves.toEqual({ status: 'obsolete' })
  expect(publishEvaluationReview).not.toHaveBeenCalled()
})

test('ignores a missing scoped workflow and a superseded delivery', async () => {
  const setup = fixture(); jest.mocked(findOneWithDecryption).mockResolvedValueOnce(null)
  await expect(setup.run()).resolves.toEqual({ status: 'obsolete' })
  setup.instance.context.evaluationReviewDispatch = { result: { operationId: randomUUID() } }
  await expect(setup.run()).resolves.toEqual({ status: 'obsolete' })
  expect(publishEvaluationReview).not.toHaveBeenCalled()
})

test.each(['actor', 'early', 'step', 'status', 'receipt', 'flag', 'attempts', 'inactive'])('rejects invalid %s before publishing', async (problem) => {
  const setup = fixture()
  if (problem === 'actor') setup.instance.metadata = { initiatedBy: randomUUID() }
  if (problem === 'early') delete setup.instance.context.evaluationReviewDispatch
  if (problem === 'step') setup.instance.currentStepId = 'disposition'
  if (problem === 'status') setup.instance.status = 'RUNNING'
  if (problem === 'receipt') setup.receipt.scoreRef = randomUUID()
  if (problem === 'flag') setup.receipt.reviewRequired = false
  if (problem === 'attempts') setup.attempts.push({ ...setup.attempts[0], id: randomUUID() })
  if (problem === 'inactive') setup.attempts[0].status = 'COMPLETED'
  await expect(setup.run()).rejects.toThrow()
  expect(publishEvaluationReview).not.toHaveBeenCalled()
})

test.each(['registrationId', 'evaluationId', 'photographerId', 'personId', 'dealId'] as const)('rejects score with substituted %s', async (field) => {
  const setup = fixture(); setup.material[field] = randomUUID()
  await expect(setup.run()).rejects.toThrow('ownership mismatch')
  expect(publishEvaluationReview).not.toHaveBeenCalled()
})

test.each(['flags', 'facts', 'version', 'date'])('rejects invalid score %s', async (field) => {
  const setup = fixture()
  if (field === 'flags') setup.material.data.flags = []
  if (field === 'facts') setup.material.data.factsRef = randomUUID()
  if (field === 'version') setup.material.data.rulesVersion = 'other'
  if (field === 'date') setup.material.data.evaluatedAt = '2026-09-20T10:00:00Z'
  await expect(setup.run()).rejects.toThrow()
  expect(publishEvaluationReview).not.toHaveBeenCalled()
})

test('rejects branch dispatch and invalid actors before queue access', async () => {
  const setup = fixture()
  await expect(dispatchEvaluationReview({}, { ...setup.context, branchInstanceId: randomUUID() }, setup.container)).rejects.toThrow('Invalid evaluation review workflow')
  await expect(dispatchEvaluationReview({}, { ...setup.context, userId: 'invalid' }, setup.container)).rejects.toThrow()
  expect(setup.enqueue).not.toHaveBeenCalled()
})

test('closes queue after failed enqueue', async () => {
  const setup = fixture(); setup.instance.currentStepId = 'disposition'; setup.instance.status = 'RUNNING'
  setup.enqueue.mockRejectedValue(new Error('queue unavailable'))
  await expect(setup.dispatch()).rejects.toThrow('queue unavailable')
  expect(setup.close).toHaveBeenCalledTimes(1)
})

test.each(['actor', 'step', 'status', 'receipt', 'flag'])('does not dispatch when persisted %s is invalid', async (problem) => {
  const setup = fixture()
  setup.instance.currentStepId = 'disposition'
  setup.instance.status = 'RUNNING'
  if (problem === 'actor') setup.instance.metadata = { initiatedBy: randomUUID() }
  if (problem === 'step') setup.instance.currentStepId = 'score'
  if (problem === 'status') setup.instance.status = 'PAUSED'
  if (problem === 'receipt') setup.instance.context.scoreResult = { result: { ...setup.receipt, scoreRef: randomUUID() } }
  if (problem === 'flag') setup.receipt.reviewRequired = false
  const context = { ...setup.context, workflowContext: { scoreResult: { result: { ...setup.receipt, scoreRef: setup.job.scoreRef } } } }
  await expect(dispatchEvaluationReview({}, context, setup.container)).rejects.toThrow()
  expect(setup.enqueue).not.toHaveBeenCalled()
})
