import { discoveryResearch } from './portfolio-discovery-fixture'
import { randomUUID } from 'node:crypto'
import { asValue, createContainer } from 'awilix'
import { findOneWithDecryption } from '@open-mercato/shared/lib/encryption/find'
import { StepInstance, WorkflowInstance } from '@open-mercato/core/modules/workflows/data/entities'
import { AgentRun } from '@open-mercato/enterprise/modules/agent_orchestrator/data/entities'
import { PhotographerRawData } from '../data/entities'
import { storePortfolioDiscoveryWorkflowResult } from '../lib/portfolio-discovery-workflow'

jest.mock('@open-mercato/shared/lib/encryption/find', () => ({ findOneWithDecryption: jest.fn() }))

function fixture() {
  const scope = { tenantId: randomUUID(), organizationId: randomUUID() }
  const references = {
    registrationId: randomUUID(), photographerId: randomUUID(), personId: randomUUID(),
    dealId: randomUUID(), evaluationId: randomUUID(), evaluatedAt: '2026-09-19T10:00:00Z',
  }
  const instance = Object.assign(new WorkflowInstance(), {
    id: randomUUID(), workflowId: 'photographers.hidden_potential', currentStepId: 'o1',
    status: 'RUNNING', context: references, ...scope,
  })
  const registration = { id: references.registrationId, firstName: 'Anna', lastName: 'Nowak', email: 'anna@example.invalid', portfolioRaw: '' }
  const run = {
    id: randomUUID(), invocationId: randomUUID(), completedAt: new Date('2026-09-19T10:01:00Z') as Date | null,
    input: { firstName: registration.firstName, lastName: registration.lastName, registrationEmail: registration.email, originalPortfolio: '' },
    output: discoveryResearch(),
  }
  const step = { id: run.invocationId, status: 'COMPLETED' }
  const em = { fork: jest.fn(), count: jest.fn().mockResolvedValue(1) }
  em.fork.mockReturnValue(em)
  const materialId = randomUUID()
  const execute = jest.fn().mockResolvedValue({ result: { id: materialId } })
  const userHasAllFeatures = jest.fn().mockResolvedValue(true)
  const container = createContainer()
  container.register({ em: asValue(em), commandBus: asValue({ execute }), rbacService: asValue({ userHasAllFeatures }) })
  const records = new Map<unknown, unknown>([[WorkflowInstance, instance], [AgentRun, run], [StepInstance, step], [PhotographerRawData, registration]])
  jest.mocked(findOneWithDecryption).mockImplementation(async (_manager, entity) => records.get(entity) as never)
  const context = { workflowInstance: instance, workflowContext: {}, userId: randomUUID() }
  return { scope, references, instance, registration, run, step, em, materialId, execute, userHasAllFeatures, container, records, context }
}

beforeEach(() => jest.clearAllMocks())

test('stores scoped partial discovery through the command and returns references only', async () => {
  const setup = fixture()
  await expect(storePortfolioDiscoveryWorkflowResult({ runId: setup.run.id }, setup.context, setup.container)).resolves.toEqual({ runId: setup.run.id, tracesRef: setup.materialId, status: 'no_results' })
  expect(setup.execute).toHaveBeenCalledTimes(1)
  const [commandId, options] = setup.execute.mock.calls[0]
  expect(commandId).toBe('photographers.evaluation.store_material')
  expect(options.input).toEqual({ operationId: expect.any(String), snapshot: {
      registrationId: setup.references.registrationId, photographerId: setup.references.photographerId,
      personId: setup.references.personId, dealId: setup.references.dealId,
      material: { kind: 'traces', data: { schemaVersion: 1, evaluationId: setup.references.evaluationId, evaluatedAt: setup.references.evaluatedAt, discoveryStatus: 'partial', traces: [] } },
    },
  })
  expect(options.ctx.auth).toEqual({ sub: setup.context.userId, tenantId: setup.scope.tenantId, orgId: setup.scope.organizationId })
  for (const call of jest.mocked(findOneWithDecryption).mock.calls) {
    expect(call[2]).toEqual(expect.objectContaining(setup.scope))
    expect(call[4]).toEqual(setup.scope)
  }
  expect(findOneWithDecryption).toHaveBeenCalledWith(setup.em, AgentRun, expect.objectContaining({ id: setup.run.id, workflowInstanceId: setup.instance.id, stepId: 'o1', agentId: 'agent_examples.portfolio_reader_o1', status: 'ok', resultKind: 'research' }), {}, setup.scope)
  expect(findOneWithDecryption).toHaveBeenCalledWith(setup.em, StepInstance, expect.objectContaining({ id: setup.run.invocationId, workflowInstanceId: setup.instance.id, stepId: 'o1' }), {}, setup.scope)
})

test.each(['firstName', 'lastName', 'registrationEmail', 'originalPortfolio'] as const)('rejects a mismatched run input %s before storing', async (field) => {
  const setup = fixture()
  setup.run.input[field] = 'different'
  await expect(storePortfolioDiscoveryWorkflowResult({ runId: setup.run.id }, setup.context, setup.container)).rejects.toThrow('does not belong')
  expect(setup.execute).not.toHaveBeenCalled()
})

test.each([WorkflowInstance, AgentRun, StepInstance, PhotographerRawData])('rejects missing or cross-scoped records', async (entity) => {
  const setup = fixture()
  setup.records.delete(entity)
  await expect(storePortfolioDiscoveryWorkflowResult({ runId: setup.run.id }, setup.context, setup.container)).rejects.toThrow()
  expect(setup.execute).not.toHaveBeenCalled()
})

test('requires permissions before accessing research', async () => {
  const setup = fixture()
  setup.userHasAllFeatures.mockResolvedValue(false)
  await expect(storePortfolioDiscoveryWorkflowResult({ runId: setup.run.id }, setup.context, setup.container)).rejects.toThrow('access denied')
  expect(findOneWithDecryption).not.toHaveBeenCalled()
  expect(setup.execute).not.toHaveBeenCalled()
})

test.each([0, 2])('rejects ambiguous step history with %s attempts', async (attempts) => {
  const setup = fixture()
  setup.em.count.mockResolvedValue(attempts)
  await expect(storePortfolioDiscoveryWorkflowResult({ runId: setup.run.id }, setup.context, setup.container)).rejects.toThrow('attempt does not match')
  expect(setup.execute).not.toHaveBeenCalled()
})

test('rejects an incomplete run', async () => {
  const setup = fixture()
  setup.run.completedAt = null
  await expect(storePortfolioDiscoveryWorkflowResult({ runId: setup.run.id }, setup.context, setup.container)).rejects.toThrow('not complete')
  expect(setup.execute).not.toHaveBeenCalled()
})

test.each(['identity', 'end'])('cannot attach output after workflow leaves O1 for %s', async (stepId) => {
  const setup = fixture()
  setup.instance.currentStepId = stepId
  await expect(storePortfolioDiscoveryWorkflowResult({ runId: setup.run.id }, setup.context, setup.container)).rejects.toThrow('not current')
  expect(setup.execute).not.toHaveBeenCalled()
})
