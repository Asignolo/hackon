import { asValue, createContainer } from 'awilix'
import type { CommandInterceptorContext } from '@open-mercato/shared/lib/commands/command-interceptor'
import { findOneWithDecryption } from '@open-mercato/shared/lib/encryption/find'
import { loadReviewProposal, authorizeProposalReview } from '../lib/proposal-review-materials'
import { getDemoReviewBinding } from '../lib/demo-workflow-runtime'
import { authorizeDemoCommand } from '../lib/demo-proposal-support'
import { demoProposalDispositionInterceptor } from '../lib/demo-proposal-interceptor'

jest.mock('@open-mercato/shared/lib/encryption/find', () => ({ findOneWithDecryption: jest.fn() }))
jest.mock('@open-mercato/core/modules/workflows/data/entities', () => ({ WorkflowInstance: class WorkflowInstance {} }))
jest.mock('@open-mercato/enterprise/modules/agent_orchestrator/data/entities', () => ({ AgentRun: class AgentRun {} }))
jest.mock('../lib/demo-workflow-runtime', () => ({ getDemoReviewBinding: jest.fn() }))
jest.mock('../lib/demo-proposal-support', () => ({ demoCommandContext: (input: unknown, container: unknown) => ({ input, container }), authorizeDemoCommand: jest.fn() }))
jest.mock('../lib/proposal-review-materials', () => ({
  loadReviewProposal: jest.fn(), authorizeProposalReview: jest.fn(),
  reviewError: async (status: number) => { throw Object.assign(new Error('Blocked'), { status }) },
}))

const uuid = (number: number) => `${String(number).padStart(8, '0')}-1111-4111-8111-111111111111`
const tenantId = uuid(1), organizationId = uuid(2), userId = uuid(3), proposalId = uuid(4), workflowInstanceId = uuid(5), invocationId = uuid(6)
const input = { tenantId, organizationId, userId, proposalId, disposition: 'approved' }
let proposal = { id: proposalId, agentId: 'photographers.message_review', workflowInstanceId, stepId: 'wait_review', runId: uuid(7), disposition: 'pending' }
const context = (): CommandInterceptorContext => {
  const container = createContainer()
  container.register({ em: asValue({ fork: () => ({}) }) })
  return { container, commandId: 'agent_orchestrator.proposals.dispose', auth: { sub: userId, tenantId, orgId: organizationId }, selectedOrganizationId: organizationId }
}
const dispose = (value: unknown = input, ctx = context()) => demoProposalDispositionInterceptor.beforeExecute!(value, ctx)

beforeEach(() => {
  jest.clearAllMocks()
  proposal = { id: proposalId, agentId: 'photographers.message_review', workflowInstanceId, stepId: 'wait_review', runId: uuid(7), disposition: 'pending' }
  jest.mocked(loadReviewProposal).mockImplementation(async () => proposal as never)
  jest.mocked(authorizeProposalReview).mockResolvedValue({ tenantId, organizationId })
  jest.mocked(authorizeDemoCommand).mockResolvedValue({ tenantId, organizationId })
  jest.mocked(getDemoReviewBinding).mockResolvedValue({ invocationId, stepId: 'wait_review' } as never)
  jest.mocked(findOneWithDecryption).mockImplementation(async (_manager, entity) => (entity.name === 'WorkflowInstance' ? { id: workflowInstanceId } : { id: proposal.runId }) as never)
})

test('unrelated agents and workflows keep their native resume behavior', async () => {
  proposal.agentId = 'unrelated.review'
  await expect(dispose()).resolves.toBeUndefined()
  expect(findOneWithDecryption).not.toHaveBeenCalled()
  proposal.agentId = 'photographers.message_review'
  jest.mocked(findOneWithDecryption).mockResolvedValue(null)
  await expect(dispose()).resolves.toBeUndefined()
  expect(getDemoReviewBinding).not.toHaveBeenCalled()
})

test.each(['approved', 'rejected'])('a valid %s decision waits for the application effect before resuming', async (disposition) => {
  await expect(dispose({ ...input, disposition })).resolves.toEqual({ modifiedInput: { skipResume: true } })
  expect(authorizeProposalReview).toHaveBeenCalledTimes(1)
})

test.each(['actor', 'tenant', 'organization', 'automatic'])('rejects %s substitution before accepting a demo decision', async (change) => {
  const ctx = context()
  const value = { ...input }
  if (change === 'actor') value.userId = uuid(8)
  if (change === 'tenant') ctx.auth!.tenantId = uuid(8)
  if (change === 'organization') ctx.selectedOrganizationId = uuid(8)
  if (change === 'automatic') value.disposition = 'auto_approved'
  await expect(dispose(value, ctx)).rejects.toMatchObject({ status: 403 })
  expect(getDemoReviewBinding).not.toHaveBeenCalled()
})

test('a rerun or a run from a different wait cannot accept the old proposal', async () => {
  jest.mocked(getDemoReviewBinding).mockRejectedValueOnce(Object.assign(new Error('Old wait'), { status: 409 }))
  await expect(dispose()).rejects.toMatchObject({ status: 409 })
  jest.mocked(findOneWithDecryption).mockImplementation(async (_manager, entity) => (entity.name === 'WorkflowInstance' ? { id: workflowInstanceId } : null) as never)
  await expect(dispose()).rejects.toMatchObject({ status: 409 })
})

test('a decision cannot be disposed a second time', async () => {
  proposal.disposition = 'approved'
  await expect(dispose()).rejects.toMatchObject({ status: 409 })
})


test('requires permission to write the result before persisting the decision', async () => {
  jest.mocked(authorizeDemoCommand).mockRejectedValueOnce(Object.assign(new Error('Forbidden'), { status: 403 }))
  await expect(dispose()).rejects.toMatchObject({ status: 403 })
  expect(getDemoReviewBinding).not.toHaveBeenCalled()
})
