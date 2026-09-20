import { asValue, createContainer } from 'awilix'
import type { CommandRuntimeContext } from '@open-mercato/shared/lib/commands'
import { findOneWithDecryption } from '@open-mercato/shared/lib/encryption/find'
import { hasAllFeatures } from '@open-mercato/shared/security/features'
import { CustomerEntity, CustomerInteraction, CustomerPersonProfile, CustomerDeal, CustomerDealPersonLink } from '@open-mercato/core/modules/customers/data/entities'
import { PhotographerRawData, PhotographerEvaluationMaterial } from '../data/entities'
import { readEvaluationMaterial, storeEvaluationMaterial } from '../lib/material-store'

jest.mock('@open-mercato/shared/lib/i18n/server', () => ({ resolveTranslations: async () => ({ translate: (key: string) => key }) }))
jest.mock('@open-mercato/shared/lib/encryption/find', () => ({ findOneWithDecryption: jest.fn(), findWithDecryption: jest.fn() }))
jest.mock('@open-mercato/core/modules/customers/data/entities', () => ({
  CustomerEntity: class CustomerEntity {}, CustomerInteraction: class CustomerInteraction {},
  CustomerPersonProfile: class CustomerPersonProfile {}, CustomerDeal: class CustomerDeal {}, CustomerDealPersonLink: class CustomerDealPersonLink {},
}))

const tenantId = '11111111-1111-4111-8111-111111111111'
const organizationId = '22222222-2222-4222-8222-222222222222'
const entityId = '33333333-3333-4333-8333-333333333333'
const photographerId = entityId
const personId = '55555555-5555-4555-8555-555555555555'
const operationId = '66666666-6666-4666-8666-666666666666'
const requestId = '77777777-7777-4777-8777-777777777777'
const userId = '88888888-8888-4888-8888-888888888888'
type Row = PhotographerEvaluationMaterial
const records = new Map<string, Row>()
const create = jest.fn()
const persist = jest.fn()
const flush = jest.fn()
const encryptEntityPayload = jest.fn()
const lock = jest.fn()
let features = ['photographers.*', 'customers.*']
let entityPresent = true
type TestManager = {
  fork: () => TestManager
  transactional: <Result>(callback: (manager: TestManager) => Promise<Result>) => Promise<Result>
  getConnection: () => { execute: typeof lock }
  getTransactionContext: () => Record<string, never>
  create: typeof create
  persist: typeof persist
  flush: typeof flush
}
const em: TestManager = {
  fork: () => em,
  transactional: async <Result,>(callback: (manager: TestManager) => Promise<Result>) => callback(em),
  getConnection: () => ({ execute: lock }),
  getTransactionContext: () => ({}),
  create, persist, flush,
}
function context(): CommandRuntimeContext {
  const container = createContainer()
  container.register({
    em: asValue(em),
    rbacService: asValue({ userHasAllFeatures: async (_actor: string, required: string[]) => hasAllFeatures(features, required) }),
    tenantEncryptionService: asValue({ isEnabled: () => true, getEncryptedFieldNames: async () => ['body'], encryptEntityPayload }),
  })
  return { container, auth: { sub: userId, tenantId, orgId: organizationId }, selectedOrganizationId: organizationId, organizationIds: [organizationId], organizationScope: null }
}
function input() {
  return { operationId, snapshot: { photographerId, personId, material: {
    kind: 'eligibility', data: { schemaVersion: 1, photographerId, requestId, status: 'no_orders_confirmed', checkedAt: '2026-09-19T10:00:00Z', expiresAt: '2026-09-20T10:00:00Z', confirmedBy: userId, sourceRef: 'synthetic-store-check' },
  } } }
}

beforeEach(() => {
  records.clear()
  jest.clearAllMocks()
  features = ['photographers.*', 'customers.*']
  entityPresent = true
  encryptEntityPayload.mockImplementation(async (_entity: string, value: Record<string, string>) => Object.fromEntries(Object.entries(value).map(([key, text]) => [key, `sealed:${Buffer.from(text).toString('base64')}`])))
  create.mockImplementation((_entity: unknown, value: Partial<Row>) => Object.assign(new PhotographerEvaluationMaterial(), value, { updatedAt: new Date('2026-09-19T10:00:00Z') }))
  persist.mockImplementation((value: Row) => {
    records.set(value.id, structuredClone(value))
    return em
  })
  flush.mockResolvedValue(undefined)
  jest.mocked(findOneWithDecryption).mockImplementation(async (_manager, entity, where) => {
    const filter = where as Record<string, unknown>
    if (filter.tenantId !== tenantId || filter.organizationId !== organizationId) {
      if (entity !== CustomerDealPersonLink) return null
    }
    if (entity === PhotographerEvaluationMaterial) {
      const row = filter.operationId ? [...records.values()].find((entry) => entry.operationId === filter.operationId) : records.get(String(filter.id))
      return (row ? { ...row, body: row.body.startsWith('sealed:') ? Buffer.from(row.body.slice(7), 'base64').toString() : row.body } : null) as never
    }
    if ([PhotographerRawData, CustomerEntity, CustomerPersonProfile, CustomerDeal, CustomerDealPersonLink].includes(entity as typeof CustomerEntity)) return (entityPresent ? { id: filter.id } : null) as never
    return null
  })

})

test('stores one encrypted technical snapshot and returns authorized material without CRM writes', async () => {
  const result = await storeEvaluationMaterial(input(), context())
  expect(create).toHaveBeenCalledTimes(1)
  expect(create.mock.calls[0][0]).toBe(PhotographerEvaluationMaterial)
  expect(create.mock.calls[0][1]).toMatchObject({ operationId, photographerId, personId, schemaVersion: 1, body: expect.stringMatching(/^sealed:/) })
  expect(await readEvaluationMaterial(result.id, context())).toMatchObject({ id: result.id, evaluationId: requestId, photographerId, personId, ...input().snapshot.material, schemaVersion: 1, updatedAt: '2026-09-19T10:00:00.000Z' })
  expect(jest.mocked(findOneWithDecryption).mock.calls.some((call) => call[1] === CustomerInteraction)).toBe(false)
})

test('replay reuses identical contents and never mutates the original for a changed payload', async () => {
  const first = await storeEvaluationMaterial(input(), context())
  const original = structuredClone(records.get(first.id))
  expect(await storeEvaluationMaterial(input(), context())).toEqual(first)
  expect(create).toHaveBeenCalledTimes(1)
  const changed = input()
  changed.snapshot.material.data.sourceRef = 'different-store-check'
  await expect(storeEvaluationMaterial(changed, context())).rejects.toMatchObject({ status: 409 })
  expect(records.get(first.id)).toEqual(original)
  expect(create).toHaveBeenCalledTimes(1)
})

test('missing snapshot or audit encryption blocks all material writes', async () => {
  encryptEntityPayload.mockImplementation(async (_entity: string, value: Record<string, string>) => value)
  await expect(storeEvaluationMaterial(input(), context())).rejects.toMatchObject({ status: 503 })
  expect(create).not.toHaveBeenCalled()
})

test('legacy interaction-only material IDs are not recovered or silently migrated', async () => {
  await expect(readEvaluationMaterial(operationId, context())).rejects.toMatchObject({ status: 404 })
  expect(create).not.toHaveBeenCalled()
  expect(jest.mocked(findOneWithDecryption).mock.calls.every((call) => call[1] !== CustomerInteraction)).toBe(true)
})

test('wrong tenant is not found and missing CRM permission is denied', async () => {
  const result = await storeEvaluationMaterial(input(), context())
  const other = context()
  other.auth = { ...other.auth!, tenantId: '99999999-9999-4999-8999-999999999999' }
  await expect(readEvaluationMaterial(result.id, other)).rejects.toMatchObject({ status: 404 })
  features = ['photographers.*']
  await expect(readEvaluationMaterial(result.id, context())).rejects.toMatchObject({ status: 403 })
})

test('broken photographer/person relation prevents both writing and reading', async () => {
  const result = await storeEvaluationMaterial(input(), context())
  const original = structuredClone(records.get(result.id))
  entityPresent = false
  await expect(readEvaluationMaterial(result.id, context())).rejects.toMatchObject({ status: 404 })
  await expect(storeEvaluationMaterial(input(), context())).rejects.toMatchObject({ status: 404 })
  expect(records.get(result.id)).toEqual(original)
  entityPresent = true
  expect(await readEvaluationMaterial(result.id, context())).toMatchObject(input().snapshot.material)
})

test('same operation in another organization has different record ids', async () => {
  const first = await storeEvaluationMaterial(input(), context())
  const { materialOperationId } = await import('../lib/material-codec')
  expect(materialOperationId(operationId, `${tenantId}:${organizationId}`)).not.toBe(materialOperationId(operationId, `${tenantId}:${tenantId}`))
  expect(first.id).toBeDefined()
})


test('missing service and throwing KMS fail closed with service unavailable', async () => {
  const noKey = context()
  noKey.container.register({ tenantEncryptionService: asValue(undefined) })
  await expect(storeEvaluationMaterial(input(), noKey)).rejects.toMatchObject({ status: 503 })
  encryptEntityPayload.mockRejectedValue(new Error('KMS unavailable'))
  await expect(storeEvaluationMaterial(input(), context())).rejects.toMatchObject({ status: 503 })
  expect(create).not.toHaveBeenCalled()
})

test('eligibility cannot forge the confirming operator', async () => {
  const forged = input()
  forged.snapshot.material.data.confirmedBy = requestId
  await expect(storeEvaluationMaterial(forged, context())).rejects.toMatchObject({ status: 403 })
  expect(create).not.toHaveBeenCalled()
})

test('missing body encryption fails before persisting a snapshot', async () => {
  encryptEntityPayload.mockImplementation(async (entity: string, value: Record<string, string>) => entity === 'photographers:photographer_evaluation_material'
    ? value
    : Object.fromEntries(Object.entries(value).map(([key, text]) => [key, `sealed:${Buffer.from(text).toString('base64')}`])))
  await expect(storeEvaluationMaterial(input(), context())).rejects.toMatchObject({ status: 503 })
  expect(create).not.toHaveBeenCalled()
})

test('changed stored contents fail integrity validation and cannot be overwritten by replay', async () => {
  const result = await storeEvaluationMaterial(input(), context())
  const original = records.get(result.id)!
  original.body = 'corrupted-data'
  await expect(readEvaluationMaterial(result.id, context())).rejects.toMatchObject({ status: 409 })
  await expect(storeEvaluationMaterial(input(), context())).rejects.toMatchObject({ status: 409 })
  expect(create).toHaveBeenCalledTimes(1)
})

test('a mismatched stored owner is rejected even when the encrypted body is intact', async () => {
  const result = await storeEvaluationMaterial(input(), context())
  records.get(result.id)!.personId = requestId
  await expect(readEvaluationMaterial(result.id, context())).rejects.toMatchObject({ status: 409 })
})

test('an unavailable encryption map blocks reads even when the record exists', async () => {
  const result = await storeEvaluationMaterial(input(), context())
  const ctx = context()
  ctx.container.register({ tenantEncryptionService: asValue({ isEnabled: () => true, getEncryptedFieldNames: async () => [] }) })
  await expect(readEvaluationMaterial(result.id, ctx)).rejects.toMatchObject({ status: 503 })
})

test('evaluation snapshots require a deal while eligibility may precede registration', async () => {
  const { storeMaterialSchema } = await import('../data/material-validators')
  expect(storeMaterialSchema.safeParse(input()).success).toBe(true)
  const research = { operationId, snapshot: { photographerId, personId, material: { kind: 'traces', data: { schemaVersion: 1, evaluationId: requestId, evaluatedAt: '2026-09-19T10:00:00Z', traces: [], discoveryStatus: 'complete' } } } }
  expect(storeMaterialSchema.safeParse(research).success).toBe(false)
})

test.each(['apify_research', 'apify_research_part'] as const)('stores encrypted %s through the existing durable material store', async (kind) => {
  const base = { schemaVersion: 1, evaluationId: requestId, evaluatedAt: '2026-09-20T10:00:00Z', invocationId: operationId }
  const data = kind === 'apify_research' ? {
    ...base, o1RunId: requestId, tracesRef: requestId, workflowInstanceId: requestId, stepId: 'apify_o2', userId,
    state: 'claimed', runId: null, runStatus: null, outcomeStatus: null, payloadRefs: [],
  } : { ...base, index: 0, content: '{"unavailableFields":["posts"],"followersCount":0}' }
  const input = { operationId, snapshot: { photographerId, personId, dealId: requestId, material: { kind, data } } }
  const first = await storeEvaluationMaterial(input, context())
  expect(await storeEvaluationMaterial(input, context())).toEqual(first)
  expect(records.get(first.id)?.body).toMatch(/^sealed:/)
  expect(await readEvaluationMaterial(first.id, context())).toMatchObject({ kind, data, evaluationId: requestId, photographerId })
  expect(create).toHaveBeenCalledTimes(1)
})
