import { randomUUID } from 'node:crypto'
import { asValue, createContainer } from 'awilix'
import { findOneWithDecryption, findWithDecryption } from '@open-mercato/shared/lib/encryption/find'
import { WorkflowInstance } from '@open-mercato/core/modules/workflows/data/entities'
import { AgentProposal, AgentRun } from '@open-mercato/enterprise/modules/agent_orchestrator/data/entities'
import { ActionLog } from '@open-mercato/core/modules/audit_logs/data/entities'
import { readDemoRevocationHistory } from '../lib/demo-workflow-history'
import { reviewDigest } from '../lib/proposal-review-materials'

jest.mock('@open-mercato/shared/lib/encryption/find', () => ({ findOneWithDecryption: jest.fn(), findWithDecryption: jest.fn() }))
jest.mock('@open-mercato/shared/lib/i18n/server', () => ({ resolveTranslations: async () => ({ translate: (key: string) => key }) }))

function fixture(phase?: 'revoke_stage' | 'revoke_interaction') {
  const scope = { tenantId: randomUUID(), organizationId: randomUUID() }
  const viewerId = randomUUID()
  const proposal = { id: randomUUID(), workflowInstanceId: randomUUID(), runId: randomUUID(), agentId: 'photographers.message_review', stepId: 'wait_review', disposition: 'approved', dispositionBy: randomUUID(), selectedOptionId: 'accept', payload: {}, updatedAt: new Date() }
  const digest = reviewDigest({ payload: proposal.payload, disposition: proposal.disposition, selectedOptionId: proposal.selectedOptionId, updatedAt: proposal.updatedAt.toISOString() })
  const checkpoint = { proposalId: proposal.id, disposition: 'approved', digest, interactionId: randomUUID(), personUpdatedAt: new Date().toISOString(), dealUpdatedAt: new Date().toISOString(), interactionUpdatedAt: new Date().toISOString(), beforeStageId: randomUUID(), pipelineId: randomUUID() }
  const log = { contextJson: { phase }, snapshotAfter: checkpoint, actorUserId: proposal.dispositionBy }
  const em = { fork: jest.fn() }
  em.fork.mockReturnValue(em)
  const userHasAllFeatures = jest.fn(async (userId: string) => userId === viewerId)
  const container = createContainer()
  container.register({ em: asValue(em), rbacService: asValue({ userHasAllFeatures }) })
  jest.mocked(findOneWithDecryption).mockImplementation(async (_em, entity) => (entity === AgentProposal ? proposal : entity === WorkflowInstance ? { id: proposal.workflowInstanceId } : entity === AgentRun ? { id: proposal.runId, invocationId: randomUUID() } : null) as never)
  jest.mocked(findWithDecryption).mockResolvedValue((phase ? [log] : []) as never)
  const ctx = { container, auth: { sub: viewerId, tenantId: scope.tenantId, orgId: scope.organizationId }, selectedOrganizationId: scope.organizationId, organizationIds: [scope.organizationId], organizationScope: null }
  return { scope, proposal, log, userHasAllFeatures, ctx }
}

beforeEach(() => jest.clearAllMocks())

test.each([
  { phase: undefined, expected: 'none' },
  { phase: 'revoke_stage' as const, expected: 'partial' },
  { phase: 'revoke_interaction' as const, expected: 'revoked' },
])('reads $expected history with current viewer permissions and no CRM version query', async ({ phase, expected }) => {
  const setup = fixture(phase)
  await expect(readDemoRevocationHistory({ ...setup.scope, proposalId: setup.proposal.id }, setup.ctx)).resolves.toBe(expected)
  expect(setup.userHasAllFeatures).toHaveBeenCalledTimes(1)
  expect(setup.userHasAllFeatures).toHaveBeenCalledWith(setup.ctx.auth.sub, ['photographers.evaluations.view', 'agent_orchestrator.proposals.view', 'workflows.instances.view'], setup.scope)
  expect(jest.mocked(findOneWithDecryption).mock.calls.every((call) => [AgentProposal, AgentRun, WorkflowInstance].includes(call[1] as never))).toBe(true)
  expect(findWithDecryption).toHaveBeenCalledWith(expect.anything(), ActionLog, expect.objectContaining({ ...setup.scope, resourceId: setup.proposal.id, commandId: 'photographers.demo.message.phase', executionState: 'done' }), expect.anything(), setup.scope)
})

test('a foreign actor or changed proposal digest cannot forge revocation history', async () => {
  const setup = fixture('revoke_interaction')
  setup.log.actorUserId = randomUUID()
  await expect(readDemoRevocationHistory({ ...setup.scope, proposalId: setup.proposal.id }, setup.ctx)).rejects.toThrow('material_conflict')
  setup.log.actorUserId = setup.proposal.dispositionBy
  setup.log.snapshotAfter.digest = '0'.repeat(64)
  await expect(readDemoRevocationHistory({ ...setup.scope, proposalId: setup.proposal.id }, setup.ctx)).rejects.toThrow('material_conflict')
})

test('cross-scope and missing run correlation fail before journal access', async () => {
  const setup = fixture('revoke_interaction')
  await expect(readDemoRevocationHistory({ ...setup.scope, organizationId: randomUUID(), proposalId: setup.proposal.id }, setup.ctx)).rejects.toThrow('forbidden')
  jest.mocked(findOneWithDecryption).mockImplementation(async (_em, entity) => (entity === AgentProposal ? setup.proposal : entity === WorkflowInstance ? { id: setup.proposal.workflowInstanceId } : null) as never)
  await expect(readDemoRevocationHistory({ ...setup.scope, proposalId: setup.proposal.id }, setup.ctx)).rejects.toThrow('material_conflict')
  expect(findWithDecryption).not.toHaveBeenCalled()
})
