import { getAuthFromRequest } from '@open-mercato/shared/lib/auth/server'
import { CrudHttpError } from '@open-mercato/shared/lib/crud/errors'
import { readProposalReviewMaterials } from '../lib/proposal-review-access'
import { GET, metadata, openApi } from '../api/proposals/[id]/materials/route'

jest.mock('@open-mercato/shared/lib/auth/server', () => ({ getAuthFromRequest: jest.fn() }))
jest.mock('@open-mercato/shared/lib/di/container', () => ({ createRequestContainer: async () => ({}) }))
jest.mock('@open-mercato/core/modules/directory/utils/organizationScope', () => ({ resolveOrganizationScopeForRequest: async () => ({ selectedId: 'org', filterIds: ['org'] }) }))
jest.mock('@open-mercato/shared/lib/i18n/server', () => ({ resolveTranslations: async () => ({ translate: (key: string) => key }) }))
jest.mock('../lib/proposal-review-access', () => ({ readProposalReviewMaterials: jest.fn() }))

const id = '11111111-1111-4111-8111-111111111111'
const request = new Request(`https://example.test/api/photographers/proposals/${id}/materials`)
const routeContext = { params: Promise.resolve({ id }) }

beforeEach(() => {
  jest.clearAllMocks()
  jest.mocked(getAuthFromRequest).mockResolvedValue({ sub: 'user', tenantId: 'tenant', orgId: 'org' })
})

test('declares proposal, material, CRM permissions and typed successful response', () => {
  expect(metadata.GET.requireFeatures).toEqual(expect.arrayContaining(['agent_orchestrator.proposals.view', 'photographers.evaluations.view', 'customers.people.view', 'customers.deals.view', 'customers.interactions.view']))
  expect(openApi.methods.GET?.responses?.[0].status).toBe(200)
})

test('unauthenticated and malformed requests never read or acknowledge materials', async () => {
  jest.mocked(getAuthFromRequest).mockResolvedValue(null)
  const response = await GET(request, routeContext)
  expect(response.status).toBe(401)
  expect(response.headers.get('cache-control')).toBe('no-store')
  expect(readProposalReviewMaterials).not.toHaveBeenCalled()
  jest.mocked(getAuthFromRequest).mockResolvedValue({ sub: 'user', tenantId: 'tenant', orgId: 'org' })
  expect((await GET(request, { params: Promise.resolve({ id: 'invalid' }) })).status).toBe(400)
  expect(readProposalReviewMaterials).not.toHaveBeenCalled()
})

test('returns scoped material response and hides unrelated proposals through empty options', async () => {
  const result = { proposalId: id, proposalUpdatedAt: '2026-09-19T12:00:00.000Z', options: [] }
  jest.mocked(readProposalReviewMaterials).mockResolvedValue(result)
  const response = await GET(request, routeContext)
  expect(response.status).toBe(200)
  expect(await response.json()).toEqual(result)
  expect(response.headers.get('cache-control')).toBe('no-store')
  expect(readProposalReviewMaterials).toHaveBeenCalledWith(id, expect.objectContaining({ selectedOrganizationId: 'org', organizationIds: ['org'] }))
})

test.each([403, 404, 409, 503])('material failure %s is never cached or converted to success', async (status) => {
  jest.mocked(readProposalReviewMaterials).mockRejectedValue(new CrudHttpError(status, { error: 'localized' }))
  const response = await GET(request, routeContext)
  expect(response.status).toBe(status)
  expect(response.headers.get('cache-control')).toBe('no-store')
})
