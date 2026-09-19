import { getAuthFromRequest } from '@open-mercato/shared/lib/auth/server'
import { CrudHttpError } from '@open-mercato/shared/lib/crud/errors'
import { readEvaluationMaterial } from '../lib/material-store'
import { GET } from '../api/evaluation-materials/[id]/route'

jest.mock('@open-mercato/shared/lib/auth/server', () => ({ getAuthFromRequest: jest.fn() }))
jest.mock('@open-mercato/shared/lib/di/container', () => ({ createRequestContainer: async () => ({}) }))
jest.mock('@open-mercato/core/modules/directory/utils/organizationScope', () => ({ resolveOrganizationScopeForRequest: async () => ({ selectedId: 'org', filterIds: ['org'] }) }))
jest.mock('@open-mercato/shared/lib/i18n/server', () => ({ resolveTranslations: async () => ({ translate: (key: string) => key }) }))
jest.mock('../lib/material-store', () => ({ readEvaluationMaterial: jest.fn() }))

const id = '11111111-1111-4111-8111-111111111111'
const request = new Request(`https://example.test/api/photographers/evaluation-materials/${id}`)
const routeContext = { params: Promise.resolve({ id }) }

beforeEach(() => {
  jest.clearAllMocks()
  jest.mocked(getAuthFromRequest).mockResolvedValue({ sub: 'user', tenantId: 'tenant', orgId: 'org' })
})

test('rejects unauthenticated requests before reading material', async () => {
  jest.mocked(getAuthFromRequest).mockResolvedValue(null)
  const response = await GET(request, routeContext)
  expect(response.status).toBe(401)
  expect(response.headers.get('cache-control')).toBe('no-store')
  expect(readEvaluationMaterial).not.toHaveBeenCalled()
})

test('returns top-level material contract and private no-store response', async () => {
  const result = { id, kind: 'eligibility' as const, schemaVersion: 1, evaluationId: id, updatedAt: '2026-09-19T10:00:00Z', data: {} }
  jest.mocked(readEvaluationMaterial).mockResolvedValue(result as never)
  const response = await GET(request, routeContext)
  expect(response.status).toBe(200)
  expect(await response.json()).toEqual(result)
  expect(response.headers.get('cache-control')).toBe('no-store')
  expect(readEvaluationMaterial).toHaveBeenCalledWith(id, expect.objectContaining({ selectedOrganizationId: 'org', organizationIds: ['org'] }))
})

test('preserves authorization/not-found/conflict errors without caching', async () => {
  for (const status of [403, 404, 409, 503]) {
    jest.mocked(readEvaluationMaterial).mockRejectedValue(new CrudHttpError(status, { error: 'localized' }))
    const response = await GET(request, routeContext)
    expect(response.status).toBe(status)
    expect(response.headers.get('cache-control')).toBe('no-store')
  }
})

test('validates malformed ids without reading records', async () => {
  const response = await GET(request, { params: Promise.resolve({ id: 'invalid' }) })
  expect(response.status).toBe(400)
  expect(readEvaluationMaterial).not.toHaveBeenCalled()
})
