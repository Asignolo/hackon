import { asValue, createContainer } from 'awilix'
import type { CommandRuntimeContext } from '@open-mercato/shared/lib/commands'
import { findOneWithDecryption, findWithDecryption } from '@open-mercato/shared/lib/encryption/find'
import { runRouteMutationGuards } from '@open-mercato/shared/lib/crud/route-mutation-guard'
import { CustomerEntity, CustomerPersonProfile, CustomerDeal, CustomerDealPersonLink, CustomerPipeline, CustomerPipelineStage } from '@open-mercato/core/modules/customers/data/entities'
import { PhotographerRawData } from '../data/entities'
import { prepareRegistrationCrm, readRegistrationCrm } from '../lib/registration-crm'

jest.mock('@open-mercato/shared/lib/i18n/server', () => ({ resolveTranslations: async () => ({ translate: (key: string) => key }) }))
jest.mock('@open-mercato/shared/lib/commands/helpers', () => ({ emitCrudSideEffects: jest.fn() }))
jest.mock('@open-mercato/shared/lib/crud/route-mutation-guard', () => ({ runRouteMutationGuards: jest.fn() }))
jest.mock('@open-mercato/shared/lib/encryption/find', () => ({ findOneWithDecryption: jest.fn(), findWithDecryption: jest.fn() }))
jest.mock('../lib/raw-data-create', () => ({ rawDataEntityId: 'photographers:photographer_raw_data' }))
jest.mock('@open-mercato/core/modules/customers/data/entities', () => ({ CustomerEntity: class CustomerEntity {}, CustomerPersonProfile: class CustomerPersonProfile {}, CustomerDeal: class CustomerDeal {}, CustomerDealPersonLink: class CustomerDealPersonLink {}, CustomerPipeline: class CustomerPipeline {}, CustomerPipelineStage: class CustomerPipelineStage {} }))

const tenantId = '11111111-1111-4111-8111-111111111111'
const organizationId = '22222222-2222-4222-8222-222222222222'
const photographerId = '33333333-3333-4333-8333-333333333333'
const personId = '44444444-4444-4444-8444-444444444444'
const dealId = '55555555-5555-4555-8555-555555555555'
const registrationId = '66666666-6666-4666-8666-666666666666'
const userId = '77777777-7777-4777-8777-777777777777'
const pipelineId = '88888888-8888-4888-8888-888888888888'
const stageId = '99999999-9999-4999-8999-999999999999'
const scope = { tenantId, organizationId }
const now = new Date('2026-09-19T10:00:00.000Z')
type Row = Record<string, unknown>
let registrations: PhotographerRawData[]
let people: Row[]
let profiles: Row[]
let deals: Row[]
let links: Row[]
let permitted: boolean
let failureAfterCommit: string | null
const execute = jest.fn()
const encryptEntityPayload = jest.fn()
const lock = jest.fn()
const afterSuccess = jest.fn()

type TestManager = {
  fork: () => TestManager
  transactional: <Result>(callback: (manager: TestManager) => Promise<Result>) => Promise<Result>
  getConnection: () => { execute: typeof lock }
  getTransactionContext: () => Record<string, never>
  flush: () => Promise<void>
  clear: () => void
  begin: () => Promise<void>
  commit: () => Promise<void>
  rollback: () => Promise<void>
}
const em: TestManager = {
  fork: () => em, transactional: async (callback) => callback(em),
  getConnection: () => ({ execute: lock }), getTransactionContext: () => ({}),
  flush: async () => {}, clear: () => {}, begin: async () => {}, commit: async () => {}, rollback: async () => {},
}
function context(): CommandRuntimeContext {
  const container = createContainer()
  container.register({
    em: asValue(em), commandBus: asValue({ execute }), dataEngine: asValue({}),
    moduleConfigService: asValue({ getValue: async () => ({ pipelineId, stageIds: { new: stageId } }) }),
    rbacService: asValue({ getGrantedFeatures: async () => ['*'], userHasAllFeatures: async () => permitted }),
    tenantEncryptionService: asValue({ isEnabled: () => true, encryptEntityPayload }),
  })
  return { container, auth: { sub: userId, tenantId, orgId: organizationId }, selectedOrganizationId: organizationId, organizationIds: [organizationId], organizationScope: null }
}
function matches(row: object, where: unknown): boolean {
  if (!where || typeof where !== 'object') return true
  return Object.entries(where).every(([key, expected]) => {
    const actual = (row as Row)[key]
    if (expected && typeof expected === 'object') {
      if ('$gt' in expected) return String(actual) > String(expected.$gt)
      return !!actual && typeof actual === 'object' && matches(actual, expected)
    }
    return actual === expected
  })
}
function registration(id = registrationId) {
  return Object.assign(new PhotographerRawData(), scope, { id, firstName: 'Anna', lastName: 'Nowak', email: 'anna@example.org', portfolioRaw: 'https://example.org', submittedAt: now, updatedAt: now, customerEntityId: null, isActive: true, deletedAt: null })
}
function seedPerson() {
  const person = { ...scope, id: photographerId, firstName: 'Anna', lastName: 'Nowak', displayName: 'Anna Nowak', primaryEmail: 'anna@example.org', kind: 'person', isActive: true, deletedAt: null }
  people.push(person)
  profiles.push({ ...scope, id: personId, entity: photographerId, firstName: 'Anna', lastName: 'Nowak' })
  return person
}
function seedDeal(input: Row = {}) {
  const deal = { ...scope, id: dealId, pipelineId, pipelineStageId: stageId, deletedAt: null, ...input }
  deals.push(deal)
  links.push({ person: people[0], deal })
  return deal
}

beforeEach(() => {
  jest.clearAllMocks()
  registrations = [registration()]; people = []; profiles = []; deals = []; links = []; permitted = true; failureAfterCommit = null
  jest.mocked(runRouteMutationGuards).mockResolvedValue({ ok: true, runAfterSuccess: afterSuccess })
  encryptEntityPayload.mockImplementation(async (_entity: string, payload: Record<string, string>) => Object.fromEntries(Object.entries(payload).map(([key, value]) => [key, `sealed:${value}`])))
  jest.mocked(findOneWithDecryption).mockImplementation(async (_manager, entity, where) => {
    const rows = entity === PhotographerRawData ? registrations : entity === CustomerEntity ? people : entity === CustomerDeal ? deals : entity === CustomerPipeline ? [{ ...scope, id: pipelineId }] : entity === CustomerPipelineStage ? [{ ...scope, id: stageId, pipelineId }] : []
    return rows.find((row) => matches(row, where)) ?? null
  })
  jest.mocked(findWithDecryption).mockImplementation(async (_manager, entity, where, options) => {
    const rows = entity === CustomerEntity ? people : entity === CustomerPersonProfile ? profiles : entity === CustomerDeal ? deals : entity === CustomerDealPersonLink ? links : []
    return rows.filter((row) => matches(row, where)).slice(0, options?.limit ?? rows.length)
  })
  execute.mockImplementation(async (command: string, options: { input: Row }) => {
    if (command === 'customers.people.create') {
      seedPerson()
      Object.assign(people[0], options.input, { primaryEmail: String(options.input.primaryEmail).trim().toLowerCase() })
      Object.assign(profiles[0], { firstName: String(options.input.firstName).trim(), lastName: String(options.input.lastName).trim() })
    } else if (command === 'customers.deals.create') seedDeal(options.input)
    else throw new Error('[internal] Unexpected command')
    if (command === failureAfterCommit) { failureAfterCommit = null; throw new Error('[internal] Simulated post-commit failure') }
    return { result: {} }
  })
})

it('creates one person and deal, links the source registration and replays without further writes', async () => {
  const ctx = context()
  const first = await prepareRegistrationCrm({ registrationId }, ctx)
  expect(first).toMatchObject({ status: 'ready', photographerId, personId, dealId, links: { person: `/backend/customers/people/${photographerId}`, deal: `/backend/customers/deals/${dealId}` } })
  expect(registrations[0].customerEntityId).toBe(photographerId)
  expect(await prepareRegistrationCrm({ registrationId }, ctx)).toEqual(first)
  expect(await readRegistrationCrm({ registrationId }, ctx)).toEqual(first)
  expect(execute.mock.calls.map(([command]) => command)).toEqual(['customers.people.create', 'customers.deals.create'])
  expect(people[0].source).toBe(`photographers:raw:${registrationId}`)
  expect(deals[0].source).toBe(`photographers:hidden-potential:${photographerId}`)
  expect(JSON.stringify(lock.mock.calls)).not.toContain('anna@example.org')
})

it('reuses an existing person and deal for another registration with matching names and email', async () => {
  const ctx = context()
  await prepareRegistrationCrm({ registrationId }, ctx)
  const second = registration(userId)
  second.email = 'Anna@EXAMPLE.ORG'
  registrations.push(second)
  await expect(prepareRegistrationCrm({ registrationId: userId }, ctx)).resolves.toMatchObject({ photographerId, personId, dealId })
  expect(second.customerEntityId).toBe(photographerId)
  expect(execute).toHaveBeenCalledTimes(2)
})

it('blocks conflicting names on an existing email without creating a replacement person', async () => {
  seedPerson()
  profiles[0].lastName = 'Kowalska'
  await expect(prepareRegistrationCrm({ registrationId }, context())).rejects.toThrow('registration_crm_conflict')
  expect(execute).not.toHaveBeenCalled()
  expect(registrations[0].customerEntityId).toBeNull()
})

it.each(['customers.people.create', 'customers.deals.create'])('recovers the source marker when %s committed before reporting failure', async (command) => {
  failureAfterCommit = command
  const ctx = context()
  await expect(prepareRegistrationCrm({ registrationId }, ctx)).rejects.toThrow('post-commit')
  await expect(prepareRegistrationCrm({ registrationId }, ctx)).resolves.toMatchObject({ photographerId, dealId })
  expect(execute.mock.calls.filter(([name]) => name === command)).toHaveLength(1)
})

it('does not reset an existing unmarked deal stage', async () => {
  seedPerson()
  const existing = seedDeal({ pipelineStageId: userId, status: 'won' })
  await expect(prepareRegistrationCrm({ registrationId }, context())).resolves.toMatchObject({ dealId })
  expect(existing.pipelineStageId).toBe(userId)
  expect(existing.status).toBe('won')
  expect(execute).not.toHaveBeenCalled()
})

it.each(['missing', 'other_tenant', 'other_organization'])('rejects a %s registration before CRM writes', async (mode) => {
  if (mode === 'missing') registrations = []
  if (mode === 'other_tenant') registrations[0].tenantId = userId
  if (mode === 'other_organization') registrations[0].organizationId = userId
  await expect(prepareRegistrationCrm({ registrationId }, context())).rejects.toThrow('registration_not_found')
  expect(execute).not.toHaveBeenCalled()
})

it('rejects missing CRM permissions before reading registration data', async () => {
  permitted = false
  await expect(prepareRegistrationCrm({ registrationId }, context())).rejects.toThrow('forbidden')
  expect(findOneWithDecryption).not.toHaveBeenCalled()
  expect(execute).not.toHaveBeenCalled()
})

it('fails closed when a required encryption field remains plaintext', async () => {
  encryptEntityPayload.mockImplementation(async (_entity, payload) => payload)
  await expect(prepareRegistrationCrm({ registrationId }, context())).rejects.toThrow('encryption_unavailable')
  expect(execute).not.toHaveBeenCalled()
})

it('rejects multiple CRM people sharing the email instead of guessing a match', async () => {
  seedPerson()
  people.push({ ...people[0], id: userId })
  await expect(prepareRegistrationCrm({ registrationId }, context())).rejects.toThrow('registration_crm_conflict')
  expect(execute).not.toHaveBeenCalled()
})

it('honors a blocking mutation guard before the first CRM write', async () => {
  jest.mocked(runRouteMutationGuards).mockResolvedValueOnce({ ok: false, errorStatus: 403, errorBody: { error: 'blocked' }, response: new Response(null, { status: 403 }) })
  await expect(prepareRegistrationCrm({ registrationId }, context())).rejects.toThrow('blocked')
  expect(execute).not.toHaveBeenCalled()
  expect(afterSuccess).not.toHaveBeenCalled()
})
