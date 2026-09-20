import { randomUUID } from 'node:crypto'
import { asValue, createContainer } from 'awilix'
import { createModuleQueue } from '@open-mercato/queue'
import { findOneWithDecryption, findWithDecryption } from '@open-mercato/shared/lib/encryption/find'
import { WorkflowInstance, StepInstance } from '@open-mercato/core/modules/workflows/data/entities'
import { AgentRun } from '@open-mercato/enterprise/modules/agent_orchestrator/data/entities'
import { PhotographerEvaluationMaterial } from '../data/entities'
import { storeMaterialSchema, storedMaterialSchema } from '../data/material-validators'
import { decodeMaterialSnapshot, encodeMaterialSnapshot, materialOperationId } from '../lib/material-codec'
import { readEvaluationMaterial } from '../lib/material-store'
import { readApifyResearchResult } from '../lib/apify-research-material'
import { processApifyResearchJob, dispatchApifyResearchWorkflow, APIFY_RESEARCH_AGENT_ID, APIFY_RESEARCH_STEP_ID } from '../lib/apify-research-runtime'
import { preparePortfolioDiscoveryMaterial } from '../lib/portfolio-discovery-contract'
import sample from '../agents/apify_link_researcher_o2/SAMPLE.json'

jest.mock('@open-mercato/shared/lib/encryption/find', () => ({ findOneWithDecryption: jest.fn(), findWithDecryption: jest.fn() }))
jest.mock('@open-mercato/queue', () => ({ createModuleQueue: jest.fn() }))
jest.mock('../lib/material-store', () => ({ readEvaluationMaterial: jest.fn() }))
jest.mock('../lib/demo-operation-lock', () => ({ withDemoOperationLock: (_container: unknown, _key: string, action: () => Promise<unknown>) => action() }))

function fixture(diagnostic: string | null = null, biography = 'Kontrolowany opis') {
  const scope = { tenantId: randomUUID(), organizationId: randomUUID() }
  const prepared = { registrationId: randomUUID(), evaluationId: randomUUID(), evaluatedAt: '2026-09-19T12:00:00Z', photographerId: randomUUID(), personId: randomUUID(), dealId: randomUUID(), userId: randomUUID() }
  const instance = Object.assign(new WorkflowInstance(), { id: randomUUID(), workflowId: 'photographers.hidden_potential', currentStepId: 'o2', status: 'PAUSED', ...scope, context: { o1Preparation: { result: prepared } }, metadata: { initiatedBy: prepared.userId } })
  const completedAt = new Date('2026-09-19T12:01:00Z')
  const o1Run = { id: randomUUID(), output: { kind: 'research', data: sample }, completedAt }
  const outcome = { kind: 'research', data: { schemaVersion: 1, status: diagnostic ? 'error' : 'partial', results: [{ tool: 'integration_apify.scrape_instagram_profile', url: 'https://www.instagram.com/margografia', confidence: 'confirmed', approvalRequired: true, status: diagnostic ? 'error' : 'partial', actorRunId: diagnostic ? null : 'controlled-actor', observedAt: completedAt.toISOString(), resultJson: JSON.stringify({ status: diagnostic ? 'error' : 'partial', data: diagnostic ? null : { biography, followersCount: 0, verified: false }, unavailableFields: [{ field: 'email', reason: 'not_exposed' }], diagnostics: diagnostic ? [{ code: diagnostic }] : [], sourceUrl: 'https://www.instagram.com/margografia', observedAt: completedAt.toISOString() }), error: null }], skipped: [{ url: 'https://www.facebook.com/margografia/', reason: 'Kontrolowany brak odczytu' }], summary: 'Wynik kontrolowany' } }
  const rows = new Map<string, { id: string; operationId: string; body: string; checksum: string; byteLength: number }>()
  const save = (raw: unknown) => {
    const { operationId, snapshot } = storeMaterialSchema.parse(raw)
    const id = materialOperationId(materialOperationId(operationId, `${scope.tenantId}:${scope.organizationId}`), 'manifest')
    const encoded = encodeMaterialSnapshot(snapshot)
    const existing = rows.get(id)
    if (existing && existing.body !== encoded.body) throw new Error('material_conflict')
    rows.set(id, { id, operationId, ...encoded })
    return id
  }
  const material = preparePortfolioDiscoveryMaterial(o1Run.output, { evaluationId: prepared.evaluationId, evaluatedAt: prepared.evaluatedAt, observedAt: completedAt.toISOString() }).material
  const owners = { photographerId: prepared.photographerId, personId: prepared.personId, registrationId: prepared.registrationId, dealId: prepared.dealId }
  const tracesRef = save({ operationId: materialOperationId(o1Run.id, 'o1:traces'), snapshot: { ...owners, material } })
  jest.mocked(readEvaluationMaterial).mockImplementation(async (id) => {
    const row = rows.get(id)
    if (!row) throw new Error('Missing test material')
    const snapshot = storedMaterialSchema.parse(decodeMaterialSnapshot(row))
    const evaluationId = snapshot.material.kind === 'eligibility' ? snapshot.material.data.requestId : snapshot.material.data.evaluationId
    return { id, evaluationId, schemaVersion: 1, updatedAt: completedAt.toISOString(), ...owners, ...snapshot, ...snapshot.material } as never
  })
  let persistedRun: { id: string; completedAt: Date | null; status: string; output: unknown; errorMessage?: string } | null = null
  const em = { fork: jest.fn(), transactional: jest.fn() }
  em.fork.mockReturnValue(em)
  em.transactional.mockImplementation((action: (manager: typeof em) => Promise<void>) => action(em))
  const run = jest.fn().mockImplementation(async () => { persistedRun = { id: randomUUID(), completedAt, status: 'ok', output: outcome }; return outcome })
  const execute = jest.fn().mockImplementation(async (_command: string, options: { input: unknown }) => ({ result: { id: save(options.input) } }))
  const sendSignal = jest.fn()
  const userHasAllFeatures = jest.fn().mockResolvedValue(true)
  const encryptEntityPayload = jest.fn().mockImplementation(async (_entity: string, payload: Record<string, unknown>) => Object.fromEntries(Object.keys(payload).map((key) => [key, 'sealed'])))
  const container = createContainer()
  container.register({ em: asValue(em), commandBus: asValue({ execute }), rbacService: asValue({ userHasAllFeatures }), tenantEncryptionService: asValue({ isEnabled: () => true, encryptEntityPayload }), agentRuntime: asValue({ run }), workflowExecutor: asValue({ executeWorkflow: jest.fn() }), signalHandler: asValue({ sendSignal }) })
  jest.mocked(findOneWithDecryption).mockImplementation(async (_manager, entity, query) => {
    if (entity === WorkflowInstance) return instance as never
    if (entity === AgentRun) return ((query as { id?: string }).id === o1Run.id ? o1Run : persistedRun) as never
    if (entity === PhotographerEvaluationMaterial) return ([...rows.values()].find((row) => row.operationId === (query as { operationId?: string }).operationId) ?? null) as never
    return null
  })
  jest.mocked(findWithDecryption).mockImplementation(async (_manager, entity) => entity === StepInstance ? [Object.assign(new StepInstance(), { id: randomUUID() })] as never : [])
  const job = { ...scope, workflowInstanceId: instance.id, stepId: 'o2', userId: prepared.userId, o1RunId: o1Run.id, tracesRef }
  const ctx = { container, auth: { sub: prepared.userId, tenantId: scope.tenantId, orgId: scope.organizationId } }
  return { job, ctx, container, run, execute, outcome, rows, prepared, instance, sendSignal, userHasAllFeatures, encryptEntityPayload, setRun: (value: typeof persistedRun) => { persistedRun = value } }
}

beforeEach(() => jest.clearAllMocks())

test('persists partial tool results losslessly and replays delivery without another paid invocation', async () => {
  const setup = fixture()
  const receipt = await processApifyResearchJob(setup.job, setup.container)
  expect(receipt?.status).toBe('partial')
  const stored = await readApifyResearchResult(receipt!.researchRef, setup.ctx)
  expect(stored.payload?.outcome).toEqual(setup.outcome)
  expect(stored.payload?.o1).toEqual({ kind: 'research', data: sample })
  expect(setup.run).toHaveBeenCalledWith(APIFY_RESEARCH_AGENT_ID, { o1: sample }, expect.objectContaining({ userId: setup.job.userId }))
  expect(await processApifyResearchJob(setup.job, setup.container)).toEqual(receipt)
  expect(setup.run).toHaveBeenCalledTimes(1)
})

test.each(['not_configured', 'budget_exceeded'])('preserves %s diagnostics inside the original outcome', async (diagnostic) => {
  const setup = fixture(diagnostic)
  const receipt = await processApifyResearchJob(setup.job, setup.container)
  const result = await readApifyResearchResult(receipt!.researchRef, setup.ctx)
  expect(result.payload?.outcome).toEqual(setup.outcome)
  expect(receipt?.status).toBe('error')
})

test('recovers a completed run after material saving fails without rerunning the agent', async () => {
  const setup = fixture()
  const save = setup.execute.getMockImplementation()!
  let fail = true
  setup.execute.mockImplementation(async (...args: unknown[]) => {
    const options = args[1] as { input: { snapshot: { material: { kind: string } } } }
    if (fail && options.input.snapshot.material.kind === 'apify_research_part') { fail = false; throw new Error('Controlled storage failure') }
    return save(...args)
  })
  await expect(processApifyResearchJob(setup.job, setup.container)).rejects.toThrow('Controlled storage failure')
  const receipt = await processApifyResearchJob(setup.job, setup.container)
  expect(receipt?.status).toBe('partial')
  expect(setup.run).toHaveBeenCalledTimes(1)
})

test('never reruns a claimed invocation without a persisted terminal run', async () => {
  const setup = fixture()
  setup.run.mockResolvedValue(undefined)
  await expect(processApifyResearchJob(setup.job, setup.container)).rejects.toThrow('pending')
  await expect(processApifyResearchJob(setup.job, setup.container)).rejects.toThrow('pending')
  expect(setup.run).toHaveBeenCalledTimes(1)
  expect(setup.sendSignal).not.toHaveBeenCalled()
})

test('round trips a multi-part payload without truncating provider resultJson', async () => {
  const setup = fixture(null, 'żółw 😀 '.repeat(10000))
  const receipt = await processApifyResearchJob(setup.job, setup.container)
  const stored = await readApifyResearchResult(receipt!.researchRef, setup.ctx)
  expect(stored.data.payloadRefs.length).toBeGreaterThan(2)
  expect(stored.payload?.outcome).toEqual(setup.outcome)
})

test('rejects unauthorized delivery before execution', async () => {
  const setup = fixture()
  setup.userHasAllFeatures.mockResolvedValue(false)
  await expect(processApifyResearchJob(setup.job, setup.container)).rejects.toThrow('access denied')
  expect(setup.run).not.toHaveBeenCalled()
  expect(setup.execute).not.toHaveBeenCalled()
})

test('rejects changed evaluation ownership', async () => {
  const setup = fixture()
  setup.prepared.photographerId = randomUUID()
  await expect(processApifyResearchJob(setup.job, setup.container)).rejects.toThrow('binding mismatch')
  expect(setup.run).not.toHaveBeenCalled()
})

test('requires encryption before claiming or invoking', async () => {
  const setup = fixture()
  setup.encryptEntityPayload.mockImplementation(async (_entity: string, payload: Record<string, unknown>) => payload)
  await expect(processApifyResearchJob(setup.job, setup.container)).rejects.toThrow('encryption unavailable')
  expect(setup.run).not.toHaveBeenCalled()
})


test('dispatches references to the dedicated wait step, not the transition source step', async () => {
  const setup = fixture()
  const enqueue = jest.fn()
  const close = jest.fn()
  jest.mocked(createModuleQueue).mockReturnValue({ enqueue, close } as never)
  await dispatchApifyResearchWorkflow({ o1RunId: setup.job.o1RunId, tracesRef: setup.job.tracesRef }, {
    workflowInstance: setup.instance, workflowContext: setup.instance.context, userId: setup.job.userId,
  }, setup.container)
  expect(enqueue).toHaveBeenCalledWith({ ...setup.job, stepId: APIFY_RESEARCH_STEP_ID }, { delayMs: 500 })
  expect(close).toHaveBeenCalledTimes(1)
})

test('persists a sanitized runtime failure with no run row and never retries it', async () => {
  const setup = fixture()
  setup.run.mockRejectedValue(new Error('Private upstream failure content'))
  const receipt = await processApifyResearchJob(setup.job, setup.container)
  expect(receipt).toEqual({ researchRef: expect.any(String), runId: null, status: 'error' })
  const stored = await readApifyResearchResult(receipt!.researchRef, setup.ctx)
  expect(stored.payload?.outcome).toBeNull()
  expect(stored.payload?.error).not.toContain('Private upstream failure content')
  expect(await processApifyResearchJob(setup.job, setup.container)).toEqual(receipt)
  expect(setup.run).toHaveBeenCalledTimes(1)
})

test('retains terminal runtime errors and tool artifact references without inventing an outcome', async () => {
  const setup = fixture()
  const callId = randomUUID()
  const artifactKey = 'controlled-artifact-reference'
  jest.mocked(findWithDecryption).mockImplementation(async (_manager, entity) => entity === StepInstance
    ? [Object.assign(new StepInstance(), { id: randomUUID() })] as never
    : [{ id: callId, toolName: 'integration_apify.scrape_instagram_profile', status: 'error', createdAt: new Date('2026-09-20T10:00:00Z'),
      requestSummary: { url: 'https://www.instagram.com/margografia' }, responseSummary: { unavailableFields: ['posts'] }, responseArtifactKey: artifactKey,
      errorMessage: 'Controlled provider error' }] as never)
  setup.run.mockImplementation(async () => {
    setup.setRun({ id: randomUUID(), completedAt: new Date(), status: 'error', output: { invalid: true }, errorMessage: 'Controlled runtime failure' })
    throw new Error('Controlled runtime failure')
  })
  const receipt = await processApifyResearchJob(setup.job, setup.container)
  const stored = await readApifyResearchResult(receipt!.researchRef, setup.ctx)
  expect(stored.payload?.outcome).toBeNull()
  expect(stored.payload?.rawOutput).toEqual({ invalid: true })
  expect(stored.payload?.toolCalls).toEqual([expect.objectContaining({ id: callId, responseArtifactKey: artifactKey, responseSummary: { unavailableFields: ['posts'] } })])
  expect(stored.data.runStatus).toBe('error')
  expect(await processApifyResearchJob(setup.job, setup.container)).toEqual(receipt)
  expect(setup.run).toHaveBeenCalledTimes(1)
})


test('recovers immutable chunks when late trace ingestion changes the payload after a partial save', async () => {
  const setup = fixture()
  const callId = randomUUID()
  let responseSummary = { biography: 'initial-trace '.repeat(4000) }
  jest.mocked(findWithDecryption).mockImplementation(async (_manager, entity) => entity === StepInstance
    ? [Object.assign(new StepInstance(), { id: randomUUID() })] as never
    : [{ id: callId, toolName: 'integration_apify.scrape_instagram_profile', status: 'ok',
      createdAt: new Date('2026-09-20T10:00:00Z'), responseSummary }] as never)
  const save = setup.execute.getMockImplementation()!
  let fail = true
  setup.execute.mockImplementation(async (...args: unknown[]) => {
    const options = args[1] as { input: { snapshot: { material: { kind: string; data: { index?: number } } } } }
    const material = options.input.snapshot.material
    if (fail && material.kind === 'apify_research_part' && material.data.index === 1) {
      fail = false
      throw new Error('Controlled second chunk failure')
    }
    return save(...args)
  })
  await expect(processApifyResearchJob(setup.job, setup.container)).rejects.toThrow('Controlled second chunk failure')
  const firstParts = [...setup.rows.values()].filter((row) => storedMaterialSchema.parse(decodeMaterialSnapshot(row)).material.kind === 'apify_research_part')
  expect(firstParts).toHaveLength(1)
  const firstBody = firstParts[0].body
  responseSummary = { biography: 'late-trace '.repeat(4000) }
  const receipt = await processApifyResearchJob(setup.job, setup.container)
  const stored = await readApifyResearchResult(receipt!.researchRef, setup.ctx)
  expect(stored.payload?.toolCalls).toEqual([expect.objectContaining({ id: callId, responseSummary })])
  expect(stored.data.payloadRefs).not.toContain(firstParts[0].id)
  expect(setup.rows.get(firstParts[0].id)?.body).toBe(firstBody)
  expect(setup.run).toHaveBeenCalledTimes(1)
})
