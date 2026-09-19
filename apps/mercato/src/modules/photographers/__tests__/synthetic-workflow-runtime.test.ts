import { randomUUID } from 'node:crypto'
import { asValue, createContainer } from 'awilix'
import { LockMode } from '@mikro-orm/core'
import { createModuleQueue } from '@open-mercato/queue'
import { createRequestContainer } from '@open-mercato/shared/lib/di/container'
import { findOneWithDecryption } from '@open-mercato/shared/lib/encryption/find'
import type { ActivityContext } from '@open-mercato/core/modules/workflows/lib/activity-executor'
import { WorkflowInstance, WorkflowBranchInstance, StepInstance } from '@open-mercato/core/modules/workflows/data/entities'
import { sendSignal } from '@open-mercato/core/modules/workflows/lib/signal-handler'
import { register } from '../di'
import handle, { metadata } from '../workers/synthetic-workflow'
import { readEvaluationMaterial } from '../lib/material-store'
import { deliverSyntheticReviewForEngineProof, dispatchSyntheticWorkflow, processSyntheticWorkflow, SYNTHETIC_WORKFLOW_ID } from '../lib/synthetic-workflow-runtime'

jest.mock('@open-mercato/queue', () => ({ createModuleQueue: jest.fn() }))
jest.mock('@open-mercato/shared/lib/di/container', () => ({ createRequestContainer: jest.fn() }))
jest.mock('@open-mercato/shared/lib/encryption/find', () => ({ findOneWithDecryption: jest.fn() }))
jest.mock('@open-mercato/core/modules/workflows/lib/signal-handler', () => ({ sendSignal: jest.fn() }))
jest.mock('../lib/material-store', () => ({ readEvaluationMaterial: jest.fn() }))

function fixture(lane: 'portfolio' | 'social' | 'review' = 'portfolio') {
  const scope = { tenantId: randomUUID(), organizationId: randomUUID() }
  const synthetic = { enabled: true as const, evaluationId: randomUUID(), photographerId: randomUUID(), personId: randomUUID(), dealId: randomUUID(), materials: { portfolio: randomUUID(), social: randomUUID(), review: randomUUID() } }
  const job = { ...scope, userId: randomUUID(), workflowInstanceId: randomUUID(), operationId: randomUUID(), branchInstanceId: lane === 'review' ? null : randomUUID(), lane, waitStepId: `wait_${lane}`, materialId: synthetic.materials[lane] }
  const receipt = { result: { operationId: job.operationId } }
  const instance = { id: job.workflowInstanceId, ...scope, workflowId: SYNTHETIC_WORKFLOW_ID, currentStepId: job.branchInstanceId ? 'research' : job.waitStepId, status: job.branchInstanceId ? 'FORKED' : 'PAUSED', context: { synthetic, [`${lane}Dispatch`]: receipt } }
  const contextNamespace: Record<string, unknown> = { [`${lane}Dispatch`]: receipt }
  const branch = { id: job.branchInstanceId, ...scope, workflowInstanceId: instance.id, currentStepId: job.waitStepId, status: 'PAUSED', contextNamespace }
  const step = { id: randomUUID(), ...scope, workflowInstanceId: instance.id, branchInstanceId: job.branchInstanceId, stepId: job.waitStepId, status: 'ACTIVE' }
  const em = { fork: jest.fn(), transactional: jest.fn(), marker: 'transactional-em' }
  em.fork.mockReturnValue(em)
  em.transactional.mockImplementation(async (callback: (transaction: unknown) => Promise<unknown>) => callback(em))
  jest.mocked(findOneWithDecryption).mockImplementation(async (_em, entity, where) => {
    const target = entity === WorkflowInstance ? instance : entity === WorkflowBranchInstance ? branch : entity === StepInstance ? step : null
    const filter = where as Record<string, unknown>
    return (target && Object.entries(filter).every(([key, value]) => (target as Record<string, unknown>)[key] === value) ? target : null) as never
  })
  jest.mocked(readEvaluationMaterial).mockResolvedValue({ id: job.materialId, ...synthetic, kind: lane === 'review' ? 'facts' : 'traces', data: {}, schemaVersion: 1, updatedAt: new Date().toISOString() } as never)
  const userHasAllFeatures = jest.fn(async () => true)
  const executeWorkflow = jest.fn(async () => undefined)
  const container = createContainer()
  container.register({ em: asValue(em), rbacService: asValue({ userHasAllFeatures }), workflowExecutor: asValue({ executeWorkflow }) })
  jest.mocked(createRequestContainer).mockResolvedValue(container)
  const enqueue = jest.fn(async () => randomUUID())
  const close = jest.fn(async () => undefined)
  jest.mocked(createModuleQueue).mockReturnValue({ enqueue, close } as never)
  return { scope, synthetic, job, instance, branch, step, em, container, userHasAllFeatures, enqueue, close, executeWorkflow }
}

const previousIntegrationMode = process.env.OM_INTEGRATION_TEST
beforeEach(() => { jest.clearAllMocks(); process.env.OM_INTEGRATION_TEST = 'true' })
afterAll(() => { if (previousIntegrationMode === undefined) delete process.env.OM_INTEGRATION_TEST; else process.env.OM_INTEGRATION_TEST = previousIntegrationMode })

test('registered dispatch uses actual activity scope and enqueues references through the platform queue', async () => {
  const setup = fixture()
  register(setup.container)
  const dispatch = setup.container.resolve<(args: unknown, context: ActivityContext) => Promise<{ operationId: string }>>('workflowFunction:photographers.synthetic.dispatch')
  const receipt = await dispatch({ lane: setup.job.lane, waitStepId: setup.job.waitStepId }, { workflowInstance: setup.instance, workflowContext: setup.instance.context, branchInstanceId: setup.job.branchInstanceId, userId: setup.job.userId } as unknown as ActivityContext)
  expect(setup.enqueue).toHaveBeenCalledWith({ ...setup.job, operationId: receipt.operationId }, { delayMs: 1000 })
  expect(setup.close).toHaveBeenCalledTimes(1)
  expect(createModuleQueue).toHaveBeenCalledWith(metadata.queue, { concurrency: 1 })
})

test('production mode rejects both dispatch and callback before enqueue or any read', async () => {
  const setup = fixture()
  process.env.OM_INTEGRATION_TEST = 'false'
  register(setup.container)
  expect(setup.container.hasRegistration('workflowFunction:photographers.synthetic.dispatch')).toBe(false)
  await expect(dispatchSyntheticWorkflow({}, {} as ActivityContext, setup.container)).rejects.toThrow('integration test mode')
  await expect(processSyntheticWorkflow(setup.job, setup.container)).rejects.toThrow('integration test mode')
  expect(setup.enqueue).not.toHaveBeenCalled()
  expect(findOneWithDecryption).not.toHaveBeenCalled()
})

test('discovered worker validates permissions and delivers only references under the scoped workflow lock', async () => {
  const setup = fixture()
  await handle({ id: randomUUID(), createdAt: new Date().toISOString(), payload: setup.job }, { jobId: randomUUID(), attemptNumber: 1, queueName: metadata.queue })
  expect(setup.userHasAllFeatures).toHaveBeenCalledWith(setup.job.userId, expect.arrayContaining(['photographers.evaluations.run', 'workflows.instances.signal']), setup.scope)
  expect(findOneWithDecryption).toHaveBeenCalledWith(setup.em, WorkflowInstance, { id: setup.instance.id, ...setup.scope }, { lockMode: LockMode.PESSIMISTIC_WRITE }, setup.scope)
  expect(sendSignal).toHaveBeenCalledWith(setup.em, expect.anything(), { instanceId: setup.instance.id, ...setup.scope, userId: setup.job.userId, signalName: 'photographers.synthetic.portfolio.ready', payload: { portfolioMaterialId: setup.job.materialId, portfolioOperationId: setup.job.operationId } })
})

test('early delivery retries, different operation and completed attempt skip without sending', async () => {
  const setup = fixture()
  setup.branch.contextNamespace = {}
  await expect(processSyntheticWorkflow(setup.job, setup.container)).rejects.toThrow('not committed yet')
  setup.branch.contextNamespace = { portfolioDispatch: { result: { operationId: randomUUID() } } }
  await expect(processSyntheticWorkflow(setup.job, setup.container)).resolves.toBe('obsolete')
  setup.branch.contextNamespace = { portfolioDispatch: { result: { operationId: setup.job.operationId } } }
  setup.step.status = 'COMPLETED'
  await expect(processSyntheticWorkflow(setup.job, setup.container)).resolves.toBe('obsolete')
  expect(sendSignal).not.toHaveBeenCalled()
})

test('permissions, cross-scope instance, and mismatched evaluation fail closed', async () => {
  const setup = fixture()
  setup.userHasAllFeatures.mockResolvedValueOnce(false)
  await expect(processSyntheticWorkflow(setup.job, setup.container)).rejects.toThrow('not authorized')
  expect(readEvaluationMaterial).not.toHaveBeenCalled()
  await expect(processSyntheticWorkflow({ ...setup.job, organizationId: randomUUID() }, setup.container)).rejects.toThrow('instance is unavailable')
  setup.synthetic.evaluationId = randomUUID()
  await expect(processSyntheticWorkflow(setup.job, setup.container)).rejects.toThrow('correlation mismatch')
  expect(sendSignal).not.toHaveBeenCalled()
})

test('review worker stays parked; only explicit integration test driver simulates review completion', async () => {
  const setup = fixture('review')
  await expect(processSyntheticWorkflow(setup.job, setup.container)).resolves.toBe('awaiting_review')
  expect(sendSignal).not.toHaveBeenCalled()
  await expect(deliverSyntheticReviewForEngineProof(setup.job, setup.container)).resolves.toBe('delivered')
  expect(sendSignal).toHaveBeenCalledWith(setup.em, expect.anything(), expect.objectContaining({ signalName: 'photographers.synthetic.review.ready' }))
})

test('queue failure closes its connection and never reports a persisted dispatch receipt', async () => {
  const setup = fixture()
  setup.enqueue.mockRejectedValueOnce(new Error('queue unavailable'))
  await expect(dispatchSyntheticWorkflow({ lane: setup.job.lane, waitStepId: setup.job.waitStepId }, { workflowInstance: setup.instance, workflowContext: setup.instance.context, branchInstanceId: setup.job.branchInstanceId, userId: setup.job.userId } as unknown as ActivityContext, setup.container)).rejects.toThrow('queue unavailable')
  expect(setup.close).toHaveBeenCalledTimes(1)
})

test('executor continuation starts after callback transaction releases its locks and retries without a second signal', async () => {
  const setup = fixture()
  let inTransaction = false
  setup.em.transactional.mockImplementation(async (callback: (transaction: unknown) => Promise<unknown>) => {
    inTransaction = true
    try { return await callback(setup.em) } finally { inTransaction = false }
  })
  jest.mocked(sendSignal).mockImplementationOnce(async (_em, scopedContainer) => {
    setup.branch.status = 'ACTIVE'
    setup.step.status = 'COMPLETED'
    setup.branch.contextNamespace.portfolioOperationId = setup.job.operationId
    await scopedContainer.resolve<{ executeWorkflow: () => Promise<void> }>('workflowExecutor').executeWorkflow()
    expect(setup.executeWorkflow).not.toHaveBeenCalled()
  })
  setup.executeWorkflow.mockImplementationOnce(async () => {
    expect(inTransaction).toBe(false)
    throw new Error('continuation failed after commit')
  })
  await expect(processSyntheticWorkflow(setup.job, setup.container)).rejects.toThrow('continuation failed after commit')
  await expect(processSyntheticWorkflow(setup.job, setup.container)).resolves.toBe('obsolete')
  expect(sendSignal).toHaveBeenCalledTimes(1)
  expect(setup.executeWorkflow).toHaveBeenCalledTimes(2)
})
