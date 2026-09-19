import { randomUUID } from 'node:crypto'
import type { EntityManager } from '@mikro-orm/core'
import { asValue, createContainer } from 'awilix'
import { WorkflowBranchInstance, WorkflowDefinition, WorkflowInstance, StepInstance } from '@open-mercato/core/modules/workflows/data/entities'
import { workflowDefinitionDataSchema } from '@open-mercato/core/modules/workflows/data/validators'
import { findDefinitionForInstance } from '@open-mercato/core/modules/workflows/lib/find-definition'
import { findOneWithDecryption } from '@open-mercato/shared/lib/encryption/find'
import { openFork, advanceBranches } from '@open-mercato/core/modules/workflows/lib/parallel-handler'
import * as stepHandler from '@open-mercato/core/modules/workflows/lib/step-handler'
import * as transitionHandler from '@open-mercato/core/modules/workflows/lib/transition-handler'
import * as eventLogger from '@open-mercato/core/modules/workflows/lib/event-logger'
import { sendSignal } from '@open-mercato/core/modules/workflows/lib/signal-handler'
import { executeWorkflow } from '@open-mercato/core/modules/workflows/lib/workflow-executor'
import type { ActivityContext } from '@open-mercato/core/modules/workflows/lib/activity-executor'
import { classifySyntheticCallback, createSyntheticWorkflowDefinition, syntheticWorkflowLanes } from '../lib/synthetic-workflow'

jest.mock('@open-mercato/core/modules/workflows/lib/find-definition', () => ({ findDefinitionForInstance: jest.fn(), resolveCodeDefinitionForInstance: jest.fn() }))
jest.mock('@open-mercato/shared/lib/encryption/find', () => ({ findOneWithDecryption: jest.fn(), findWithDecryption: jest.fn() }))

type Stored = Record<string, unknown>
const scope = { tenantId: '00000000-0000-4000-8000-000000000001', organizationId: '00000000-0000-4000-8000-000000000002' }

function fixture() {
  const rows = new Map<unknown, Stored[]>()
  const storage = {
    create(entity: unknown, values: Stored) {
      const row = { id: randomUUID(), ...values }
      rows.set(entity, [...(rows.get(entity) ?? []), row])
      return row
    },
    persist() { return storage },
    flush: jest.fn(async () => undefined),
    async find(entity: unknown, where: Stored) {
      return (rows.get(entity) ?? []).filter((row) => Object.entries(where).every(([key, value]) => {
        if (value && typeof value === 'object' && '$in' in value && Array.isArray(value.$in)) return value.$in.includes(row[key])
        return row[key] === value
      }))
    },
    async count(entity: unknown, where: Stored) { return (await storage.find(entity, where)).length },
    async findOne(entity: unknown, where: Stored) { return (await storage.find(entity, where))[0] ?? null },
  }
  const em = storage as unknown as EntityManager
  const definition = storage.create(WorkflowDefinition, { id: randomUUID(), ...scope, deletedAt: null, workflowId: 'photographers_synthetic', workflowName: 'photographers.synthetic', definition: createSyntheticWorkflowDefinition() }) as unknown as WorkflowDefinition
  const instance = storage.create(WorkflowInstance, { ...scope, definitionId: definition.id, workflowId: definition.workflowId, currentStepId: 'research', status: 'RUNNING', context: { evaluationId: randomUUID() } }) as unknown as WorkflowInstance
  jest.mocked(findDefinitionForInstance).mockResolvedValue(definition)
  jest.mocked(findOneWithDecryption).mockImplementation(async (_em, entity, where) => storage.findOne(entity, where as Stored) as never)
  const queued: { operationId: string; lane: string; waitStepId: string; context: ActivityContext }[] = []
  const dispatch = jest.fn(async (args: { lane: string; waitStepId: string }, context: ActivityContext) => {
    const operationId = randomUUID()
    queued.push({ ...args, operationId, context })
    return { operationId }
  })
  const executeWorkflow = jest.fn(async () => undefined)
  const container = createContainer()
  container.register({
    'workflowFunction:photographers.synthetic.dispatch': asValue(dispatch),
    stepHandler: asValue(stepHandler), transitionHandler: asValue(transitionHandler), eventLogger: asValue(eventLogger),
    workflowExecutor: asValue({ executeWorkflow }),
  })
  async function park() {
    await openFork(em, instance, definition, definition.definition.steps.find((step) => step.stepId === 'research'))
    const result = await advanceBranches(em, container, instance, definition, { userId: 'trusted-user' })
    expect(result).toEqual({ outcome: 'waiting' })
  }
  const branches = () => (rows.get(WorkflowBranchInstance) ?? []) as unknown as WorkflowBranchInstance[]
  return { em, storage, definition, instance, container, queued, dispatch, executeWorkflow, park, branches }
}

beforeEach(() => jest.clearAllMocks())

test('the current frozen platform validator accepts every activity and the complete fork/join definition', () => {
  const definition = createSyntheticWorkflowDefinition()
  expect(workflowDefinitionDataSchema.safeParse(definition).success).toBe(true)
  expect(definition.transitions.flatMap((transition) => transition.activities ?? []).map((activity) => activity.activityType)).toEqual(['EXECUTE_FUNCTION', 'EXECUTE_FUNCTION', 'EXECUTE_FUNCTION'])
})

test('actual transition dispatch carries trusted branch context and persists its receipt before parking both lanes', async () => {
  const setup = fixture()
  await setup.park()
  expect(setup.instance.status).toBe('FORKED')
  expect(setup.queued).toHaveLength(2)
  for (const job of setup.queued) {
    const branch = setup.branches().find((candidate) => candidate.id === job.context.branchInstanceId)
    expect(branch).toMatchObject({ status: 'PAUSED', currentStepId: job.waitStepId, ...scope })
    expect(branch?.contextNamespace?.[`${job.lane}Dispatch`]).toMatchObject({ executed: true, result: { operationId: job.operationId } })
    expect(job.context.workflowInstance.id).toBe(setup.instance.id)
    expect(job.context.userId).toBe('trusted-user')
    expect(job.context.stepInstanceId).toBeUndefined()
  }
  expect(setup.instance.context.portfolioDispatch).toBeUndefined()
})

test('actual signals resume only their lane, join preserves both results, and root transition parks review', async () => {
  const setup = fixture()
  await setup.park()
  for (const lane of syntheticWorkflowLanes) {
    await sendSignal(setup.em, setup.container, { instanceId: setup.instance.id, ...scope, signalName: `photographers.synthetic.${lane}.ready`, payload: { [`${lane}MaterialId`]: randomUUID() } })
    const branch = setup.branches().find((candidate) => candidate.branchKey === `dispatch_${lane}`)
    expect(branch?.status).toBe('ACTIVE')
    if (lane === 'portfolio') expect(setup.branches().find((candidate) => candidate.branchKey === 'dispatch_social')?.status).toBe('PAUSED')
    const result = await advanceBranches(setup.em, setup.container, setup.instance, setup.definition, {})
    expect(result.outcome).toBe(lane === 'portfolio' ? 'waiting' : 'joined')
  }
  expect(setup.instance).toMatchObject({ status: 'RUNNING', currentStepId: 'join' })
  expect(setup.instance.context.branches).toMatchObject({ dispatch_portfolio: { portfolioMaterialId: expect.any(String) }, dispatch_social: { socialMaterialId: expect.any(String) } })
  const review = await transitionHandler.executeTransition(setup.em, setup.container, setup.instance, 'join', 'wait_review', { workflowContext: setup.instance.context })
  expect(review.success).toBe(true)
  expect(setup.instance).toMatchObject({ status: 'PAUSED', currentStepId: 'wait_review' })
  expect(setup.queued.at(-1)?.context.branchInstanceId).toBeNull()
  expect(setup.instance.context.reviewDispatch).toMatchObject({ result: { operationId: setup.queued.at(-1)?.operationId } })
  await expect(sendSignal(setup.em, setup.container, { instanceId: setup.instance.id, ...scope, signalName: 'agent_orchestrator.proposal.ready', payload: { proposalId: randomUUID(), stepId: 'stale_review' } })).rejects.toMatchObject({ code: 'SIGNAL_NAME_MISMATCH' })
  expect(setup.instance.status).toBe('PAUSED')
  await sendSignal(setup.em, setup.container, { instanceId: setup.instance.id, ...scope, signalName: 'photographers.synthetic.review.ready', payload: { proposalId: randomUUID(), disposition: 'approved' } })
  expect(setup.instance.currentStepId).toBe('end')
  expect(setup.instance.context.disposition).toBe('approved')
  const completion = await executeWorkflow(setup.em, setup.container, setup.instance.id, { userId: 'trusted-user' })
  expect(completion.status).toBe('COMPLETED')
  expect(setup.instance.status).toBe('COMPLETED')
})

test('early delivery is rejected by actual engine, can retry once parked, and duplicate delivery cannot resume again', async () => {
  const setup = fixture()
  await openFork(setup.em, setup.instance, setup.definition, setup.definition.definition.steps.find((step) => step.stepId === 'research'))
  const options = { instanceId: setup.instance.id, ...scope, signalName: 'photographers.synthetic.portfolio.ready', payload: { portfolioMaterialId: randomUUID() } }
  await expect(sendSignal(setup.em, setup.container, options)).rejects.toMatchObject({ code: 'NO_BRANCH_AWAITING_SIGNAL' })
  await advanceBranches(setup.em, setup.container, setup.instance, setup.definition, {})
  await sendSignal(setup.em, setup.container, options)
  await expect(sendSignal(setup.em, setup.container, options)).rejects.toMatchObject({ code: 'NO_BRANCH_AWAITING_SIGNAL' })
  expect(setup.executeWorkflow).toHaveBeenCalledTimes(1)
  expect(setup.dispatch).toHaveBeenCalledTimes(2)
})

test('operation receipt fences earlier attempts and completed waits while tolerating precommit delivery', async () => {
  const setup = fixture()
  await setup.park()
  const job = setup.queued[0]
  const branch = setup.branches()[0]
  const active = await setup.storage.findOne(StepInstance, { branchInstanceId: branch.id, status: 'ACTIVE' })
  const input = { operationId: job.operationId, waitStepId: job.waitStepId, currentStepId: branch.currentStepId, status: branch.status, receipt: branch.contextNamespace?.[`${job.lane}Dispatch`], waitAttemptStatus: active?.status as 'ACTIVE' }
  expect(classifySyntheticCallback(input)).toBe('ready')
  expect(classifySyntheticCallback({ ...input, operationId: randomUUID() })).toBe('obsolete')
  expect(classifySyntheticCallback({ ...input, status: 'ACTIVE', receipt: undefined, waitAttemptStatus: null })).toBe('retry')
  expect(classifySyntheticCallback({ ...input, status: 'ACTIVE', waitAttemptStatus: 'COMPLETED' })).toBe('obsolete')
  expect(classifySyntheticCallback({ ...input, status: 'CANCELLED' })).toBe('obsolete')
})

test('the actual executor drives fork, both independent callbacks, join, review and terminal completion', async () => {
  const setup = fixture()
  setup.container.register('workflowExecutor', asValue({ executeWorkflow }))
  await openFork(setup.em, setup.instance, setup.definition, setup.definition.definition.steps.find((step) => step.stepId === 'research'))
  await executeWorkflow(setup.em, setup.container, setup.instance.id, { userId: 'trusted-user' })
  expect(setup.branches().map((branch) => branch.status)).toEqual(['PAUSED', 'PAUSED'])
  for (const lane of syntheticWorkflowLanes) {
    await sendSignal(setup.em, setup.container, { instanceId: setup.instance.id, ...scope, signalName: `photographers.synthetic.${lane}.ready`, payload: { [`${lane}MaterialId`]: randomUUID() } })
  }
  expect(setup.instance).toMatchObject({ currentStepId: 'wait_review', status: 'PAUSED' })
  expect(setup.dispatch).toHaveBeenCalledTimes(3)
  await sendSignal(setup.em, setup.container, { instanceId: setup.instance.id, ...scope, signalName: 'photographers.synthetic.review.ready', payload: { proposalId: randomUUID(), disposition: 'approved' } })
  expect(setup.instance).toMatchObject({ currentStepId: 'end', status: 'COMPLETED', outcome: 'success' })
})
