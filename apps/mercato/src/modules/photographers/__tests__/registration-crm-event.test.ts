import { asValue, createContainer } from 'awilix'
import { CrudHttpError } from '@open-mercato/shared/lib/crud/errors'
import { findOneWithDecryption } from '@open-mercato/shared/lib/encryption/find'
import { User } from '@open-mercato/core/modules/auth/data/entities'
import { authorizeRegistrationCrm } from '../lib/registration-crm'
import { prepareRegistrationFromEvent } from '../lib/registration-crm-event'

jest.mock('@open-mercato/shared/lib/encryption/find', () => ({ findOneWithDecryption: jest.fn() }))
jest.mock('@open-mercato/core/modules/auth/data/entities', () => ({ User: class User {} }))
jest.mock('../lib/registration-crm', () => ({ authorizeRegistrationCrm: jest.fn() }))

const event = {
  id: '11111111-1111-4111-8111-111111111111',
  userId: '22222222-2222-4222-8222-222222222222',
  tenantId: '33333333-3333-4333-8333-333333333333',
  organizationId: '44444444-4444-4444-8444-444444444444',
  prepareCrm: true,
}
const execute = jest.fn()
const manager = {}
const fork = jest.fn(() => manager)
function container() {
  const instance = createContainer()
  instance.register({ em: asValue({ fork }), commandBus: asValue({ execute }) })
  return instance
}

beforeEach(() => {
  jest.clearAllMocks()
  execute.mockReset().mockResolvedValue({ result: {} })
  jest.mocked(findOneWithDecryption).mockResolvedValue(Object.assign(new User(), { id: event.userId, isConfirmed: true }))
  jest.mocked(authorizeRegistrationCrm).mockReset().mockResolvedValue({ tenantId: event.tenantId, organizationId: event.organizationId })
})

it('ignores demo events without the explicit ordinary-registration marker', async () => {
  const { prepareCrm: _prepareCrm, ...demoEvent } = event
  await prepareRegistrationFromEvent(demoEvent, container())
  expect(fork).not.toHaveBeenCalled()
  expect(authorizeRegistrationCrm).not.toHaveBeenCalled()
  expect(execute).not.toHaveBeenCalled()
})

it('preserves the authenticated actor and scope when invoking preparation', async () => {
  const instance = container()
  await prepareRegistrationFromEvent(event, instance)
  expect(findOneWithDecryption).toHaveBeenCalledWith(manager, User, { id: event.userId, tenantId: event.tenantId, deletedAt: null }, {}, { tenantId: event.tenantId, organizationId: event.organizationId })
  const expectedContext = {
    container: instance,
    auth: { sub: event.userId, tenantId: event.tenantId, orgId: event.organizationId },
    selectedOrganizationId: event.organizationId,
    organizationIds: [event.organizationId],
    organizationScope: null,
  }
  expect(authorizeRegistrationCrm).toHaveBeenCalledWith(expectedContext, true)
  expect(execute).toHaveBeenCalledWith('photographers.registration.prepare_crm', { input: { registrationId: event.id }, ctx: expectedContext })
})

it('does not execute on behalf of a deleted or missing user', async () => {
  jest.mocked(findOneWithDecryption).mockResolvedValue(null)
  await prepareRegistrationFromEvent(event, container())
  expect(authorizeRegistrationCrm).not.toHaveBeenCalled()
  expect(execute).not.toHaveBeenCalled()
})

it('does not execute on behalf of an unconfirmed user', async () => {
  jest.mocked(findOneWithDecryption).mockResolvedValue(Object.assign(new User(), { id: event.userId, isConfirmed: false }))
  await prepareRegistrationFromEvent(event, container())
  expect(authorizeRegistrationCrm).not.toHaveBeenCalled()
  expect(execute).not.toHaveBeenCalled()
})

it('stops when the actor no longer has required permissions', async () => {
  jest.mocked(authorizeRegistrationCrm).mockRejectedValue(new CrudHttpError(403, { error: 'forbidden' }))
  await expect(prepareRegistrationFromEvent(event, container())).resolves.toBeUndefined()
  expect(execute).not.toHaveBeenCalled()
})

it('rethrows a transient service failure so the persistent queue can retry', async () => {
  const failure = new CrudHttpError(503, { error: 'unavailable' })
  execute.mockRejectedValue(failure)
  await expect(prepareRegistrationFromEvent(event, container())).rejects.toBe(failure)
  expect(execute).toHaveBeenCalledTimes(1)
})
