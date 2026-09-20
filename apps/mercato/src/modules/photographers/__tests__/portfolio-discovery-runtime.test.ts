import { discoveryResearch } from './portfolio-discovery-fixture'
import { randomUUID } from 'node:crypto'
import { asValue, createContainer } from 'awilix'
import { findOneWithDecryption, findWithDecryption } from '@open-mercato/shared/lib/encryption/find'
import { createModuleQueue } from '@open-mercato/queue'
import { WorkflowInstance, StepInstance } from '@open-mercato/core/modules/workflows/data/entities'
import { AgentRun } from '@open-mercato/enterprise/modules/agent_orchestrator/data/entities'
import { PhotographerRawData } from '../data/entities'
import { preparePortfolioDiscoveryWorkflow, dispatchPortfolioDiscoveryWorkflow, processPortfolioDiscoveryJob } from '../lib/portfolio-discovery-runtime'
import { readRegistrationCrm } from '../lib/registration-crm'
import type { withDemoOperationLock } from '../lib/demo-operation-lock'
import graph from '../workflow-definitions/hidden-potential.v1.json'

jest.mock('@open-mercato/shared/lib/encryption/find', () => ({ findOneWithDecryption: jest.fn(), findWithDecryption: jest.fn() }))
jest.mock('@open-mercato/queue', () => ({ createModuleQueue: jest.fn() }))
jest.mock('../lib/demo-preparation', () => ({ assertPreparedPhotographerDemo: jest.fn(async () => undefined) }))
jest.mock('../lib/registration-crm', () => ({ readRegistrationCrm: jest.fn() }))
jest.mock('../lib/demo-operation-lock', () => ({ withDemoOperationLock: (_container: Parameters<typeof withDemoOperationLock>[0], _key: string, action: () => Promise<unknown>) => action() }))

function fixture(portfolioRaw = '') {
  const scope = { tenantId: randomUUID(), organizationId: randomUUID() }
  const prepared = { registrationId: randomUUID(), evaluationId: randomUUID(), evaluatedAt: '2026-09-19T12:00:00Z', photographerId: randomUUID(), personId: randomUUID(), dealId: randomUUID(), userId: randomUUID() }
  const instance = Object.assign(new WorkflowInstance(), { id: randomUUID(), workflowId: 'photographers.hidden_potential', currentStepId: 'o1', status: 'PAUSED', ...scope, context: { o1Preparation: { result: prepared } }, metadata: { initiatedBy: prepared.userId } })
  const step = Object.assign(new StepInstance(), { id: randomUUID(), status: 'ACTIVE', stepId: 'o1' })
  const registration = { id: prepared.registrationId, firstName: 'Anna', lastName: 'Nowak', email: 'anna@example.invalid', portfolioRaw }
  let persistedRun: { id: string; completedAt: Date | null; status: string; resultKind: string; output?: unknown } | null = null
  const em = { fork: jest.fn(), transactional: jest.fn() }
  em.fork.mockReturnValue(em)
  em.transactional.mockImplementation((action: (manager: typeof em) => Promise<void>) => action(em))
  const run = jest.fn().mockImplementation(async () => { persistedRun = { id: randomUUID(), completedAt: new Date(), status: 'ok', resultKind: 'research', output: discoveryResearch() }; return { kind: 'research', data: { private: 'not workflow context' } } })
  const execute = jest.fn().mockResolvedValue({ result: {} })
  const executeWorkflow = jest.fn()
  const completeWorkflow = jest.fn()
  const sendSignal = jest.fn().mockImplementation(async () => { instance.status = 'COMPLETED' })
  const encryptEntityPayload = jest.fn().mockImplementation(async (_entity: string, payload: Record<string, unknown>) => Object.fromEntries(Object.keys(payload).map((key) => [key, 'encrypted-value'])))
  const userHasAllFeatures = jest.fn().mockResolvedValue(true)
  const container = createContainer()
  container.register({ em: asValue(em), commandBus: asValue({ execute }), rbacService: asValue({ userHasAllFeatures }), tenantEncryptionService: asValue({ isEnabled: () => true, encryptEntityPayload }), agentRuntime: asValue({ run }), workflowExecutor: asValue({ executeWorkflow, completeWorkflow }), signalHandler: asValue({ sendSignal }) })
  jest.mocked(findOneWithDecryption).mockImplementation(async (_manager, entity) => {
    if (entity === WorkflowInstance) return instance as never
    if (entity === PhotographerRawData) return registration as never
    if (entity === StepInstance) return step as never
    if (entity === AgentRun) return persistedRun as never
    return null
  })
  jest.mocked(findWithDecryption).mockResolvedValue([step] as never)
  jest.mocked(readRegistrationCrm).mockResolvedValue({ ...prepared, status: 'ready' })
  const enqueue = jest.fn()
  const close = jest.fn()
  jest.mocked(createModuleQueue).mockReturnValue({ enqueue, close } as never)
  const context = { workflowInstance: instance, workflowContext: { registrationId: prepared.registrationId, evaluationId: prepared.evaluationId, evaluatedAt: prepared.evaluatedAt, ...instance.context }, userId: prepared.userId }
  const job = { workflowInstanceId: instance.id, ...scope }
  return { scope, prepared, instance, step, registration, em, run, execute, executeWorkflow, completeWorkflow, sendSignal, encryptEntityPayload, userHasAllFeatures, container, enqueue, close, context, job, setRun: (value: typeof persistedRun) => { persistedRun = value } }
}

beforeEach(() => jest.clearAllMocks())

test('prepares CRM and returns only trusted references', async () => {
  const setup = fixture()
  await expect(preparePortfolioDiscoveryWorkflow({}, setup.context, setup.container)).resolves.toEqual(setup.prepared)
  expect(setup.execute).toHaveBeenCalledWith('photographers.registration.prepare_crm', expect.objectContaining({ input: { registrationId: setup.prepared.registrationId } }))
})

test.each(['', 'https://portfolio.example.invalid'])('hydrates the original registration with portfolio %s only inside native runtime', async (portfolio) => {
  const setup = fixture(portfolio)
  await processPortfolioDiscoveryJob(setup.job, setup.container)
  expect(setup.run).toHaveBeenCalledWith('agent_examples.portfolio_reader_o1', { firstName: 'Anna', lastName: 'Nowak', registrationEmail: 'anna@example.invalid', originalPortfolio: portfolio }, expect.objectContaining({ ...setup.scope, userId: setup.prepared.userId, workflowInstanceId: setup.instance.id, stepId: 'o1', invocationId: setup.step.id }))
  expect(setup.sendSignal).toHaveBeenCalledWith(setup.em, expect.anything(), expect.objectContaining({ payload: { o1RunId: expect.any(String) } }))
  expect(JSON.stringify(setup.instance.context)).not.toContain('anna@example.invalid')
  await processPortfolioDiscoveryJob(setup.job, setup.container)
  expect(setup.run).toHaveBeenCalledTimes(1)
  expect(setup.sendSignal).toHaveBeenCalledTimes(1)
})

test('recovers a persisted run without rerunning the agent', async () => {
  const setup = fixture()
  const runId = randomUUID()
  setup.setRun({ id: runId, completedAt: new Date(), status: 'ok', resultKind: 'research' })
  await processPortfolioDiscoveryJob(setup.job, setup.container)
  expect(setup.run).not.toHaveBeenCalled()
  expect(setup.sendSignal).toHaveBeenCalledWith(setup.em, expect.anything(), expect.objectContaining({ payload: { o1RunId: runId } }))
})

test('does not rerun an invocation left incomplete', async () => {
  const setup = fixture()
  setup.setRun({ id: randomUUID(), completedAt: null, status: 'running', resultKind: 'research' })
  await expect(processPortfolioDiscoveryJob(setup.job, setup.container)).rejects.toThrow('not complete')
  expect(setup.run).not.toHaveBeenCalled()
  expect(setup.sendSignal).not.toHaveBeenCalled()
})

test('requires encryption before invoking or exposing registration input', async () => {
  const setup = fixture()
  setup.encryptEntityPayload.mockImplementation(async (_entity: string, payload: Record<string, unknown>) => payload)
  await expect(processPortfolioDiscoveryJob(setup.job, setup.container)).rejects.toThrow('encryption is unavailable')
  expect(setup.run).not.toHaveBeenCalled()
})

test.each(['agent_orchestrator:agent_run', 'agent_orchestrator:agent_tool_call', 'photographers:photographer_evaluation_material'])('fails closed when the %s encryption map is absent', async (entityId) => {
  const setup = fixture()
  setup.encryptEntityPayload.mockImplementation(async (entity: string, payload: Record<string, unknown>) => entity === entityId ? payload : Object.fromEntries(Object.keys(payload).map((key) => [key, 'encrypted-value'])))
  await expect(processPortfolioDiscoveryJob(setup.job, setup.container)).rejects.toThrow('encryption is unavailable')
  expect(setup.run).not.toHaveBeenCalled()
})

test('rejects a changed CRM binding', async () => {
  const setup = fixture()
  jest.mocked(readRegistrationCrm).mockResolvedValue({ ...setup.prepared, status: 'ready', personId: randomUUID() })
  await expect(processPortfolioDiscoveryJob(setup.job, setup.container)).rejects.toThrow('binding changed')
  expect(setup.run).not.toHaveBeenCalled()
})

test('rechecks execution permissions before reading source data', async () => {
  const setup = fixture()
  setup.userHasAllFeatures.mockResolvedValue(false)
  await expect(processPortfolioDiscoveryJob(setup.job, setup.container)).rejects.toThrow('access denied')
  expect(setup.run).not.toHaveBeenCalled()
  expect(readRegistrationCrm).not.toHaveBeenCalled()
})

test('rejects ambiguous retry attempts before invoking', async () => {
  const setup = fixture()
  jest.mocked(findWithDecryption).mockResolvedValue([setup.step, setup.step] as never)
  await expect(processPortfolioDiscoveryJob(setup.job, setup.container)).rejects.toThrow('ambiguous')
  expect(setup.run).not.toHaveBeenCalled()
})

test('marks terminal agent failure through the workflow lifecycle', async () => {
  const setup = fixture()
  setup.setRun({ id: randomUUID(), completedAt: new Date(), status: 'error', resultKind: 'research' })
  await processPortfolioDiscoveryJob(setup.job, setup.container)
  expect(setup.completeWorkflow).toHaveBeenCalledWith(setup.em, setup.container, setup.instance.id, 'FAILED', { failedStepId: 'o1', error: { code: 'photographers.o1.run_failed' } })
  expect(setup.sendSignal).not.toHaveBeenCalled()
})

test('a runtime exception does not expose input in queue errors', async () => {
  const setup = fixture()
  setup.run.mockRejectedValue(new Error('private anna@example.invalid model error'))
  await expect(processPortfolioDiscoveryJob(setup.job, setup.container)).rejects.toThrow('[internal] O1 invocation did not complete')
  expect(setup.completeWorkflow).not.toHaveBeenCalled()
  expect(setup.sendSignal).not.toHaveBeenCalled()
})

test('a persisted terminal failure ends the workflow on the first throwing runtime call', async () => {
  const setup = fixture()
  setup.run.mockImplementation(async () => {
    setup.setRun({ id: randomUUID(), completedAt: new Date(), status: 'error', resultKind: 'research' })
    throw new Error('private anna@example.invalid model error')
  })
  await processPortfolioDiscoveryJob(setup.job, setup.container)
  expect(setup.completeWorkflow).toHaveBeenCalledWith(setup.em, setup.container, setup.instance.id, 'FAILED', { failedStepId: 'o1', error: { code: 'photographers.o1.run_failed' } })
  expect(setup.sendSignal).not.toHaveBeenCalled()
})

test('dispatches a strict reference-only durable job', async () => {
  const setup = fixture()
  await dispatchPortfolioDiscoveryWorkflow({}, setup.context, setup.container)
  expect(setup.enqueue).toHaveBeenCalledWith(setup.job, { delayMs: 500 })
  expect(setup.close).toHaveBeenCalledTimes(1)
})

test('keeps full workflow disabled and wires O1 through a reference-only signal', () => {
  expect(graph.enabled).toBe(false)
  const step = graph.definition.steps.find((entry) => entry.stepId === 'o1')
  expect(step?.stepType).toBe('WAIT_FOR_SIGNAL')
  expect(step).not.toHaveProperty('activities')
  expect(graph.definition.transitions.find((entry) => entry.toStepId === 'o1')?.activities?.[0].config.functionName).toBe('photographers.o1.dispatch')
  expect(graph.definition.transitions.find((entry) => entry.fromStepId === 'o1')?.activities?.[0].config.args).toEqual({ runId: '{{context.o1RunId}}' })
})

test('demo runs the same O1 runtime and reuses its saved result after failed signal delivery', async () => {
  const setup = fixture('https://portfolio.example.invalid')
  setup.instance.workflowId = 'photographers.demo-evaluation'
  setup.instance.context.demo = { ...setup.prepared, requestId: randomUUID(), source: 'registration' }
  setup.sendSignal.mockRejectedValueOnce(new Error('delivery interrupted'))
  await expect(processPortfolioDiscoveryJob(setup.job, setup.container)).rejects.toThrow('delivery interrupted')
  await processPortfolioDiscoveryJob(setup.job, setup.container)
  expect(setup.run).toHaveBeenCalledTimes(1)
  expect(setup.sendSignal).toHaveBeenCalledTimes(2)
})

test('the demo boundary does not invoke O1 again or start synthetic research', async () => {
  const setup = fixture()
  setup.instance.workflowId = 'photographers.demo-evaluation'
  setup.instance.currentStepId = 'await_o2_integration'
  await processPortfolioDiscoveryJob(setup.job, setup.container)
  expect(setup.run).not.toHaveBeenCalled()
  expect(setup.sendSignal).not.toHaveBeenCalled()
})

test('demo exposes an invocation exception as workflow failure without leaking source input', async () => {
  const setup = fixture()
  setup.instance.workflowId = 'photographers.demo-evaluation'
  setup.instance.context.demo = { ...setup.prepared, requestId: randomUUID(), source: 'registration' }
  setup.run.mockRejectedValue(new Error('private model failure'))
  await processPortfolioDiscoveryJob(setup.job, setup.container)
  expect(setup.completeWorkflow).toHaveBeenCalledWith(setup.em, setup.container, setup.instance.id, 'FAILED', { failedStepId: 'o1', error: { code: 'photographers.o1.invocation_incomplete' } })
  expect(setup.sendSignal).not.toHaveBeenCalled()
})

test('a permanently rejected demo result fails the workflow instead of waiting forever', async () => {
  const setup = fixture()
  setup.instance.workflowId = 'photographers.demo-evaluation'
  setup.instance.context.demo = { ...setup.prepared, requestId: randomUUID(), source: 'registration' }
  setup.sendSignal.mockRejectedValueOnce(new Error('[internal] O1 run does not belong to this registration'))
  await processPortfolioDiscoveryJob(setup.job, setup.container)
  expect(setup.run).toHaveBeenCalledTimes(1)
  expect(setup.completeWorkflow).toHaveBeenCalledWith(setup.em, setup.container, setup.instance.id, 'FAILED', { failedStepId: 'o1', error: { code: 'photographers.o1.result_rejected' } })
})
