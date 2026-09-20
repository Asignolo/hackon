import { findWorkflowDefinition } from '@open-mercato/core/modules/workflows/lib/find-definition'
import { getCodeWorkflow } from '@open-mercato/shared/modules/workflows/code-registry'
import { randomUUID } from 'node:crypto'
import { TransactionContext } from '@mikro-orm/core'
import { asValue, createContainer } from 'awilix'
import { createModuleQueue } from '@open-mercato/queue'
import { findOneWithDecryption, findWithDecryption } from '@open-mercato/shared/lib/encryption/find'
import { WorkflowInstance, StepInstance, WorkflowDefinition } from '@open-mercato/core/modules/workflows/data/entities'
import * as signalHandler from '@open-mercato/core/modules/workflows/lib/signal-handler'
import { executeFunction } from '@open-mercato/core/modules/workflows/lib/activity-executor'
import { AgentProposal, AgentRun, ProcessInstance } from '@open-mercato/enterprise/modules/agent_orchestrator/data/entities'
import { workflowDefinitionDataSchema } from '@open-mercato/core/modules/workflows/data/validators'
import type { ActivityContext } from '@open-mercato/core/modules/workflows/lib/activity-executor'
import { createLegacyDemoWorkflowDefinition as createDemoWorkflowDefinition, DEMO_WORKFLOW_ID, DEMO_REVIEW_SIGNAL } from '../lib/demo-workflow'
import { dispatchPhotographerDemoWorkflow, finalizePhotographerDemoWorkflow, getDemoReviewBinding, getPhotographerDemoExecution, processPhotographerDemoJob, startDemoWorkflowOnce } from '../lib/demo-workflow-runtime'
import { probeDemoReviewEffectStatus, readDemoEffectResult, resolveDemoReview } from '../lib/demo-proposal-effects'
import { readDemoRevocationHistory } from '../lib/demo-workflow-history'

jest.mock('@open-mercato/core/modules/workflows/lib/find-definition', () => ({ findWorkflowDefinition: jest.fn() }))
jest.mock('@open-mercato/shared/modules/workflows/code-registry', () => ({ getCodeWorkflow: jest.fn() }))
jest.mock('@open-mercato/queue', () => ({ createModuleQueue: jest.fn() }))
jest.mock('@open-mercato/shared/lib/encryption/find', () => ({ findOneWithDecryption: jest.fn(), findWithDecryption: jest.fn() }))
jest.mock('@open-mercato/shared/lib/i18n/server', () => ({ resolveTranslations: async () => ({ translate: (key: string) => key }) }))
jest.mock('../lib/demo-preparation', () => ({ assertPreparedPhotographerDemo: jest.fn(async () => undefined) }))
jest.mock('../lib/demo-proposal-effects', () => ({ readDemoEffectResult: jest.fn(), probeDemoReviewEffectStatus: jest.fn(), resolveDemoReview: jest.fn() }))
jest.mock('../lib/demo-workflow-history', () => ({ readDemoRevocationHistory: jest.fn() }))

function fixture() {
  const scope = { tenantId: randomUUID(), organizationId: randomUUID() }
  const prepared = { requestId: randomUUID(), registrationId: randomUUID(), photographerId: randomUUID(), personId: randomUUID(), dealId: randomUUID(), evaluationId: randomUUID(), evaluatedAt: new Date().toISOString(), userId: randomUUID(), source: 'demo_fixture' as const }
  const executionId = randomUUID()
  const instance = { id: randomUUID(), workflowId: DEMO_WORKFLOW_ID, ...scope, status: 'PAUSED', currentStepId: 'wait_review', correlationKey: `process_execution:${executionId}`, context: { demo: prepared, reviewDispatch: { result: { operationId: randomUUID() } } } }
  const step = { id: randomUUID(), workflowInstanceId: instance.id, ...scope, stepId: 'wait_review', branchInstanceId: null, status: 'ACTIVE' }
  const execution = { id: executionId, ...scope, workflowId: DEMO_WORKFLOW_ID, workflowInstanceId: instance.id, input: { demo: prepared }, idempotencyKey: `photographers.demo:${prepared.requestId}` }
  const container = createContainer()
  const em = { fork: jest.fn(), transactional: jest.fn(), begin: jest.fn(), commit: jest.fn(), rollback: jest.fn(), count: jest.fn(async () => 1), getConnection: jest.fn(() => ({ execute: jest.fn() })), getTransactionContext: jest.fn() }
  em.fork.mockReturnValue(em)
  em.transactional.mockImplementation(async (callback: (value: typeof em) => Promise<unknown>) => callback(em))
  container.register({ em: asValue(em) })
  jest.mocked(findOneWithDecryption).mockImplementation(async (_em, entity) => (entity === WorkflowInstance ? instance : entity === ProcessInstance ? execution : null) as never)
  jest.mocked(findWithDecryption).mockImplementation(async (_em, entity) => (entity === StepInstance ? [step] : []) as never)
  const enqueue = jest.fn(async () => randomUUID())
  const close = jest.fn(async () => undefined)
  jest.mocked(createModuleQueue).mockReturnValue({ enqueue, close } as never)
  return { scope, prepared, instance, step, execution, container, enqueue, close, em }
}

beforeEach(() => jest.clearAllMocks())

test('the application demo validates with built-in activities and a unique human-decision signal', () => {
  const definition = createDemoWorkflowDefinition()
  expect(workflowDefinitionDataSchema.safeParse(definition).success).toBe(true)
  expect(definition.transitions.flatMap((transition) => transition.activities ?? []).every((activity) => activity.activityType === 'EXECUTE_FUNCTION')).toBe(true)
  expect(definition.steps.find((step) => step.stepId === 'wait_review')?.signalConfig?.signalName).toBe(DEMO_REVIEW_SIGNAL)
})

test('review binds to the exact sole active step attempt and the original process input', async () => {
  const setup = fixture()
  const result = await getDemoReviewBinding({ ...setup.scope, workflowInstanceId: setup.instance.id }, setup.container)
  expect(result.invocationId).toBe(setup.step.id)
  expect(result.prepared).toEqual(setup.prepared)
  expect(findWithDecryption).toHaveBeenCalledWith(expect.anything(), StepInstance, expect.objectContaining({ ...setup.scope, workflowInstanceId: setup.instance.id, branchInstanceId: null }), expect.objectContaining({ limit: 2 }), setup.scope)
})

test('native rerun leaves a second attempt and is refused before publishing or applying a decision', async () => {
  const setup = fixture()
  jest.mocked(findWithDecryption).mockResolvedValue([setup.step, { ...setup.step, id: randomUUID() }] as never)
  await expect(getDemoReviewBinding({ ...setup.scope, workflowInstanceId: setup.instance.id }, setup.container)).rejects.toThrow('invalid_attempt')
  expect(setup.enqueue).not.toHaveBeenCalled()
})

test('context edits cannot replace the original owners or actor', async () => {
  const setup = fixture()
  setup.instance.context.demo = { ...setup.prepared, userId: randomUUID() }
  await expect(getDemoReviewBinding({ ...setup.scope, workflowInstanceId: setup.instance.id }, setup.container)).rejects.toThrow('invalid_execution')
})

test('early or completed review attempts cannot be accepted', async () => {
  const setup = fixture()
  setup.instance.status = 'RUNNING'
  await expect(getDemoReviewBinding({ ...setup.scope, workflowInstanceId: setup.instance.id }, setup.container)).rejects.toThrow('invalid_attempt')
  setup.instance.status = 'PAUSED'
  setup.step.status = 'COMPLETED'
  await expect(getDemoReviewBinding({ ...setup.scope, workflowInstanceId: setup.instance.id }, setup.container)).rejects.toThrow('invalid_attempt')
})

test('dispatch queues only scoped execution references and gives each lane a stable operation', async () => {
  const setup = fixture()
  const context = { workflowInstance: setup.instance, workflowContext: setup.instance.context } as ActivityContext
  const first = await dispatchPhotographerDemoWorkflow({ lane: 'portfolio' }, context, setup.container)
  const again = await dispatchPhotographerDemoWorkflow({ lane: 'portfolio' }, context, setup.container)
  const social = await dispatchPhotographerDemoWorkflow({ lane: 'social' }, context, setup.container)
  expect(first).toEqual(again)
  expect(first.operationId).not.toBe(social.operationId)
  expect(setup.enqueue).toHaveBeenCalledWith({ kind: 'execution', ...setup.scope, executionId: setup.execution.id }, { delayMs: 500 })
  expect(setup.close).toHaveBeenCalledTimes(3)
})

test('the recovery sweep is scoped and uses bounded keyset pagination through the platform queue', async () => {
  const setup = fixture()
  const executions = Array.from({ length: 50 }, () => ({ ...setup.execution, id: randomUUID() }))
  jest.mocked(findWithDecryption).mockResolvedValue(executions as never)
  await processPhotographerDemoJob({ kind: 'sweep', ...setup.scope }, setup.container)
  expect(findWithDecryption).toHaveBeenCalledWith(expect.anything(), ProcessInstance, expect.objectContaining({ ...setup.scope, workflowId: DEMO_WORKFLOW_ID }), { limit: 50, orderBy: { id: 'asc' } }, setup.scope)
  expect(setup.enqueue).toHaveBeenCalledTimes(51)
  expect(setup.enqueue).toHaveBeenLastCalledWith({ kind: 'sweep', ...setup.scope, afterId: executions[49].id }, { delayMs: 500 })
})

test('the job advisory lock never creates an ambient transaction for native commands and releases on failure', async () => {
  const setup = fixture()
  const transactionOwner = { name: 'default' }
  setup.em.transactional.mockImplementation((callback: (value: typeof setup.em) => Promise<unknown>) => TransactionContext.create(transactionOwner as never, () => callback(setup.em)))
  jest.mocked(findOneWithDecryption).mockImplementation(async () => {
    expect(TransactionContext.getEntityManager('default')).toBeUndefined()
    return null
  })
  const job = { kind: 'execution', ...setup.scope, executionId: setup.execution.id }
  await processPhotographerDemoJob(job, setup.container)
  expect(setup.em.transactional).not.toHaveBeenCalled()
  expect(setup.em.begin).toHaveBeenCalledTimes(1)
  expect(setup.em.commit).toHaveBeenCalledTimes(1)
  const failure = new Error('probe read failure')
  jest.mocked(findOneWithDecryption).mockRejectedValue(failure)
  await expect(processPhotographerDemoJob(job, setup.container)).rejects.toBe(failure)
  expect(setup.em.rollback).toHaveBeenCalledTimes(1)
})

test('start recovery reuses the correlated instance without starting or executing a second workflow', async () => {
  const setup = fixture()
  const existing = { ...setup.instance, version: 2 }
  jest.mocked(findWithDecryption).mockResolvedValue([existing] as never)
  const executor = { startWorkflow: jest.fn(), executeWorkflow: jest.fn() }
  const result = await startDemoWorkflowOnce(executor as never, setup.container, setup.em as never, { workflowId: DEMO_WORKFLOW_ID, ...setup.scope, correlationKey: setup.instance.correlationKey, initialContext: { demo: setup.prepared } })
  expect(result).toBe(existing)
  expect(executor.startWorkflow).not.toHaveBeenCalled()
  expect(executor.executeWorkflow).not.toHaveBeenCalled()
})

test('start refuses a mismatched process input before creating any workflow instance', async () => {
  const setup = fixture()
  const executor = { startWorkflow: jest.fn() }
  await expect(startDemoWorkflowOnce(executor as never, setup.container, setup.em as never, { workflowId: DEMO_WORKFLOW_ID, ...setup.scope, correlationKey: setup.instance.correlationKey, initialContext: { demo: { ...setup.prepared, photographerId: randomUUID() } } })).rejects.toThrow('invalid_execution')
  expect(executor.startWorkflow).not.toHaveBeenCalled()
})

test('non-demo starts delegate byte-for-byte to the existing executor', async () => {
  const setup = fixture()
  const result = { id: randomUUID() }
  const executor = { startWorkflow: jest.fn(async () => result) }
  const options = { workflowId: 'ordinary.workflow', initialContext: { unrelated: true } }
  await expect(startDemoWorkflowOnce(executor as never, setup.container, setup.em as never, options)).resolves.toBe(result)
  expect(executor.startWorkflow).toHaveBeenCalledWith(setup.em, options)
  expect(findOneWithDecryption).not.toHaveBeenCalled()
})

test('a native signal cannot finish the demo without a canonical disposed proposal', async () => {
  const setup = fixture()
  const references = { proposalId: randomUUID(), reviewAttemptId: setup.step.id, interactionId: randomUUID(), disposition: 'approved' }
  const context = { workflowInstance: setup.instance, workflowContext: references } as ActivityContext
  await expect(finalizePhotographerDemoWorkflow({}, context, setup.container)).rejects.toThrow('invalid_attempt')
  expect(readDemoEffectResult).not.toHaveBeenCalled()
})

test('a disposed proposal without a committed effect cannot finish the demo', async () => {
  const setup = fixture()
  setup.step.status = 'COMPLETED'
  const references = { proposalId: randomUUID(), reviewAttemptId: setup.step.id, interactionId: randomUUID(), disposition: 'approved' }
  const run = { id: randomUUID(), invocationId: setup.step.id }
  jest.mocked(findOneWithDecryption).mockImplementation(async (_em, entity) => (entity === AgentProposal ? { id: references.proposalId, runId: run.id } : entity === AgentRun ? run : null) as never)
  jest.mocked(readDemoEffectResult).mockResolvedValue(null)
  const context = { workflowInstance: setup.instance, workflowContext: references } as ActivityContext
  await expect(finalizePhotographerDemoWorkflow({}, context, setup.container)).rejects.toThrow('invalid_attempt')
  expect(readDemoEffectResult).toHaveBeenCalledWith({ ...setup.scope, proposalId: references.proposalId }, setup.container)
})

test('only the completed original attempt with the same committed effect can finish', async () => {
  const setup = fixture()
  setup.step.status = 'COMPLETED'
  const references = { proposalId: randomUUID(), reviewAttemptId: setup.step.id, interactionId: randomUUID(), disposition: 'approved' as const }
  const run = { id: randomUUID(), invocationId: setup.step.id }
  jest.mocked(findOneWithDecryption).mockImplementation(async (_em, entity) => (entity === AgentProposal ? { id: references.proposalId, runId: run.id } : entity === AgentRun ? run : null) as never)
  jest.mocked(readDemoEffectResult).mockResolvedValue(references)
  const context = { workflowInstance: setup.instance, workflowContext: references } as ActivityContext
  await expect(finalizePhotographerDemoWorkflow({}, context, setup.container)).resolves.toEqual(references)
  jest.mocked(readDemoEffectResult).mockResolvedValue({ ...references, interactionId: randomUUID() })
  await expect(finalizePhotographerDemoWorkflow({}, context, setup.container)).rejects.toThrow('invalid_attempt')
})

test.each([
  { disposition: undefined, expected: 'running' },
  { disposition: 'pending', expected: 'awaiting_review' },
  { disposition: 'approved', expected: 'running' },
])('review status is $expected when proposal disposition is $disposition', async ({ disposition, expected }) => {
  const setup = fixture()
  setup.container.register({ rbacService: asValue({ userHasAllFeatures: jest.fn(async () => true) }) })
  const proposal = disposition ? { id: randomUUID(), disposition } : null
  jest.mocked(findOneWithDecryption).mockImplementation(async (_em, entity) => (entity === WorkflowInstance ? setup.instance : entity === ProcessInstance ? setup.execution : entity === AgentProposal ? proposal : null) as never)
  jest.mocked(probeDemoReviewEffectStatus).mockResolvedValue('ready')
  const ctx = { container: setup.container, auth: { sub: randomUUID(), tenantId: setup.scope.tenantId, orgId: setup.scope.organizationId }, selectedOrganizationId: setup.scope.organizationId, organizationIds: [setup.scope.organizationId], organizationScope: null }
  await expect(getPhotographerDemoExecution(setup.prepared.requestId, ctx)).resolves.toMatchObject({ status: expected })
})

test('a known effect conflict appears as failed without mutating workflow state', async () => {
  const setup = fixture()
  setup.container.register({ rbacService: asValue({ userHasAllFeatures: jest.fn(async () => true) }) })
  const proposal = { id: randomUUID(), disposition: 'approved' }
  jest.mocked(findOneWithDecryption).mockImplementation(async (_em, entity) => (entity === WorkflowInstance ? setup.instance : entity === ProcessInstance ? setup.execution : entity === AgentProposal ? proposal : null) as never)
  jest.mocked(probeDemoReviewEffectStatus).mockResolvedValue('conflict')
  const ctx = { container: setup.container, auth: { sub: randomUUID(), tenantId: setup.scope.tenantId, orgId: setup.scope.organizationId }, selectedOrganizationId: setup.scope.organizationId, organizationIds: [setup.scope.organizationId], organizationScope: null }
  await expect(getPhotographerDemoExecution(setup.prepared.requestId, ctx)).resolves.toMatchObject({ status: 'failed' })
  expect(setup.instance.status).toBe('PAUSED')
  expect(setup.em.transactional).not.toHaveBeenCalled()
  expect(setup.enqueue).not.toHaveBeenCalled()
})

test('revoked original actor permissions appear as unavailable to an authorized viewer', async () => {
  const setup = fixture()
  const userHasAllFeatures = jest.fn(async (userId: string) => userId !== setup.prepared.userId)
  setup.container.register({ rbacService: asValue({ userHasAllFeatures }) })
  const ctx = { container: setup.container, auth: { sub: randomUUID(), tenantId: setup.scope.tenantId, orgId: setup.scope.organizationId }, selectedOrganizationId: setup.scope.organizationId, organizationIds: [setup.scope.organizationId], organizationScope: null }
  await expect(getPhotographerDemoExecution(setup.prepared.requestId, ctx)).resolves.toMatchObject({ status: 'unavailable' })
  expect(setup.enqueue).not.toHaveBeenCalled()
})

test.each([
  { history: 'none' as const, expected: 'completed' },
  { history: 'partial' as const, expected: 'failed' },
  { history: 'revoked' as const, expected: 'revoked' },
])('completed workflow reports $expected from $history undo history without rechecking old write permissions', async ({ history, expected }) => {
  const setup = fixture()
  setup.instance.status = 'COMPLETED'
  const userHasAllFeatures = jest.fn(async (userId: string) => userId !== setup.prepared.userId)
  setup.container.register({ rbacService: asValue({ userHasAllFeatures }) })
  const proposal = { id: randomUUID(), disposition: 'approved' }
  jest.mocked(findOneWithDecryption).mockImplementation(async (_em, entity) => (entity === WorkflowInstance ? setup.instance : entity === ProcessInstance ? setup.execution : entity === AgentProposal ? proposal : null) as never)
  jest.mocked(readDemoRevocationHistory).mockResolvedValue(history)
  const ctx = { container: setup.container, auth: { sub: randomUUID(), tenantId: setup.scope.tenantId, orgId: setup.scope.organizationId }, selectedOrganizationId: setup.scope.organizationId, organizationIds: [setup.scope.organizationId], organizationScope: null }
  await expect(getPhotographerDemoExecution(setup.prepared.requestId, ctx)).resolves.toMatchObject({ status: expected })
  expect(userHasAllFeatures).toHaveBeenCalledTimes(1)
  expect(probeDemoReviewEffectStatus).not.toHaveBeenCalled()
  expect(setup.instance.status).toBe('COMPLETED')
  expect(setup.enqueue).not.toHaveBeenCalled()
})

test.each(['approved', 'rejected'] as const)('real signal finalizes %s using the completed attempt inside its transaction', async (disposition) => {
  const setup = fixture()
  const definition = createDemoWorkflowDefinition()
  const transition = definition.transitions.find((entry) => entry.transitionId === 'review_end')!
  const proposal = { id: randomUUID(), agentId: 'photographers.message_review', workflowInstanceId: setup.instance.id, runId: randomUUID(), disposition }
  const run = { id: proposal.runId, invocationId: setup.step.id }
  const effect = { proposalId: proposal.id, interactionId: randomUUID(), disposition }
  const transactionStep = { ...setup.step }
  const transaction = { ...setup.em, flush: jest.fn() }
  let committed = false
  setup.em.transactional.mockImplementation(async (callback: (value: typeof transaction) => Promise<unknown>) => {
    const result = await callback(transaction)
    committed = true
    return result
  })
  jest.mocked(resolveDemoReview).mockResolvedValue(effect)
  jest.mocked(readDemoEffectResult).mockResolvedValue(effect)
  jest.mocked(findOneWithDecryption).mockImplementation(async (manager, entity) => (
    entity === WorkflowInstance ? setup.instance : entity === ProcessInstance ? setup.execution
      : entity === AgentProposal ? proposal : entity === AgentRun ? run
        : entity === WorkflowDefinition ? { definition }
          : entity === StepInstance ? (manager === transaction ? transactionStep : setup.step) : null
  ) as never)
  jest.mocked(findWithDecryption).mockImplementation(async (manager, entity) => (
    entity === StepInstance ? [manager === transaction ? transactionStep : setup.step] : []
  ) as never)
  const executeWorkflow = jest.fn(async () => { expect(committed).toBe(true) })
  const executeTransition = jest.fn(async (_manager, container, instance, _from, _to, context) => {
    expect(committed).toBe(false)
    await executeFunction(transition.activities![0].config, { workflowInstance: instance, workflowContext: context.workflowContext }, container)
    return { success: true }
  })
  setup.container.register({
    signalHandler: asValue(signalHandler),
    workflowExecutor: asValue({ executeWorkflow }),
    eventLogger: asValue({ logWorkflowEvent: jest.fn() }),
    stepHandler: asValue({ exitStep: jest.fn(async () => { transactionStep.status = 'COMPLETED' }) }),
    transitionHandler: asValue({ findValidTransitions: jest.fn(async () => [{ isValid: true, transition }]), executeTransition }),
    'workflowFunction:photographers.demo.finalize': asValue((raw: unknown, context: ActivityContext) => finalizePhotographerDemoWorkflow(raw, context, setup.container)),
  })
  await expect(processPhotographerDemoJob({ kind: 'disposition', ...setup.scope, proposalId: proposal.id }, setup.container)).resolves.toBeUndefined()
  expect(executeTransition).toHaveBeenCalledTimes(1)
  expect(executeWorkflow).toHaveBeenCalledTimes(1)
  expect(setup.step.status).toBe('ACTIVE')
  expect(transactionStep.status).toBe('COMPLETED')
})

test.each(['waiting', 'completed', 'failed'] as const)('reports O1 %s separately from the overall evaluation', async (stage) => {
  const setup = fixture()
  Object.assign(setup.instance, { version: 2, currentStepId: stage === 'completed' ? 'await_o2_integration' : 'o1', status: stage === 'failed' ? 'FAILED' : 'PAUSED' })
  if (stage === 'completed') Object.assign(setup.instance.context, { o1Result: { result: { runId: randomUUID(), tracesRef: randomUUID(), status: 'partial' } } })
  setup.container.register({ rbacService: asValue({ userHasAllFeatures: jest.fn(async () => true) }) })
  const ctx = { container: setup.container, auth: { sub: setup.prepared.userId, tenantId: setup.scope.tenantId, orgId: setup.scope.organizationId }, selectedOrganizationId: setup.scope.organizationId, organizationIds: [setup.scope.organizationId], organizationScope: null }
  await expect(getPhotographerDemoExecution(setup.prepared.requestId, ctx)).resolves.toMatchObject({ status: stage === 'failed' ? 'failed' : 'running', o1: { status: stage, nextStage: 'o2', sourcesAccepted: true }, proposalId: null })
})

test('a persisted legacy definition cannot silently start synthetic research for a new demo request', async () => {
  const setup = fixture()
  jest.mocked(findWithDecryption).mockResolvedValue([])
  jest.mocked(getCodeWorkflow).mockReturnValue({ version: 2, definition: { steps: [], transitions: [] } } as never)
  jest.mocked(findWorkflowDefinition).mockResolvedValue({ version: 1, definition: createDemoWorkflowDefinition() } as never)
  const executor = { startWorkflow: jest.fn() }
  await expect(startDemoWorkflowOnce(executor as never, setup.container, setup.em as never, { workflowId: DEMO_WORKFLOW_ID, ...setup.scope, correlationKey: setup.instance.correlationKey, initialContext: { demo: setup.prepared } })).rejects.toThrow('unavailable')
  expect(executor.startWorkflow).not.toHaveBeenCalled()
})

test('active legacy demo reports unavailable rather than running against the replacement graph', async () => {
  const setup = fixture()
  Object.assign(setup.instance, { version: 1 })
  setup.container.register({ rbacService: asValue({ userHasAllFeatures: jest.fn(async () => true) }) })
  const ctx = { container: setup.container, auth: { sub: setup.prepared.userId, tenantId: setup.scope.tenantId, orgId: setup.scope.organizationId }, selectedOrganizationId: setup.scope.organizationId, organizationIds: [setup.scope.organizationId], organizationScope: null }
  await expect(getPhotographerDemoExecution(setup.prepared.requestId, ctx)).resolves.toMatchObject({ status: 'unavailable' })
})
