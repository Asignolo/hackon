import { randomUUID } from 'node:crypto'
import { TransactionContext, type EntityManager } from '@mikro-orm/core'
import { asValue, createContainer } from 'awilix'
import { findOneWithDecryption } from '@open-mercato/shared/lib/encryption/find'
import { StepInstance, WorkflowInstance } from '@open-mercato/core/modules/workflows/data/entities'
import { executeFunction } from '@open-mercato/core/modules/workflows/lib/activity-executor'
import { register } from '../di'
import type { FactsSnapshot, TracesSnapshot } from '../data/evaluation-validators'
import { scorePhotographerWorkflow } from '../lib/evaluation-scoring-workflow'
import { readEvaluationMaterial } from '../lib/material-store'
import { materialOperationId } from '../lib/material-codec'
import { DEFAULT_HIDDEN_POTENTIAL_RULES, loadHiddenPotentialRules } from '../lib/rules-config'

jest.mock('@open-mercato/shared/lib/encryption/find', () => ({ findOneWithDecryption: jest.fn() }))
jest.mock('../lib/material-store', () => ({ readEvaluationMaterial: jest.fn() }))
jest.mock('../lib/rules-config', () => ({ ...jest.requireActual('../lib/rules-config'), loadHiddenPotentialRules: jest.fn() }))

function fixture() {
  const scope = { tenantId: randomUUID(), organizationId: randomUUID() }
  const references = {
    registrationId: randomUUID(), photographerId: randomUUID(), personId: randomUUID(), dealId: randomUUID(),
    evaluationId: randomUUID(), evaluatedAt: '2026-09-19T10:00:00Z',
  }
  const factsRef = randomUUID()
  const tracesRef = randomUUID()
  const traceId = randomUUID()
  const instance = Object.assign(new WorkflowInstance(), {
    id: randomUUID(), workflowId: 'photographers.hidden_potential', currentStepId: 'score', status: 'RUNNING',
    context: { ...references, factsRef, rulesVersion: DEFAULT_HIDDEN_POTENTIAL_RULES.version, rulesSnapshot: structuredClone(DEFAULT_HIDDEN_POTENTIAL_RULES) }, ...scope,
  })
  const step = { id: randomUUID(), status: 'ACTIVE' }
  const metadata = { registrationId: references.registrationId, photographerId: references.photographerId, personId: references.personId, dealId: references.dealId, evaluationId: references.evaluationId, schemaVersion: 1, updatedAt: references.evaluatedAt }
  const facts = { ...metadata, id: factsRef, kind: 'facts', data: {
    schemaVersion: 1, evaluationId: references.evaluationId, evaluatedAt: references.evaluatedAt, tracesRef,
    facts: [{ schemaVersion: 1, state: 'known', key: 'nipConfirmed', value: true, owner: 'registry', traceId,
      sourceRef: 'https://example.invalid/registry', observedAt: references.evaluatedAt, readStatus: 'ok' }],
  } satisfies FactsSnapshot }
  const traces = { ...metadata, id: tracesRef, kind: 'traces', data: {
    schemaVersion: 1, evaluationId: references.evaluationId, evaluatedAt: references.evaluatedAt, discoveryStatus: 'complete',
    traces: [{ schemaVersion: 1, id: traceId, kind: 'registry', value: 'https://example.invalid/registry', status: 'confirmed',
      provenance: [{ value: 'Registry record', sourceRef: 'https://example.invalid/registry', observedAt: references.evaluatedAt }],
      observedAt: references.evaluatedAt, candidateIds: [] }],
  } satisfies TracesSnapshot }
  const em = { name: 'default', fork: jest.fn(), count: jest.fn().mockResolvedValue(1) }
  em.fork.mockReturnValue(em)
  const scoreRef = randomUUID()
  const execute = jest.fn().mockResolvedValue({ result: { id: scoreRef } })
  const userHasAllFeatures = jest.fn().mockResolvedValue(true)
  const container = createContainer()
  const moduleConfigService = {}
  container.register({ em: asValue(em), commandBus: asValue({ execute }), rbacService: asValue({ userHasAllFeatures }), moduleConfigService: asValue(moduleConfigService) })
  register(container)
  const records = new Map<unknown, unknown>([[WorkflowInstance, instance], [StepInstance, step]])
  jest.mocked(findOneWithDecryption).mockImplementation(async (_manager, entity) => records.get(entity) as never)
  jest.mocked(readEvaluationMaterial).mockImplementation(async (id) => (id === factsRef ? facts : traces) as never)
  jest.mocked(loadHiddenPotentialRules).mockResolvedValue(DEFAULT_HIDDEN_POTENTIAL_RULES)
  const context = { workflowInstance: instance, workflowContext: {}, userId: randomUUID() }
  const run = () => scorePhotographerWorkflow({ factsRef }, context, container)
  return { scope, references, factsRef, tracesRef, facts, traces, instance, step, em, scoreRef, execute, userHasAllFeatures, container, moduleConfigService, records, context, run }
}

beforeEach(() => jest.clearAllMocks())

test('executes the registered workflow function, saves a real score and returns references only', async () => {
  const setup = fixture()
  await expect(executeFunction({ functionName: 'photographers.evaluation.score', args: { factsRef: setup.factsRef } }, setup.context, setup.container)).resolves.toEqual({
    executed: true, functionName: 'photographers.evaluation.score',
    result: { scoreRef: setup.scoreRef, factsRef: setup.factsRef, rulesVersion: DEFAULT_HIDDEN_POTENTIAL_RULES.version, reviewRequired: false },
  })
  expect(setup.execute).toHaveBeenCalledTimes(1)
  const [command, options] = setup.execute.mock.calls[0]
  expect(command).toBe('photographers.evaluation.store_material')
  expect(options.input.operationId).toBe(materialOperationId(setup.references.evaluationId, `score:${setup.factsRef}:${DEFAULT_HIDDEN_POTENTIAL_RULES.version}`))
  expect(options.input.snapshot).toEqual(expect.objectContaining({
    registrationId: setup.references.registrationId, photographerId: setup.references.photographerId,
    personId: setup.references.personId, dealId: setup.references.dealId,
    material: { kind: 'score', data: expect.objectContaining({ score: 20, factsRef: setup.factsRef, evaluationId: setup.references.evaluationId, evaluatedAt: setup.references.evaluatedAt }) },
  }))
  expect(options.ctx.auth).toEqual({ sub: setup.context.userId, tenantId: setup.scope.tenantId, orgId: setup.scope.organizationId })
  expect(options.ctx.organizationIds).toEqual([setup.scope.organizationId])
  expect(setup.userHasAllFeatures).toHaveBeenCalledWith(setup.context.userId, expect.arrayContaining(['photographers.evaluations.run', 'customers.interactions.manage']), setup.scope)
  for (const call of jest.mocked(findOneWithDecryption).mock.calls) {
    expect(call[2]).toEqual(expect.objectContaining(setup.scope))
    expect(call[4]).toEqual(setup.scope)
  }
  expect(readEvaluationMaterial).toHaveBeenNthCalledWith(1, setup.factsRef, options.ctx)
  expect(readEvaluationMaterial).toHaveBeenNthCalledWith(2, setup.tracesRef, options.ctx)
  expect(loadHiddenPotentialRules).not.toHaveBeenCalled()
  await setup.run()
  expect(setup.execute.mock.calls[1][1].input.operationId).toBe(options.input.operationId)
})

test('denies access before reading any workflow or material', async () => {
  const setup = fixture()
  setup.userHasAllFeatures.mockResolvedValue(false)
  await expect(setup.run()).rejects.toThrow('access denied')
  expect(findOneWithDecryption).not.toHaveBeenCalled()
  expect(readEvaluationMaterial).not.toHaveBeenCalled()
  expect(setup.execute).not.toHaveBeenCalled()
})

test.each(['facts', 'traces'] as const)('rejects mismatched %s ownership, evaluation and evaluation date', async (kind) => {
  for (const field of ['photographerId', 'personId', 'dealId', 'registrationId', 'evaluationId'] as const) {
    const setup = fixture()
    setup[kind][field] = randomUUID()
    await expect(setup.run()).rejects.toThrow('does not belong')
    expect(setup.execute).not.toHaveBeenCalled()
  }
  for (const field of ['evaluationId', 'evaluatedAt'] as const) {
    const setup = fixture()
    setup[kind].data[field] = field === 'evaluationId' ? randomUUID() : '2026-09-20T10:00:00Z'
    await expect(setup.run()).rejects.toThrow('does not belong')
    expect(setup.execute).not.toHaveBeenCalled()
  }
})

test.each(['unconfirmed', 'missing', 'rejected', 'wrong-kind'] as const)('rejects known facts with %s source traces', async (problem) => {
  const setup = fixture()
  const traces: TracesSnapshot = setup.traces.data
  if (problem === 'missing') traces.traces = []
  else if (problem === 'wrong-kind') traces.traces[0].kind = 'website'
  else {
    traces.traces[0].status = 'unconfirmed'
    if (problem === 'rejected') traces.traces[0].rejectionRef = randomUUID()
  }
  await expect(setup.run()).rejects.toThrow('confirmed source traces')
  expect(setup.execute).not.toHaveBeenCalled()
})

test('allows unknown facts without a confirmed trace and assigns no points', async () => {
  const setup = fixture()
  const facts: FactsSnapshot = setup.facts.data
  facts.facts = [{ ...facts.facts[0], state: 'unknown', value: null, readStatus: 'unavailable' }]
  setup.traces.data.traces = []
  await setup.run()
  expect(setup.execute.mock.calls[0][1].input.snapshot.material.data).toEqual(expect.objectContaining({ score: 0, matchedRules: [], unknownFactKeys: expect.arrayContaining(['nipConfirmed']) }))
})

test('rejects facts reference substitution before loading materials', async () => {
  const setup = fixture()
  await expect(scorePhotographerWorkflow({ factsRef: randomUUID() }, setup.context, setup.container)).rejects.toThrow('reference mismatch')
  expect(readEvaluationMaterial).not.toHaveBeenCalled()
  expect(setup.execute).not.toHaveBeenCalled()
})

test('rejects a rules version differing from the workflow snapshot', async () => {
  const setup = fixture()
  setup.instance.context.rulesVersion = 'another-version'
  await expect(setup.run()).rejects.toThrow('rules version')
  expect(setup.execute).not.toHaveBeenCalled()
})

test.each(['research', 'end'])('cannot score when current step is %s', async (currentStepId) => {
  const setup = fixture()
  setup.instance.currentStepId = currentStepId
  await expect(setup.run()).rejects.toThrow('not current')
  expect(setup.execute).not.toHaveBeenCalled()
})

test.each([WorkflowInstance, StepInstance])('rejects missing or cross-scope workflow records', async (entity) => {
  const setup = fixture()
  setup.records.delete(entity)
  await expect(setup.run()).rejects.toThrow()
  expect(setup.execute).not.toHaveBeenCalled()
})

test('rejects inactive score attempts', async () => {
  const setup = fixture()
  setup.step.status = 'FAILED'
  await expect(setup.run()).rejects.toThrow('attempt is unavailable')
  expect(setup.execute).not.toHaveBeenCalled()
})

test('rejects duplicate source trace identifiers', async () => {
  const setup = fixture()
  setup.traces.data.traces.push({ ...setup.traces.data.traces[0] })
  await expect(setup.run()).rejects.toThrow('Ambiguous scoring traces')
  expect(setup.execute).not.toHaveBeenCalled()
})

test('rejects another workflow or a research branch before accessing materials', async () => {
  const setup = fixture()
  await expect(scorePhotographerWorkflow({ factsRef: setup.factsRef }, { ...setup.context, branchInstanceId: randomUUID() }, setup.container)).rejects.toThrow('Invalid scoring workflow binding')
  setup.instance.workflowId = 'another.workflow'
  await expect(setup.run()).rejects.toThrow('Invalid scoring workflow binding')
  expect(readEvaluationMaterial).not.toHaveBeenCalled()
  expect(setup.execute).not.toHaveBeenCalled()
})

test('rejects a completed workflow even if its current step still says score', async () => {
  const setup = fixture()
  setup.instance.status = 'COMPLETED'
  await expect(setup.run()).rejects.toThrow('not current')
  expect(setup.execute).not.toHaveBeenCalled()
})


test('requires an immutable rules snapshot instead of falling back to current config', async () => {
  const setup = fixture()
  delete setup.instance.context.rulesSnapshot
  await expect(setup.run()).rejects.toThrow()
  expect(loadHiddenPotentialRules).not.toHaveBeenCalled()
  expect(setup.execute).not.toHaveBeenCalled()
})

test('uses the workflow rules snapshot across retries despite same-version live config edits', async () => {
  const setup = fixture()
  await setup.run()
  jest.mocked(loadHiddenPotentialRules).mockResolvedValue({
    ...DEFAULT_HIDDEN_POTENTIAL_RULES,
    weights: { ...DEFAULT_HIDDEN_POTENTIAL_RULES.weights, nipConfirmed: 99 },
  })
  await setup.run()
  expect(loadHiddenPotentialRules).not.toHaveBeenCalled()
  const original = setup.execute.mock.calls[0][1].input
  const replay = setup.execute.mock.calls[1][1].input
  expect(original.snapshot.material.data.score).toBe(20)
  expect(replay).toEqual(original)
})


test.each([0, 2])('rejects ambiguous scoring history with %s attempts', async (attempts) => {
  const setup = fixture()
  setup.em.count.mockResolvedValue(attempts)
  await expect(setup.run()).rejects.toThrow()
  expect(setup.em.count).toHaveBeenCalledWith(StepInstance, {
    workflowInstanceId: setup.instance.id, stepId: 'score', branchInstanceId: null, ...setup.scope,
  })
  expect(setup.execute).not.toHaveBeenCalled()
})


test('reads current scoring state inside the workflow transaction instead of a stale root fork', async () => {
  const setup = fixture()
  const transactionalManager = { name: 'default', _id: 2, count: jest.fn().mockResolvedValue(1) }
  jest.mocked(findOneWithDecryption).mockImplementation(async (manager, entity) => {
    if (entity === WorkflowInstance && manager !== transactionalManager) return { ...setup.instance, currentStepId: 'start' } as never
    return setup.records.get(entity) as never
  })
  await expect(TransactionContext.create(transactionalManager as unknown as EntityManager, setup.run)).resolves.toEqual({
    scoreRef: setup.scoreRef, factsRef: setup.factsRef, rulesVersion: DEFAULT_HIDDEN_POTENTIAL_RULES.version, reviewRequired: false,
  })
  expect(setup.em.fork).not.toHaveBeenCalled()
  expect(transactionalManager.count).toHaveBeenCalledTimes(1)
  for (const call of jest.mocked(findOneWithDecryption).mock.calls) expect(call[0]).toBe(transactionalManager)
})

test('reuses the score operation when a rolled-back workflow allocates a new step identifier', async () => {
  const setup = fixture()
  await setup.run()
  setup.step.id = randomUUID()
  await setup.run()
  expect(setup.execute.mock.calls[1][1].input).toEqual(setup.execute.mock.calls[0][1].input)
})
