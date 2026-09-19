import { asValue, createContainer } from 'awilix'
import { registerCommand, type CommandRuntimeContext } from '@open-mercato/shared/lib/commands'
import { makeCrudRoute } from '@open-mercato/shared/lib/crud/factory'
import { findOneWithDecryption } from '@open-mercato/shared/lib/encryption/find'
import { emitCrudSideEffects } from '@open-mercato/shared/lib/commands/helpers'
import { CustomerEntity } from '@open-mercato/core/modules/customers/data/entities'
import { createRawDataCommand, rawDataEntityId } from '../commands/raw-data'
import { PhotographerRawData } from '../data/entities'
import { rawDataCreateSchema, rawDataListSchema } from '../data/validators'
import { requirePhotographerScope } from '../lib/scope'
import * as route from '../api/raw-data/route'

jest.mock('@open-mercato/shared/lib/i18n/server', () => ({ resolveTranslations: async () => ({ translate: (key: string) => key }) }))
jest.mock('@open-mercato/shared/lib/commands', () => ({ registerCommand: jest.fn() }))
jest.mock('@open-mercato/shared/lib/commands/helpers', () => ({ emitCrudSideEffects: jest.fn() }))
jest.mock('@open-mercato/shared/lib/encryption/find', () => ({ findOneWithDecryption: jest.fn() }))
jest.mock('@open-mercato/core/modules/customers/data/entities', () => ({ CustomerEntity: class CustomerEntity {} }))
jest.mock('@open-mercato/shared/lib/crud/factory', () => ({
  makeCrudRoute: jest.fn((config: { metadata: unknown }) => ({
    metadata: config.metadata,
    GET: jest.fn(),
    POST: jest.fn(),
  })),
}))

const tenantId = '11111111-1111-4111-8111-111111111111'
const organizationId = '22222222-2222-4222-8222-222222222222'
const customerEntityId = '33333333-3333-4333-8333-333333333333'
const submissionId = '44444444-4444-4444-8444-444444444444'
const source = {
  firstName: '  Jan ',
  lastName: 'Kowalski ',
  email: 'Jan.Kowalski@Example.com',
  portfolioRaw: 'https://www.instagram.com/Jan/?ref=Registration',
}
const ciphertext = {
  firstName: 'encrypted:first',
  lastName: 'encrypted:last',
  email: 'encrypted:email',
  portfolioRaw: 'encrypted:portfolio',
}
const encryptEntityPayload = jest.fn()
const createOrmEntity = jest.fn()
const em = {}
function context(overrides: Partial<CommandRuntimeContext> = {}): CommandRuntimeContext {
  const container = createContainer()
  container.register({
    em: asValue(em),
    dataEngine: asValue({ createOrmEntity }),
    tenantEncryptionService: asValue({ encryptEntityPayload }),
  })
  return {
    container,
    auth: { sub: 'user', tenantId, orgId: organizationId },
    selectedOrganizationId: organizationId,
    organizationIds: [organizationId],
    organizationScope: null,
    ...overrides,
  }
}

beforeEach(() => {
  encryptEntityPayload.mockReset().mockResolvedValue(ciphertext)
  createOrmEntity.mockReset().mockResolvedValue({ id: submissionId })
  jest.mocked(findOneWithDecryption).mockReset()
  jest.mocked(emitCrudSideEffects).mockClear()
})

describe('raw submission validation', () => {
  it.each(['@jan_fotograf', 'Nie mam portfolio', 'example.com/zdjecia', '  Instagram: @Jan  ', ''])('preserves unnormalized portfolio input %j', (portfolioRaw) => {
    expect(rawDataCreateSchema.parse({ ...source, portfolioRaw }).portfolioRaw).toBe(portfolioRaw)
  })

  it('preserves original strings and accepts social portfolios and offset dates', () => {
    expect(rawDataCreateSchema.parse(source)).toEqual(source)
    const input = { ...source, submittedAt: '2026-09-19T12:00:00+02:00', customerEntityId: null }
    expect(rawDataCreateSchema.parse(input)).toEqual(input)
  })

  it.each([
    { firstName: '   ' }, { lastName: '' }, { firstName: 'x'.repeat(201) },
    { email: 'invalid' }, { portfolioRaw: null }, { portfolioRaw: 123 },
    { portfolioRaw: `https://example.com/${'x'.repeat(2048)}` },
    { submittedAt: 'yesterday' }, { customerEntityId: 'invalid' },
    { tenantId }, { organizationId }, { isActive: false }, { id: submissionId },
  ])('rejects invalid or server-owned input %j', (override) => {
    expect(rawDataCreateSchema.safeParse({ ...source, ...override }).success).toBe(false)
  })

  it.each([{ page: 0 }, { page: 1.5 }, { pageSize: 101 }, { pageSize: -1 }, { tenantId }, { organizationId }])('bounds pagination and rejects scope injection %j', (query) => {
    expect(rawDataListSchema.safeParse(query).success).toBe(false)
  })

  it('coerces valid bounded pagination', () => {
    expect(rawDataListSchema.parse({ page: '2', pageSize: '100' })).toEqual({ page: 2, pageSize: 100 })
  })
})

describe('scope', () => {
  it.each([
    { auth: null },
    { auth: { sub: 'user', tenantId: null, orgId: organizationId } },
    { selectedOrganizationId: null, auth: { sub: 'user', tenantId, orgId: null } },
    { organizationIds: [] },
    { selectedOrganizationId: customerEntityId },
  ])('rejects absent or unauthorized scope %j', async (overrides) => {
    await expect(requirePhotographerScope(context(overrides))).rejects.toThrow()
  })

  it('derives scope from authorized context', async () => {
    expect(await requirePhotographerScope(context())).toEqual({ tenantId, organizationId })
  })
})

describe('create command', () => {
  it('encrypts exact original data and writes only ciphertext with authenticated scope', async () => {
    const submittedAt = '2026-09-19T12:00:00+02:00'
    expect(await createRawDataCommand.execute({ ...source, submittedAt }, context())).toEqual({ id: submissionId })
    expect(encryptEntityPayload).toHaveBeenCalledWith(rawDataEntityId, source, tenantId, organizationId)
    expect(createOrmEntity).toHaveBeenCalledWith({
      entity: PhotographerRawData,
      data: { ...ciphertext, tenantId, organizationId, submittedAt: new Date(submittedAt), customerEntityId: null },
    })
    expect(emitCrudSideEffects).toHaveBeenCalledWith(expect.objectContaining({
      action: 'created', identifiers: { id: submissionId, tenantId, organizationId },
      indexer: { entityType: rawDataEntityId },
    }))
  })

  it('checks customer identity within the same tenant and organization', async () => {
    jest.mocked(findOneWithDecryption).mockResolvedValue({ id: customerEntityId } as CustomerEntity)
    await createRawDataCommand.execute({ ...source, customerEntityId }, context())
    expect(findOneWithDecryption).toHaveBeenCalledWith(em, CustomerEntity,
      { id: customerEntityId, tenantId, organizationId, deletedAt: null }, {}, { tenantId, organizationId })
  })

  it('rejects a customer missing from the current scope before persistence', async () => {
    jest.mocked(findOneWithDecryption).mockResolvedValue(null)
    await expect(createRawDataCommand.execute({ ...source, customerEntityId }, context())).rejects.toThrow()
    expect(createOrmEntity).not.toHaveBeenCalled()
    expect(encryptEntityPayload).not.toHaveBeenCalled()
  })

  it.each([source, { ...ciphertext, email: source.email }, { ...ciphertext, firstName: null }])('fails closed when encryption returns unprotected data', async (encrypted) => {
    encryptEntityPayload.mockResolvedValue(encrypted)
    await expect(createRawDataCommand.execute(source, context())).rejects.toThrow()
    expect(createOrmEntity).not.toHaveBeenCalled()
    expect(emitCrudSideEffects).not.toHaveBeenCalled()
  })

  it('fails before persistence when encryption fails', async () => {
    encryptEntityPayload.mockRejectedValue(new Error('[internal] Encryption unavailable'))
    await expect(createRawDataCommand.execute(source, context())).rejects.toThrow()
    expect(createOrmEntity).not.toHaveBeenCalled()
  })

  it('defaults the submission and technical timestamps to the current instant', async () => {
    jest.useFakeTimers().setSystemTime(new Date('2026-09-19T10:00:00Z'))
    try {
      await createRawDataCommand.execute(source, context())
      expect(createOrmEntity).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ submittedAt: new Date() }) }))
      const entity = new PhotographerRawData()
      expect(entity.createdAt).toEqual(new Date())
      expect(entity.updatedAt).toEqual(new Date())
      expect(entity.submittedAt).toEqual(new Date())
      expect(entity.isActive).toBe(true)
    } finally {
      jest.useRealTimers()
    }
  })
})

describe('append-only route', () => {
  const config = jest.mocked(makeCrudRoute).mock.calls[0][0]

  it('exposes only authenticated read and create with distinct permissions', () => {
    expect(route).not.toHaveProperty('PUT')
    expect(route).not.toHaveProperty('DELETE')
    expect(route).not.toHaveProperty('PATCH')
    expect(route.metadata).toEqual({
      GET: { requireAuth: true, requireFeatures: ['photographers.view'] },
      POST: { requireAuth: true, requireFeatures: ['photographers.create'] },
    })
    expect(config.actions).toEqual({ create: expect.objectContaining({ commandId: createRawDataCommand.id, schema: rawDataCreateSchema, status: 201 }) })
    expect(createRawDataCommand.isUndoable).toBe(false)
  })

  it('scopes reads and maps encrypted column names to public fields', async () => {
    expect(config.orm).toEqual({ entity: PhotographerRawData, orgField: 'organizationId', tenantField: 'tenantId', softDeleteField: 'deletedAt' })
    const buildFilters = config.list?.buildFilters as (query: Record<string, unknown>, ctx: CommandRuntimeContext) => Promise<Record<string, unknown>>
    expect(await buildFilters({ id: submissionId, customerEntityId }, context())).toEqual({ tenant_id: tenantId, organization_id: organizationId, id: submissionId, customer_entity_id: customerEntityId })
    await expect(buildFilters({}, context({ organizationIds: [] }))).rejects.toThrow()
    const transformItem = config.list?.transformItem as (item: Record<string, unknown>) => Record<string, unknown>
    expect(transformItem({ id: submissionId, first_name: source.firstName, last_name: source.lastName, email: source.email, portfolio_raw: source.portfolioRaw, submitted_at: 'submitted', created_at: 'created', updated_at: 'updated' })).toEqual({ id: submissionId, ...source, submittedAt: 'submitted', customerEntityId: null, createdAt: 'created', updatedAt: 'updated' })
  })
})

it('allows the registration helper to load in a worker without registering commands', () => {
  jest.mocked(registerCommand).mockClear()
  jest.isolateModules(() => { require('../lib/raw-data-create') })
  expect(registerCommand).not.toHaveBeenCalled()
})
