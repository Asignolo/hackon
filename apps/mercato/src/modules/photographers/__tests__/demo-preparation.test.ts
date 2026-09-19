import { asValue, createContainer } from 'awilix'
import type { CommandRuntimeContext } from '@open-mercato/shared/lib/commands'
import { findOneWithDecryption, findWithDecryption } from '@open-mercato/shared/lib/encryption/find'
import { hasAllFeatures } from '@open-mercato/shared/security/features'
import { runRouteMutationGuards } from '@open-mercato/shared/lib/crud/route-mutation-guard'
import { emitCrudSideEffects } from '@open-mercato/shared/lib/commands/helpers'
import { CustomerEntity, CustomerPersonProfile, CustomerDeal, CustomerDealPersonLink, CustomerPipeline, CustomerPipelineStage } from '@open-mercato/core/modules/customers/data/entities'
import { PhotographerRawData } from '../data/entities'
import { createRawDataRecord } from '../lib/raw-data-create'
import { linkDemoRegistrationCommand } from '../commands/demo-preparation'
import { assertPreparedPhotographerDemo, preparePhotographerDemo } from '../lib/demo-preparation'
import { assertPhotographerDemoAvailable } from '../lib/demo-workflow-runtime'

jest.mock('@open-mercato/shared/lib/i18n/server', () => ({ resolveTranslations: async () => ({ translate: (key: string) => key }) }))
jest.mock('@open-mercato/shared/lib/commands', () => ({ registerCommand: jest.fn() }))
jest.mock('@open-mercato/shared/lib/commands/helpers', () => ({ emitCrudSideEffects: jest.fn() }))
jest.mock('@open-mercato/shared/lib/crud/route-mutation-guard', () => ({ runRouteMutationGuards: jest.fn() }))
jest.mock('@open-mercato/shared/lib/encryption/find', () => ({ findOneWithDecryption: jest.fn(), findWithDecryption: jest.fn() }))
jest.mock('../lib/raw-data-create', () => ({ rawDataEntityId: 'photographers:photographer_raw_data', createRawDataRecord: jest.fn() }))
jest.mock('../lib/demo-workflow-runtime', () => ({ assertPhotographerDemoAvailable: jest.fn() }))
jest.mock('@open-mercato/core/modules/customers/data/entities', () => ({ CustomerEntity: class CustomerEntity {}, CustomerPersonProfile: class CustomerPersonProfile {}, CustomerDeal: class CustomerDeal {}, CustomerDealPersonLink: class CustomerDealPersonLink {}, CustomerPipeline: class CustomerPipeline {}, CustomerPipelineStage: class CustomerPipelineStage {} }))

const tenantId = '11111111-1111-4111-8111-111111111111'
const organizationId = '22222222-2222-4222-8222-222222222222'
const photographerId = '33333333-3333-4333-8333-333333333333'
const personId = '44444444-4444-4444-8444-444444444444'
const dealId = '55555555-5555-4555-8555-555555555555'
const requestId = '66666666-6666-4666-8666-666666666666'
const userId = '77777777-7777-4777-8777-777777777777'
const pipelineId = '88888888-8888-4888-8888-888888888888'
const stageId = '99999999-9999-4999-8999-999999999999'
const scope = { tenantId, organizationId }
const now = new Date('2026-09-19T10:00:00.000Z')
let registration: PhotographerRawData | null
let people: CustomerEntity[]
let profiles: CustomerPersonProfile[]
let deals: CustomerDeal[]
let features: string[]
let failureAfterCommit: string | null
const receipts = new Map<string, unknown>()
const lock = jest.fn()
const flush = jest.fn()
const afterSuccess = jest.fn()
const invalidate = jest.fn()
const encryptEntityPayload = jest.fn()
const execute = jest.fn()
type TestManager = {
  fork: () => TestManager
  transactional: <Result>(callback: (manager: TestManager) => Promise<Result>) => Promise<Result>
  getConnection: () => { execute: typeof lock }
  getTransactionContext: () => Record<string, never>
  flush: typeof flush
  begin: () => Promise<void>
  commit: () => Promise<void>
  rollback: () => Promise<void>
}
const em: TestManager = {
  fork: () => em,
  transactional: async (callback) => callback(em),
  getConnection: () => ({ execute: lock }),
  getTransactionContext: () => ({}), flush,
  begin: async () => {}, commit: async () => {}, rollback: async () => {},
}
function context(): CommandRuntimeContext {
  const container = createContainer()
  container.register({
    em: asValue(em), commandBus: asValue({ execute }), dataEngine: asValue({}),
    moduleConfigService: asValue({ invalidate, getValue: async (_module: string, key: string) => key.startsWith('hidden_potential_installation_') ? { pipelineId, stageIds: { new: stageId, observed: photographerId, contact_ready: personId, contacted: dealId } } : receipts.get(key), setValue: async (_module: string, key: string, value: unknown) => { receipts.set(key, structuredClone(value)); return true } }),
    rbacService: asValue({ getGrantedFeatures: async () => features, userHasAllFeatures: async (_actor: string, required: string[]) => hasAllFeatures(features, required) }),
    tenantEncryptionService: asValue({ isEnabled: () => true, encryptEntityPayload }),
  })
  return { container, auth: { sub: userId, tenantId, orgId: organizationId }, selectedOrganizationId: organizationId, organizationIds: [organizationId], organizationScope: null }
}

beforeEach(() => {
  jest.clearAllMocks()
  registration = null; people = []; profiles = []; deals = []; receipts.clear(); features = ['*']; failureAfterCommit = null
  jest.mocked(assertPhotographerDemoAvailable).mockResolvedValue(undefined)
  jest.mocked(runRouteMutationGuards).mockResolvedValue({ ok: true, runAfterSuccess: afterSuccess })
  encryptEntityPayload.mockImplementation(async (_entity: string, payload: Record<string, string>) => Object.fromEntries(Object.entries(payload).map(([key, value]) => [key, `sealed:${value}`])))
  jest.mocked(createRawDataRecord).mockImplementation(async (raw, _ctx, id) => {
    registration = Object.assign(new PhotographerRawData(), raw, { id, ...scope, submittedAt: now, updatedAt: now, isActive: true, deletedAt: null, customerEntityId: null })
    return { id: id! }
  })
  jest.mocked(findOneWithDecryption).mockImplementation(async (_em, entity, where) => {
    if (entity === CustomerPipeline || entity === CustomerPipelineStage) return { id: pipelineId }
    if (entity === PhotographerRawData) return registration
    if (entity === CustomerEntity) return people.find((person) => person.id === (where as { id: string }).id) ?? null
    if (entity === CustomerDealPersonLink) return { id: 'link' }
    return null
  })
  jest.mocked(findWithDecryption).mockImplementation(async (_em, entity) => {
    if (entity === CustomerEntity) return people
    if (entity === CustomerPersonProfile) return profiles
    if (entity === CustomerDeal) return deals
    return []
  })
  execute.mockImplementation(async (command: string, options: { input: Record<string, unknown>; ctx: CommandRuntimeContext }) => {
    if (command === 'customers.people.create') {
      people.push(Object.assign(new CustomerEntity(), options.input, { id: photographerId, kind: 'person', deletedAt: null }))
      profiles.push(Object.assign(new CustomerPersonProfile(), scope, { id: personId, firstName: options.input.firstName, lastName: options.input.lastName }))
    } else if (command === 'customers.deals.create') {
      deals.push(Object.assign(new CustomerDeal(), options.input, { id: dealId, deletedAt: null }))
    } else if (command === 'photographers.demo.link_registration') {
      await linkDemoRegistrationCommand.execute(options.input, options.ctx)
    }
    if (command === failureAfterCommit) { failureAfterCommit = null; throw new Error('[internal] Simulated post-commit failure') }
    return { result: {} }
  })
})

it('creates fictional scoped owners through CRM commands, links original registration and replays without duplicates', async () => {
  const ctx = context()
  const first = await preparePhotographerDemo(requestId, ctx)
  expect(first).toMatchObject({ requestId, photographerId, personId, dealId, userId, source: 'demo_fixture', evaluatedAt: now.toISOString() })
  expect(registration?.email).toBe(`demo-${first.registrationId}@photographer.invalid`)
  expect(registration?.portfolioRaw).toBe(`https://photographer.invalid/demo/${first.registrationId}`)
  expect(registration?.customerEntityId).toBe(photographerId)
  expect(deals[0]).toMatchObject({ pipelineId, pipelineStageId: stageId })
  expect(await preparePhotographerDemo(requestId, ctx)).toEqual(first)
  expect(execute.mock.calls.map(([command]) => command)).toEqual(['customers.people.create', 'photographers.demo.link_registration', 'customers.deals.create'])
  expect(lock).toHaveBeenCalledWith(expect.any(String), [`photographers:demo:${tenantId}:${organizationId}:${requestId}`], 'all', {})
  expect(invalidate).toHaveBeenCalledWith('photographers', `demo_preparation_${organizationId}_${requestId}`, scope)
  expect(JSON.stringify([...receipts.values()])).not.toMatch(/photographer.invalid|firstName|portfolio/)
  await expect(assertPreparedPhotographerDemo(first, scope, ctx.container)).resolves.toBeUndefined()
})

it('keeps the advisory lock outside the child commands transaction context', async () => {
  const ctx = context()
  const enterAmbientTransaction = jest.fn(async () => { throw new Error('[internal] Advisory lock must not enlist writes') })
  const isolatedManager = { ...em, transactional: enterAmbientTransaction }
  isolatedManager.fork = () => isolatedManager
  ctx.container.register('em', asValue(isolatedManager))
  execute.mockImplementationOnce(async (_command: string, options: { input: Record<string, unknown> }) => {
    people.push(Object.assign(new CustomerEntity(), options.input, { id: photographerId, kind: 'person', deletedAt: null }))
    profiles.push(Object.assign(new CustomerPersonProfile(), scope, { id: personId, firstName: options.input.firstName, lastName: options.input.lastName }))
    throw new Error('[internal] Simulated post-commit failure')
  })
  await expect(preparePhotographerDemo(requestId, ctx)).rejects.toThrow('post-commit')
  expect(enterAmbientTransaction).not.toHaveBeenCalled()
  expect(registration).not.toBeNull()
  expect([...receipts.values()]).toEqual([expect.objectContaining({ phase: 'person_pending' })])
})

it.each(['customers.people.create', 'customers.deals.create'])('recovers an existing source marker after %s committed but reported failure', async (command) => {
  failureAfterCommit = command
  const ctx = context()
  await expect(preparePhotographerDemo(requestId, ctx)).rejects.toThrow('post-commit')
  expect(invalidate).toHaveBeenCalledTimes(2)
  await expect(preparePhotographerDemo(requestId, ctx)).resolves.toMatchObject({ photographerId, dealId })
  expect(execute.mock.calls.filter(([id]) => id === command)).toHaveLength(1)
})

it.each(['customers.people.create', 'customers.deals.create'])('fails closed if an uncertain committed %s marker has been hard deleted', async (command) => {
  failureAfterCommit = command
  const ctx = context()
  await expect(preparePhotographerDemo(requestId, ctx)).rejects.toThrow()
  if (command === 'customers.people.create') people = []; else deals = []
  await expect(preparePhotographerDemo(requestId, ctx)).rejects.toThrow()
  expect(execute.mock.calls.filter(([id]) => id === command)).toHaveLength(1)
})

it.each(['duplicate', 'deleted'])('rejects %s person markers on replay', async (mode) => {
  const ctx = context()
  await preparePhotographerDemo(requestId, ctx)
  if (mode === 'duplicate') people.push(people[0]); else people[0].deletedAt = now
  await expect(preparePhotographerDemo(requestId, ctx)).rejects.toThrow()
  expect(execute).toHaveBeenCalledTimes(3)
})

it('rejects missing permissions and unavailable runtime before installation or writes', async () => {
  features = ['photographers.*']
  await expect(preparePhotographerDemo(requestId, context())).rejects.toThrow()
  features = ['*']
  jest.mocked(assertPhotographerDemoAvailable).mockRejectedValueOnce(new Error('[internal] unavailable'))
  await expect(preparePhotographerDemo(requestId, context())).rejects.toThrow()
  expect(receipts.size).toBe(0)
  expect(createRawDataRecord).not.toHaveBeenCalled()
  expect(execute).not.toHaveBeenCalled()
})

it('fails closed on a disabled encryption field before setup or CRM writes', async () => {
  encryptEntityPayload.mockImplementation(async (_entity, payload) => payload)
  await expect(preparePhotographerDemo(requestId, context())).rejects.toThrow()
  expect(receipts.size).toBe(0)
  expect(execute).not.toHaveBeenCalled()
})

it('binds receipts to the user and validates authoritative owner references before workflow writes', async () => {
  const ctx = context()
  const prepared = await preparePhotographerDemo(requestId, ctx)
  await expect(assertPreparedPhotographerDemo({ ...prepared, dealId: requestId }, scope, ctx.container)).rejects.toThrow()
  await expect(assertPreparedPhotographerDemo(prepared, { ...scope, organizationId: requestId }, ctx.container)).rejects.toThrow()
  ctx.auth = { ...ctx.auth!, sub: requestId }
  await expect(preparePhotographerDemo(requestId, ctx)).rejects.toThrow()
  expect(execute).toHaveBeenCalledTimes(3)
})

it('honors registry mutation guards for raw linking and emits no mutation effects when blocked', async () => {
  const ctx = context()
  const prepared = await preparePhotographerDemo(requestId, ctx)
  jest.mocked(emitCrudSideEffects).mockClear()
  jest.mocked(runRouteMutationGuards).mockResolvedValueOnce({ ok: false, errorStatus: 403, errorBody: { error: 'blocked' }, response: new Response(null, { status: 403 }) })
  await expect(linkDemoRegistrationCommand.execute({ requestId, registrationId: prepared.registrationId, customerEntityId: photographerId, expectedUpdatedAt: now.toISOString() }, ctx)).rejects.toThrow()
  expect(emitCrudSideEffects).not.toHaveBeenCalled()
})

it('rejects a stale raw registration version before changing its link', async () => {
  const ctx = context()
  const prepared = await preparePhotographerDemo(requestId, ctx)
  registration!.customerEntityId = null
  registration!.updatedAt = new Date('2026-09-19T11:00:00Z')
  await expect(linkDemoRegistrationCommand.execute({ requestId, registrationId: prepared.registrationId, customerEntityId: photographerId, expectedUpdatedAt: now.toISOString() }, ctx)).rejects.toThrow()
  expect(registration!.customerEntityId).toBeNull()
})

it('requires the existing installation before creating any preparation receipt or owner', async () => {
  jest.mocked(findOneWithDecryption).mockResolvedValueOnce(null)
  await expect(preparePhotographerDemo(requestId, context())).rejects.toThrow()
  expect(receipts.size).toBe(0)
  expect(createRawDataRecord).not.toHaveBeenCalled()
  expect(execute).not.toHaveBeenCalled()
})


it.each(['email', 'firstName', 'lastName'])('rejects a source-marked person with altered %s during recovery', async (field) => {
  failureAfterCommit = 'customers.people.create'
  const ctx = context()
  await expect(preparePhotographerDemo(requestId, ctx)).rejects.toThrow('post-commit')
  expect(invalidate).toHaveBeenCalledTimes(2)
  if (field === 'email') people[0].primaryEmail = 'real-person@example.org'
  if (field === 'firstName') profiles[0].firstName = 'Real'
  if (field === 'lastName') profiles[0].lastName = 'Person'
  await expect(preparePhotographerDemo(requestId, ctx)).rejects.toThrow()
  expect(registration!.customerEntityId).toBeNull()
  expect(execute).toHaveBeenCalledTimes(1)
})

it('blocks worker authenticity checks after the demo person becomes a different identity', async () => {
  const ctx = context()
  const prepared = await preparePhotographerDemo(requestId, ctx)
  people[0].primaryEmail = 'real-person@example.org'
  await expect(assertPreparedPhotographerDemo(prepared, scope, ctx.container)).rejects.toThrow()
  people[0].primaryEmail = registration!.email
  registration!.portfolioRaw = 'https://real-portfolio.example.org'
  await expect(assertPreparedPhotographerDemo(prepared, scope, ctx.container)).rejects.toThrow()
})
