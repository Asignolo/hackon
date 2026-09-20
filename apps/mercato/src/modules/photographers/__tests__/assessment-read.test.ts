import { asValue, createContainer } from 'awilix'
import { findOneWithDecryption, findWithDecryption } from '@open-mercato/shared/lib/encryption/find'
import { CrudHttpError } from '@open-mercato/shared/lib/crud/errors'
import { WorkflowInstance, StepInstance } from '@open-mercato/core/modules/workflows/data/entities'
import { readAssessment } from '../lib/assessment-read'
import { readRegistrationCrm } from '../lib/registration-crm'
import { readEvaluationMaterial } from '../lib/material-store'
import type { CommandRuntimeContext } from '@open-mercato/shared/lib/commands'

jest.mock('@open-mercato/shared/lib/i18n/server', () => ({ resolveTranslations: async () => ({ translate: (key: string) => key }) }))
jest.mock('@open-mercato/shared/lib/encryption/find', () => ({ findOneWithDecryption: jest.fn(), findWithDecryption: jest.fn() }))
jest.mock('@open-mercato/core/modules/workflows/data/entities', () => ({ WorkflowInstance: class WorkflowInstance {}, StepInstance: class StepInstance {} }))
jest.mock('../lib/registration-crm', () => ({ readRegistrationCrm: jest.fn() }))
jest.mock('../lib/material-store', () => ({ readEvaluationMaterial: jest.fn() }))
const evaluationId = '11111111-1111-4111-8111-111111111111'
const registrationId = '22222222-2222-4222-8222-222222222222'
const ownerId = '33333333-3333-4333-8333-333333333333'
const materialId = '44444444-4444-4444-8444-444444444444'
const workflowId = '55555555-5555-4555-8555-555555555555'
const timestamp = '2026-09-19T10:00:00.000Z'
const scope = { tenantId: evaluationId, organizationId: registrationId }
let allowed = true
let workflow: Record<string, unknown> | null
let researchExists = false
let traceExists = false
let factsExist = false
let scoreExists = false
let summaryExists = false
let duplicateWorkflow = false
let steps: Array<{ stepId: string; status: string }> = []
function context(): CommandRuntimeContext {
  const container = createContainer()
  container.register({ em: asValue({ fork: () => ({}) }), rbacService: asValue({ userHasAllFeatures: async () => allowed }) })
  return { container, auth: { sub: ownerId, tenantId: scope.tenantId, orgId: scope.organizationId }, selectedOrganizationId: scope.organizationId, organizationIds: [scope.organizationId], organizationScope: null }
}
beforeEach(() => {
  jest.clearAllMocks(); researchExists = false; allowed = true; workflow = null; traceExists = false; factsExist = false; scoreExists = false; summaryExists = false; duplicateWorkflow = false; steps = []
  jest.mocked(findOneWithDecryption).mockResolvedValue({ id: registrationId, firstName: 'Test', lastName: 'Person', email: 'test@example.test', portfolioRaw: 'https://example.test', submittedAt: new Date(timestamp), updatedAt: new Date(timestamp) } as never)
  jest.mocked(readRegistrationCrm).mockResolvedValue({ registrationId, status: 'ready', photographerId: ownerId, personId: ownerId, dealId: ownerId, links: { person: '/person', deal: '/deal' } })
  jest.mocked(findWithDecryption).mockImplementation(async (_em, entity, filter) => {
    expect(filter).toEqual(expect.objectContaining(scope))
    if (entity === WorkflowInstance) return (workflow ? duplicateWorkflow ? [workflow, workflow] : [workflow] : []) as never
    if (entity === StepInstance) { expect(filter).toEqual(expect.objectContaining({ workflowInstanceId: workflowId })); return steps as never }
    expect(filter).toEqual(expect.objectContaining({ evaluationId, registrationId }))
    if ((filter as Record<string, unknown>).kind === 'apify_research' && researchExists) return [{ id: workflowId }] as never
    if ((filter as Record<string, unknown>).kind === 'summary' && summaryExists) return [{ id: ownerId }] as never
    if ((filter as Record<string, unknown>).kind === 'facts' && factsExist) return [{ id: registrationId }] as never
    if ((filter as Record<string, unknown>).kind === 'score' && scoreExists) return [{ id: evaluationId }] as never
    return (traceExists && (filter as Record<string, unknown>).kind === 'traces' ? [{ id: materialId }] : []) as never
  })
  jest.mocked(readEvaluationMaterial).mockResolvedValue({ id: materialId, evaluationId, registrationId, photographerId: ownerId, personId: ownerId, dealId: ownerId, schemaVersion: 1, updatedAt: timestamp, kind: 'traces', data: { schemaVersion: 1, evaluationId, evaluatedAt: timestamp, traces: [], discoveryStatus: 'partial' } })
})
function boundWorkflow(status: string, source?: string) {
  return { id: workflowId, workflowId: 'photographers.hidden_potential', status, currentStepId: 'o1', context: { evaluationId, registrationId, source } }
}
test('linked CRM alone leaves assessment pending', async () => {
  const result = await readAssessment({ evaluationId, registrationId }, context())
  expect(result.process.status).toBe('pending'); expect(result.source).toBe('unknown')
  expect(result.materials.traces.status).toBe('missing')
})
test('reads partial saved results and preserves real workflow binding', async () => {
  workflow = boundWorkflow('PAUSED'); traceExists = true
  const result = await readAssessment({ evaluationId, registrationId }, context())
  expect(result.process.status).toBe('partial'); expect(result.source).toBe('real')
  expect(result.materials.traces.data?.discoveryStatus).toBe('partial')
  expect(result.research).toEqual({ status: 'unavailable', reason: 'not_saved' })
})
test.each(['COMPLETED', 'FAILED', 'CANCELLED'])('uses durable workflow %s status', async (status) => {
  workflow = boundWorkflow(status); traceExists = true
  const result = await readAssessment({ evaluationId, registrationId }, context())
  expect(result.process.status).toBe(status === 'COMPLETED' ? 'completed' : 'failed')
})
test('never returns demo fixture payloads', async () => {
  workflow = boundWorkflow('COMPLETED', 'demo_fixture'); traceExists = true
  const result = await readAssessment({ evaluationId, registrationId }, context())
  expect(result.source).toBe('demo_fixture'); expect(result.materials.traces.status).toBe('excluded')
  expect(readEvaluationMaterial).not.toHaveBeenCalled()
})
test('rejects missing permission before querying', async () => {
  allowed = false
  await expect(readAssessment({ evaluationId, registrationId }, context())).rejects.toMatchObject({ status: 403 })
  expect(findOneWithDecryption).not.toHaveBeenCalled()
})
test('rejects organization scope outside allowed set', async () => {
  const ctx = context(); ctx.organizationIds = []
  await expect(readAssessment({ evaluationId, registrationId }, ctx)).rejects.toMatchObject({ status: 403 })
})
test('corrupt latest material does not become success or fall back', async () => {
  traceExists = true
  jest.mocked(readEvaluationMaterial).mockRejectedValue(new CrudHttpError(409, { error: 'corrupt' }))
  const result = await readAssessment({ evaluationId, registrationId }, context())
  expect(result.materials.traces).toEqual({ status: 'invalid', id: materialId, data: null })
  expect(result.process.status).toBe('pending')
})
test('rejects a material rebound to another registration', async () => {
  traceExists = true
  const material = await readEvaluationMaterial(materialId, context())
  jest.mocked(readEvaluationMaterial).mockResolvedValue({ ...material, registrationId: ownerId })
  expect((await readAssessment({ evaluationId, registrationId }, context())).materials.traces.status).toBe('invalid')
})

test('uses actual latest step status when no summary exists', async () => {
  workflow = boundWorkflow('FAILED')
  steps = [{ stepId: 'o2', status: 'FAILED' }, { stepId: 'o1', status: 'COMPLETED' }]
  const result = await readAssessment({ evaluationId, registrationId }, context())
  expect(result.stages).toEqual([{ stepId: 'o1', status: 'done' }, { stepId: 'o2', status: 'unavailable' }])
  expect(result.process.errorCode).toBe('stage_failed')
})
test.each(['traces', 'facts'])('rejects inconsistent %s references and dependent score', async (mismatch) => {
  traceExists = true; factsExist = true; scoreExists = true
  const trace = await readEvaluationMaterial(materialId, context())
  jest.mocked(readEvaluationMaterial).mockImplementation(async (id) => {
    if (id === materialId) return trace
    const common = { ...trace, id }
    if (id === registrationId) return { ...common, kind: 'facts', data: { schemaVersion: 1, evaluationId, evaluatedAt: timestamp, tracesRef: mismatch === 'traces' ? ownerId : materialId, facts: [] } }
    return { ...common, kind: 'score', data: { schemaVersion: 1, evaluationId, evaluatedAt: timestamp, factsRef: mismatch === 'facts' ? ownerId : registrationId, rulesVersion: '1', score: 0, matchedRules: [], flags: [], category: 'unknown', suggestedAction: 'observe', unknownFactKeys: [] } }
  })
  const result = await readAssessment({ evaluationId, registrationId }, context())
  expect(result.materials.facts.status).toBe(mismatch === 'traces' ? 'invalid' : 'available')
  expect(result.materials.score.status).toBe('invalid')
  expect(result.materials.score.data).toBeNull()
})

test('available material cannot hide ambiguous workflow status', async () => {
  workflow = boundWorkflow('PAUSED'); duplicateWorkflow = true; traceExists = true
  const result = await readAssessment({ evaluationId, registrationId }, context())
  expect(result.process).toMatchObject({ status: 'unknown', errorCode: 'ambiguous_workflow', workflowInstanceId: null })
  expect(result.materials.traces.status).toBe('available')
})
test('actual failed attempt overrides stale completed summary step', async () => {
  workflow = boundWorkflow('FAILED'); summaryExists = true
  steps = [{ stepId: 'o2', status: 'FAILED' }]
  const trace = await readEvaluationMaterial(materialId, context())
  jest.mocked(readEvaluationMaterial).mockResolvedValue({ ...trace, id: ownerId, kind: 'summary', data: {
    schemaVersion: 1, photographerId: ownerId, personId: ownerId, dealId: ownerId, evaluationId,
    evaluatedAt: timestamp, rulesVersion: '1', instructionVersions: [], steps: [{ stepId: 'o2', status: 'done' }], changedFactKeys: [], decisions: [],
  } })
  const result = await readAssessment({ evaluationId, registrationId }, context())
  expect(result.materials.summary.status).toBe('available')
  expect(result.stages).toEqual([{ stepId: 'o2', status: 'unavailable' }])
})

function storedResearch(status: 'complete' | 'partial' | 'error', photographerId = ownerId) {
  researchExists = true
  const payload = { outcome: { kind: 'research', data: { schemaVersion: 1, status, summary: 'Saved external outcome', results: [{ tool: 'integration_apify.scrape_instagram_profile', url: 'https://instagram.com/photo', confidence: 'confirmed', approvalRequired: false, status, actorRunId: 'actor-run', observedAt: timestamp, resultJson: '{}', error: status === 'error' ? 'not_configured' : null }], skipped: [] } }, rawOutput: null, o1: null, error: null, toolCalls: [] }
  jest.mocked(readEvaluationMaterial).mockImplementation(async (id) => ({
    id, evaluationId, registrationId, photographerId, personId: ownerId, dealId: ownerId, schemaVersion: 1, updatedAt: timestamp,
    ...(id === workflowId ? { kind: 'apify_research' as const, data: { schemaVersion: 1 as const, evaluationId, evaluatedAt: timestamp, o1RunId: ownerId, tracesRef: materialId, workflowInstanceId: workflowId, stepId: 'apify_o2', invocationId: ownerId, userId: ownerId, state: 'finished' as const, runId: ownerId, runStatus: 'ok', outcomeStatus: status, payloadRefs: [materialId] } }
      : { kind: 'apify_research_part' as const, data: { schemaVersion: 1 as const, evaluationId, evaluatedAt: timestamp, invocationId: ownerId, index: 0, content: JSON.stringify(payload) } }),
  }))
}
test.each([['complete', 'completed'], ['partial', 'partial'], ['error', 'failed']] as const)('reads saved %s o2 manifest and payload parts', async (outcomeStatus, viewStatus) => {
  workflow = { ...boundWorkflow('PAUSED'), workflowId: 'photographers.demo-evaluation' }
  storedResearch(outcomeStatus)
  const result = await readAssessment({ evaluationId, registrationId }, context())
  expect(result.source).toBe('real')
  expect(result.research).toMatchObject({ status: viewStatus, summary: 'Saved external outcome', sources: [{ url: 'https://instagram.com/photo' }] })
  expect(readEvaluationMaterial).toHaveBeenCalledWith(workflowId, expect.anything())
  expect(readEvaluationMaterial).toHaveBeenCalledWith(materialId, expect.anything())
})
test('never exposes saved research for a different photographer', async () => {
  workflow = boundWorkflow('PAUSED')
  storedResearch('partial', registrationId)
  expect((await readAssessment({ evaluationId, registrationId }, context())).research).toEqual({ status: 'unavailable', reason: 'binding_mismatch' })
})

test('keeps original o1 sources separately from final scoring traces', async () => {
  workflow = { ...boundWorkflow('COMPLETED'), context: { evaluationId, registrationId, o1Result: { result: { tracesRef: materialId } }, demoScore: { result: { tracesRef: ownerId } } } }
  const result = await readAssessment({ evaluationId, registrationId }, context())
  expect(result.o1).toMatchObject({ status: 'available', id: materialId })
  expect(result.materials.traces.status).toBe('missing')
})
test('failed runtime cannot present a valid outcome as successful research', async () => {
  workflow = boundWorkflow('FAILED')
  storedResearch('complete')
  const read = jest.mocked(readEvaluationMaterial).getMockImplementation()!
  jest.mocked(readEvaluationMaterial).mockImplementation(async (id, ctx) => {
    const material = await read(id, ctx)
    return material.kind === 'apify_research' ? { ...material, data: { ...material.data, runStatus: 'error' } } : material
  })
  expect((await readAssessment({ evaluationId, registrationId }, context())).research.status).toBe('failed')
})
