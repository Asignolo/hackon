import { asValue, createContainer } from 'awilix'
import type { CommandRuntimeContext } from '@open-mercato/shared/lib/commands'
import { findOneWithDecryption } from '@open-mercato/shared/lib/encryption/find'
import { hasAllFeatures } from '@open-mercato/shared/security/features'
import { readEvaluationMaterial } from '../lib/material-store'
import { readProposalReviewMaterials, recordProposalReviewAccess, proposalReviewAccessInterceptor } from '../lib/proposal-review-access'
import type { MessageReviewEnvelope } from '../data/proposal-review-validators'
import { loadReviewProposal } from '../lib/proposal-review-materials'

jest.mock('@open-mercato/shared/lib/i18n/server', () => ({ resolveTranslations: async () => ({ translate: (key: string) => key }) }))
jest.mock('@open-mercato/shared/lib/encryption/find', () => ({ findOneWithDecryption: jest.fn() }))
jest.mock('@open-mercato/enterprise/modules/agent_orchestrator/data/entities', () => ({ AgentProposal: class AgentProposal {} }))
jest.mock('@open-mercato/core/modules/customers/data/entities', () => ({ CustomerEntity: class CustomerEntity {}, CustomerDeal: class CustomerDeal {} }))
jest.mock('../lib/material-store', () => ({ readEvaluationMaterial: jest.fn() }))

const uuid = (number: number) => `${String(number).padStart(8, '0')}-1111-4111-8111-111111111111`
const tenantId = uuid(1), organizationId = uuid(2), userId = uuid(3), proposalId = uuid(4)
const photographerId = uuid(5), personId = uuid(6), dealId = uuid(7), evaluationId = uuid(8), factsRef = uuid(9)
const timestamp = '2026-09-19T12:00:00.000Z'
const now = Date.parse(timestamp)

test('proposal lookup projects tenant scope from a richer decision input', async () => {
  const ctx = context()
  await expect(loadReviewProposal(proposalId, input(), ctx)).resolves.toMatchObject({ id: proposalId })
  expect(findOneWithDecryption).toHaveBeenCalledWith(expect.anything(), expect.anything(), {
    id: proposalId, tenantId, organizationId, deletedAt: null, source: 'runtime',
  }, {}, { tenantId, organizationId })
})
const expectedVersions = { personUpdatedAt: timestamp, dealUpdatedAt: timestamp, factsRef }
const originalPayload = (): MessageReviewEnvelope => ({ options: ['first', 'second'].map((id, index) => ({
  id, label: `Option ${index + 1}`, actions: [{ type: 'photographers.message.accept', payload: {
    evaluationId, photographerId, personId, dealId, factsRef, messageSnapshotId: uuid(10 + index), expectedVersions,
  } }],
})) })
let proposal: { id: string; agentId: string; payload: unknown; updatedAt: Date; disposition: string } = { id: proposalId, agentId: 'photographers.message_review', payload: originalPayload(), updatedAt: new Date(timestamp), disposition: 'pending' }
type Entry = { tenantId: string; organizationId: string; actorUserId: string; resourceId: string; resourceKind: string; accessType: string; contextJson: unknown; createdAt: Date; deletedAt: Date | null }
let entries: Entry[] = []
let grants: string[] = []
const log = jest.fn()
const list = jest.fn()
let currentVersion = timestamp
function context(): CommandRuntimeContext {
  const container = createContainer()
  container.register({
    em: asValue({ fork: () => ({}) }), accessLogService: asValue({ log, list }),
    rbacService: asValue({ userHasAllFeatures: async (_actor: string, required: string[]) => hasAllFeatures(grants, required) }),
  })
  return { container, auth: { sub: userId, tenantId, orgId: organizationId }, selectedOrganizationId: organizationId, organizationScope: null, organizationIds: [organizationId] }
}
function input(disposition: 'approved' | 'edited' | 'rejected' | 'auto_approved' = 'approved') {
  return { proposalId, tenantId, organizationId, userId, disposition, selectedOptionId: 'first' }
}
function dispose(value: unknown = input(), ctx = context()) {
  return proposalReviewAccessInterceptor.beforeExecute!(value, { commandId: 'agent_orchestrator.proposals.dispose', container: ctx.container, auth: ctx.auth, selectedOrganizationId: ctx.selectedOrganizationId })
}
function material(id: string) {
  const common = { id, evaluationId, schemaVersion: 1 as const, updatedAt: timestamp, photographerId, personId, dealId }
  return id === factsRef
    ? { ...common, kind: 'facts' as const, data: { schemaVersion: 1 as const, evaluationId, evaluatedAt: timestamp, facts: [], tracesRef: uuid(12) } }
    : { ...common, kind: 'message' as const, data: { schemaVersion: 1 as const, evaluationId, recipientSource: 'registration' as const, body: 'Complete synthetic message', allowedEvidenceRefs: [], internalRationale: 'Synthetic reasoning', createdAt: timestamp, factsRef } }
}

beforeEach(() => {
  jest.clearAllMocks()
  jest.spyOn(Date, 'now').mockReturnValue(now)
  entries = []
  grants = ['photographers.*', 'customers.*', 'agent_orchestrator.*']
  currentVersion = timestamp
  proposal = { id: proposalId, agentId: 'photographers.message_review', payload: originalPayload(), updatedAt: new Date(timestamp), disposition: 'pending' }
  jest.mocked(findOneWithDecryption).mockImplementation(async (_em, entity, where) => {
    const scope = where as { tenantId: string; organizationId: string }
    if (scope.tenantId !== tenantId || scope.organizationId !== organizationId) return null
    return (entity.name === 'AgentProposal' ? proposal : { updatedAt: new Date(currentVersion) }) as never
  })
  jest.mocked(readEvaluationMaterial).mockImplementation(async (id) => material(id) as never)
  log.mockImplementation(async (value: Omit<Entry, 'contextJson' | 'createdAt' | 'deletedAt'> & { context: unknown }) => {
    entries.push({ ...value, contextJson: value.context, createdAt: new Date(now), deletedAt: null })
    return { id: uuid(99) }
  })
  list.mockImplementation(async () => ({ items: entries }))
})
afterEach(() => jest.restoreAllMocks())

test('full material access permits ordinary approval, with no reason or payload changes', async () => {
  const response = await readProposalReviewMaterials(proposalId, context())
  expect(response.options.map((option) => option.selectedOptionId)).toEqual(['first', 'second'])
  expect(response.options[0].materials[1]).toMatchObject({ kind: 'message', data: { body: 'Complete synthetic message' } })
  expect(log).toHaveBeenCalledTimes(1)
  expect(JSON.stringify(entries)).not.toContain('Complete synthetic message')
  expect(JSON.stringify(entries)).not.toContain('Synthetic reasoning')
  await expect(dispose()).resolves.toBeUndefined()
  await expect(dispose({ ...input(), selectedOptionId: 'second' })).resolves.toBeUndefined()
})

test('missing review blocks native direct and bulk approval while reject remains available', async () => {
  await expect(dispose()).rejects.toMatchObject({ status: 409 })
  await expect(dispose({ ...input(), selectedOptionId: 'second' })).rejects.toMatchObject({ status: 409 })
  await expect(dispose(input('rejected'))).resolves.toBeUndefined()
})

test('automatic message approval cannot use a human receipt; ordinary agents retain behavior', async () => {
  await readProposalReviewMaterials(proposalId, context())
  await expect(dispose(input('auto_approved'))).rejects.toMatchObject({ status: 403 })
  await expect(dispose({ ...input('auto_approved'), userId: null }, { ...context(), auth: null })).rejects.toMatchObject({ status: 403 })
  proposal.agentId = 'photographers.score'
  await expect(dispose({ ...input('auto_approved'), userId: null }, { ...context(), auth: null })).resolves.toBeUndefined()
  expect((await readProposalReviewMaterials(proposalId, context())).options).toEqual([])
})

test.each(['photographers.identity_review'])('unimplemented manual agent %s fails closed but permits reject', async (agentId) => {
  proposal.agentId = agentId
  await expect(dispose()).rejects.toMatchObject({ status: 409 })
  await expect(dispose(input('rejected'))).resolves.toBeUndefined()
})

test.each(['approved', 'edited', 'rejected', 'auto_approved'] as const)('evaluation preview blocks %s without recording a decision', async (disposition) => {
  proposal.agentId = 'photographers.evaluation_review'
  await expect(dispose(input(disposition))).rejects.toMatchObject({ status: 409, body: { error: 'photographers.errors.evaluation_decision_unavailable' } })
  expect(log).not.toHaveBeenCalled()
})

test('evaluation preview returns validated facts and score without a message approval receipt', async () => {
  proposal.agentId = 'photographers.evaluation_review'
  const payload = { evaluationId, registrationId: uuid(40), photographerId, personId, dealId, factsRef, scoreRef: uuid(41) }
  proposal.payload = { options: [{ id: 'review', label: 'Review', actions: [{ type: 'photographers.evaluation.review', risk: 'high', payload }] }] }
  jest.mocked(readEvaluationMaterial).mockImplementation(async (id) => {
    if (id === factsRef) return { ...material(id), registrationId: payload.registrationId } as never
    return { ...material(id), registrationId: payload.registrationId, kind: 'score', data: { schemaVersion: 1, evaluationId, factsRef, evaluatedAt: timestamp, rulesVersion: 'v1', score: 0, matchedRules: [], flags: ['business_suspended'], category: 'unknown', suggestedAction: 'review', unknownFactKeys: [] } } as never
  })
  const response = await readProposalReviewMaterials(proposalId, context())
  expect(response.options[0].materials.map((item) => item.kind)).toEqual(['facts', 'score'])
  expect(log).not.toHaveBeenCalled()
  await expect(recordProposalReviewAccess(proposalId, context(), { payload: originalPayload(), selectedOptionId: 'review' })).rejects.toMatchObject({ status: 409 })
})

test('unrelated proposals preserve existing all-organizations direct command behavior', async () => {
  proposal.agentId = 'unrelated.review'
  const ctx = context()
  ctx.selectedOrganizationId = uuid(50)
  await expect(dispose(input(), ctx)).resolves.toBeUndefined()
  expect(log).not.toHaveBeenCalled()
})

test.each(['actor', 'organization', 'tenant', 'option', 'version', 'expired', 'deleted'])('access evidence must match exact %s', async (change) => {
  await readProposalReviewMaterials(proposalId, context())
  const entry = entries[0]
  if (change === 'actor') entry.actorUserId = uuid(50)
  if (change === 'organization') entry.organizationId = uuid(50)
  if (change === 'tenant') entry.tenantId = uuid(50)
  if (change === 'option') entry.contextJson = { ...(entry.contextJson as object), options: [] }
  if (change === 'version') proposal.updatedAt = new Date(now + 1)
  if (change === 'expired') entry.createdAt = new Date(now - 300001)
  if (change === 'deleted') entry.deletedAt = new Date(now)
  await expect(dispose()).rejects.toMatchObject({ status: 409 })
})

test('changed message bytes invalidate prior receipt even with identical material ID and version', async () => {
  await readProposalReviewMaterials(proposalId, context())
  jest.mocked(readEvaluationMaterial).mockImplementation(async (id) => {
    const value = material(id)
    if (value.kind === 'message') value.data.body = 'Changed synthetic content'
    return value as never
  })
  await expect(dispose()).rejects.toMatchObject({ status: 409 })
})

test('edited payload requires exact revision receipt and cannot change untouched options or owner', async () => {
  await readProposalReviewMaterials(proposalId, context())
  const edited = originalPayload()
  edited.options[0].actions[0].payload.messageSnapshotId = uuid(40)
  await expect(dispose({ ...input('edited'), payload: edited })).rejects.toMatchObject({ status: 409 })
  await recordProposalReviewAccess(proposalId, context(), { payload: edited, selectedOptionId: 'first' })
  await expect(dispose({ ...input('edited'), payload: edited })).resolves.toBeUndefined()
  edited.options[1].label = 'Unexpected change'
  await expect(dispose({ ...input('edited'), payload: edited })).rejects.toMatchObject({ status: 409 })
  edited.options[1].label = 'Option 2'
  edited.options[0].actions[0].payload.photographerId = uuid(50)
  await expect(dispose({ ...input('edited'), payload: edited })).rejects.toMatchObject({ status: 409 })
})

test('all material reads must succeed before any receipt is written', async () => {
  jest.mocked(readEvaluationMaterial).mockImplementation(async (id) => {
    if (id === uuid(11)) throw new Error('[internal] Missing fragment')
    return material(id) as never
  })
  await expect(readProposalReviewMaterials(proposalId, context())).rejects.toThrow('Missing fragment')
  expect(log).not.toHaveBeenCalled()
})

test('unavailable audit service fails closed after authorized complete reads', async () => {
  const ctx = context()
  ctx.container.register({ accessLogService: asValue(null) })
  await expect(readProposalReviewMaterials(proposalId, ctx)).rejects.toMatchObject({ status: 503 })
})

test('scope, ACL, current entity version, material owner, and missing audit service fail closed', async () => {
  grants = []
  await expect(readProposalReviewMaterials(proposalId, context())).rejects.toMatchObject({ status: 403 })
  grants = ['*']
  currentVersion = new Date(now + 1).toISOString()
  await expect(readProposalReviewMaterials(proposalId, context())).rejects.toMatchObject({ status: 409 })
  currentVersion = timestamp
  jest.mocked(readEvaluationMaterial).mockImplementation(async (id) => ({ ...material(id), photographerId: uuid(50) }) as never)
  await expect(readProposalReviewMaterials(proposalId, context())).rejects.toMatchObject({ status: 409 })
  jest.mocked(readEvaluationMaterial).mockImplementation(async (id) => material(id) as never)
  log.mockResolvedValue(null)
  await expect(readProposalReviewMaterials(proposalId, context())).rejects.toMatchObject({ status: 503 })
  await expect(dispose({ ...input(), tenantId: uuid(50) })).rejects.toMatchObject({ status: 404 })
  await expect(dispose({ ...input(), userId: uuid(50) })).rejects.toMatchObject({ status: 403 })
})


test.each(['approved', 'edited', 'rejected'])('historical %s material survives CRM version changes without a new receipt', async (disposition) => {
  proposal.disposition = disposition
  currentVersion = new Date(now + 1000).toISOString()
  const response = await readProposalReviewMaterials(proposalId, context())
  expect(response.options[0].materials[1]).toMatchObject({ kind: 'message', data: { body: 'Complete synthetic message' } })
  expect(log).not.toHaveBeenCalled()
  await expect(recordProposalReviewAccess(proposalId, context(), { payload: originalPayload(), selectedOptionId: 'first' })).rejects.toMatchObject({ status: 409 })
})

test('historical material still rejects missing current owners, foreign material identity and denied ACL', async () => {
  proposal.disposition = 'approved'
  currentVersion = new Date(now + 1000).toISOString()
  jest.mocked(findOneWithDecryption).mockImplementation(async (_em, entity) => (entity.name === 'AgentProposal' ? proposal : null) as never)
  await expect(readProposalReviewMaterials(proposalId, context())).rejects.toMatchObject({ status: 404 })
  jest.mocked(findOneWithDecryption).mockImplementation(async (_em, entity) => (entity.name === 'AgentProposal' ? proposal : { updatedAt: new Date(currentVersion) }) as never)
  jest.mocked(readEvaluationMaterial).mockImplementation(async (id) => ({ ...material(id), photographerId: uuid(50) }) as never)
  await expect(readProposalReviewMaterials(proposalId, context())).rejects.toMatchObject({ status: 409 })
  grants = []
  await expect(readProposalReviewMaterials(proposalId, context())).rejects.toMatchObject({ status: 403 })
  expect(log).not.toHaveBeenCalled()
})

test('pending preview and approval both retain strict predecision versions', async () => {
  await readProposalReviewMaterials(proposalId, context())
  log.mockClear()
  currentVersion = new Date(now + 1000).toISOString()
  await expect(readProposalReviewMaterials(proposalId, context())).rejects.toMatchObject({ status: 409 })
  await expect(dispose()).rejects.toMatchObject({ status: 409 })
  expect(log).not.toHaveBeenCalled()
})
