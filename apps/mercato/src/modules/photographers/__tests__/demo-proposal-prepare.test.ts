import { asValue, createContainer } from 'awilix'
import type { CommandRuntimeContext } from '@open-mercato/shared/lib/commands'
import { findOneWithDecryption } from '@open-mercato/shared/lib/encryption/find'
import { authorizeDemoCommand, demoInstallation, loadDemoOwners, setDemoStage } from '../lib/demo-proposal-support'
import { getDemoReviewBinding } from '../lib/demo-workflow-runtime'
import { prepareDemoProposal } from '../lib/demo-proposal-prepare'

jest.mock('@open-mercato/shared/lib/encryption/find', () => ({ findOneWithDecryption: jest.fn() }))
jest.mock('@open-mercato/core/modules/audit_logs/data/entities', () => ({ ActionLog: class ActionLog {} }))
jest.mock('../lib/demo-proposal-support', () => ({ authorizeDemoCommand: jest.fn(), demoInstallation: jest.fn(), loadDemoOwners: jest.fn(), setDemoStage: jest.fn() }))
jest.mock('../lib/demo-workflow-runtime', () => ({ getDemoReviewBinding: jest.fn() }))
jest.mock('../lib/proposal-review-materials', () => ({ reviewDigest: (value: unknown) => JSON.stringify(value), reviewError: async (status: number) => { throw Object.assign(new Error('blocked'), { status }) } }))
const uuid = (number: number) => `${String(number).padStart(8, '0')}-1111-4111-8111-111111111111`
const initial = '2026-09-19T12:00:00.000Z', changed = '2026-09-19T12:01:00.000Z'
const prepared = { requestId: uuid(1), registrationId: uuid(2), photographerId: uuid(3), personId: uuid(4), dealId: uuid(5), evaluationId: uuid(6), evaluatedAt: initial, userId: uuid(7), source: 'demo_fixture' }
const input = { tenantId: uuid(8), organizationId: uuid(9), prepared, workflowInstanceId: uuid(10), stepId: 'wait_review', invocationId: uuid(11), research: { portfolio: { runId: uuid(12), materialId: uuid(13) }, social: { runId: uuid(14), materialId: uuid(15) } } }
const checkpoint = { invocationId: input.invocationId, personUpdatedAt: initial, dealUpdatedAt: initial }
function context(): CommandRuntimeContext {
  const container = createContainer(); container.register({ em: asValue({ fork: () => ({}) }) })
  return { container, auth: { sub: prepared.userId, tenantId: input.tenantId }, selectedOrganizationId: input.organizationId, organizationIds: [input.organizationId], organizationScope: null }
}
beforeEach(() => {
  jest.clearAllMocks()
  jest.mocked(authorizeDemoCommand).mockResolvedValue({ tenantId: input.tenantId, organizationId: input.organizationId })
  jest.mocked(getDemoReviewBinding).mockResolvedValue({ invocationId: input.invocationId, prepared } as never)
  jest.mocked(loadDemoOwners).mockResolvedValue({ person: { updatedAt: new Date(initial) }, deal: { updatedAt: new Date(initial), pipelineId: uuid(16), pipelineStageId: uuid(18) } } as never)
  jest.mocked(demoInstallation).mockResolvedValue({ pipelineId: uuid(16), stageIds: { new: uuid(17), contact_ready: uuid(18) } } as never)
})
test('contact-ready without a committed preparation receipt is not adopted on replay', async () => {
  jest.mocked(findOneWithDecryption).mockResolvedValue(null)
  await expect(prepareDemoProposal(input, context())).rejects.toMatchObject({ status: 409 })
  expect(setDemoStage).not.toHaveBeenCalled()
})
test('a verified preparation checkpoint replays without another stage mutation', async () => {
  jest.mocked(findOneWithDecryption).mockResolvedValue({ snapshotAfter: checkpoint } as never)
  await expect(prepareDemoProposal(input, context())).resolves.toEqual(checkpoint)
  expect(setDemoStage).not.toHaveBeenCalled()
})
test('a later operator edit cannot replace the persisted expected version', async () => {
  jest.mocked(findOneWithDecryption).mockResolvedValue({ snapshotAfter: { ...checkpoint, dealUpdatedAt: changed } } as never)
  await expect(prepareDemoProposal(input, context())).rejects.toMatchObject({ status: 409 })
  expect(setDemoStage).not.toHaveBeenCalled()
})
