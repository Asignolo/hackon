import { asValue, createContainer } from 'awilix'
import type { CommandRuntimeContext } from '@open-mercato/shared/lib/commands'
import { loadDemoDecision } from '../lib/demo-proposal-decision'
import { readDemoCheckpoint, assertDemoCheckpoint, requireDemoEffectEncryption } from '../lib/demo-proposal-journal'
import { loadDemoOwners, setDemoStage } from '../lib/demo-proposal-support'
import { readMessageReviewMaterials } from '../lib/proposal-review-materials'
import { executeDemoEffect, executeDemoEffectPhase } from '../lib/demo-proposal-effects'
import { undoDemoEffect } from '../lib/demo-proposal-undo'

jest.mock('../lib/demo-proposal-decision', () => ({ loadDemoDecision: jest.fn(), assertCurrentDemoDecision: jest.fn() }))
jest.mock('../lib/demo-proposal-journal', () => ({ readDemoCheckpoint: jest.fn(), assertDemoCheckpoint: jest.fn(), requireDemoEffectEncryption: jest.fn() }))
jest.mock('../lib/demo-proposal-support', () => ({ loadDemoOwners: jest.fn(), setDemoStage: jest.fn(), executeDemoCrmCommand: jest.fn(), withDemoOperationLock: async (_container: unknown, _key: string, action: () => Promise<unknown>) => action() }))
jest.mock('../lib/proposal-review-materials', () => ({ readMessageReviewMaterials: jest.fn(), reviewError: async (status: number) => { throw Object.assign(new Error('blocked'), { status }) } }))
jest.mock('../lib/material-store', () => ({ readEvaluationMaterial: jest.fn() }))
jest.mock('@open-mercato/shared/lib/i18n/server', () => ({ resolveTranslations: async () => ({ translate: (key: string) => key }) }))
jest.mock('@open-mercato/shared/lib/encryption/find', () => ({ findOneWithDecryption: jest.fn() }))
jest.mock('@open-mercato/core/modules/customers/data/entities', () => ({ CustomerInteraction: class CustomerInteraction {} }))
const uuid = (number: number) => `${String(number).padStart(8, '0')}-1111-4111-8111-111111111111`
const input = { tenantId: uuid(1), organizationId: uuid(2), proposalId: uuid(3) }
const initial = '2026-09-19T12:00:00.000Z', written = '2026-09-19T12:01:00.000Z'
const execute = jest.fn()
const decision = () => ({ input, scope: input, prepared: { photographerId: uuid(4), dealId: uuid(5) }, proposal: { id: input.proposalId, workflowInstanceId: uuid(6) }, run: { invocationId: uuid(7) }, disposition: 'approved', digest: 'd'.repeat(64), payload: { expectedVersions: { personUpdatedAt: initial, dealUpdatedAt: initial } } })
function context(): CommandRuntimeContext {
  const container = createContainer()
  container.register({ commandBus: asValue({ execute }) })
  return { container, auth: { sub: uuid(8), tenantId: input.tenantId, orgId: input.organizationId }, selectedOrganizationId: input.organizationId, organizationIds: [input.organizationId], organizationScope: null }
}
beforeEach(() => {
  jest.clearAllMocks()
  jest.mocked(loadDemoDecision).mockResolvedValue(decision() as never)
  jest.mocked(readDemoCheckpoint).mockResolvedValue(null)
  jest.mocked(loadDemoOwners).mockResolvedValue({ person: { updatedAt: new Date(initial) }, deal: { updatedAt: new Date(initial), pipelineId: uuid(9), pipelineStageId: uuid(10) } } as never)
  jest.mocked(setDemoStage).mockResolvedValue({ personUpdatedAt: initial, dealUpdatedAt: written, interactionUpdatedAt: null })
})

test('approval validates accepted material and refuses stale ownership before writes', async () => {
  const changed = decision(); changed.payload.expectedVersions.dealUpdatedAt = written
  jest.mocked(loadDemoDecision).mockResolvedValue(changed as never)
  await expect(executeDemoEffectPhase({ ...input, phase: 'stage' }, context())).rejects.toMatchObject({ status: 409 })
  expect(setDemoStage).not.toHaveBeenCalled()
})

test('a concurrent change after native commit cannot be adopted as an effect version', async () => {
  await expect(executeDemoEffectPhase({ ...input, phase: 'stage' }, context())).rejects.toMatchObject({ status: 409 })
  expect(readMessageReviewMaterials).toHaveBeenCalled()
  expect(requireDemoEffectEncryption).toHaveBeenCalled()
})

test('reject records observed stage without requiring material approval evidence', async () => {
  jest.mocked(loadDemoDecision).mockResolvedValue({ ...decision(), disposition: 'rejected' } as never)
  jest.mocked(loadDemoOwners).mockResolvedValueOnce({ person: { updatedAt: new Date(initial) }, deal: { updatedAt: new Date(initial), pipelineId: uuid(9), pipelineStageId: uuid(10) } } as never)
    .mockResolvedValueOnce({ person: { updatedAt: new Date(initial) }, deal: { updatedAt: new Date(written) } } as never)
  await expect(executeDemoEffectPhase({ ...input, phase: 'stage' }, context())).resolves.toMatchObject({ disposition: 'rejected', dealUpdatedAt: written })
  expect(readMessageReviewMaterials).not.toHaveBeenCalled()
  expect(jest.mocked(setDemoStage).mock.calls[0][1]).toBe('observed')
})

test('completed replay validates checkpoint and emits no duplicate CRM command', async () => {
  const checkpoint = { proposalId: input.proposalId, interactionId: uuid(11) }
  jest.mocked(readDemoCheckpoint).mockImplementation(async (_decision, phase) => phase === 'interaction' ? checkpoint as never : null)
  await expect(executeDemoEffect(input, context())).resolves.toEqual(checkpoint)
  expect(assertDemoCheckpoint).toHaveBeenCalledWith(expect.anything(), checkpoint, expect.anything())
  expect(execute).not.toHaveBeenCalled()
})

test('effect replay is blocked after an approval revocation', async () => {
  jest.mocked(readDemoCheckpoint).mockImplementation(async (_decision, phase) => phase === 'revoke_stage' ? {} as never : null)
  await expect(executeDemoEffect(input, context())).rejects.toMatchObject({ status: 409 })
  expect(execute).not.toHaveBeenCalled()
})

test('undo resumes fixed revocation phases and never deletes original material or interaction', async () => {
  await undoDemoEffect(input, context())
  expect(execute.mock.calls.map(([id, options]) => [id, options.input.phase])).toEqual([
    ['photographers.demo.message.phase', 'revoke_stage'], ['photographers.demo.message.phase', 'revoke_interaction'],
  ])
  jest.mocked(readDemoCheckpoint).mockResolvedValue({} as never)
  execute.mockClear()
  await undoDemoEffect(input, context())
  expect(execute).not.toHaveBeenCalled()
})
