import { getAuthFromRequest } from '@open-mercato/shared/lib/auth/server'
import { CrudHttpError } from '@open-mercato/shared/lib/crud/errors'
import { readAssessment } from '../lib/assessment-read'
import { GET } from '../api/assessments/[evaluationId]/route'
jest.mock('@open-mercato/shared/lib/auth/server', () => ({ getAuthFromRequest: jest.fn() }))
jest.mock('@open-mercato/shared/lib/di/container', () => ({ createRequestContainer: async () => ({}) }))
jest.mock('@open-mercato/core/modules/directory/utils/organizationScope', () => ({ resolveOrganizationScopeForRequest: async () => ({ selectedId: 'org', filterIds: ['org'] }) }))
jest.mock('@open-mercato/shared/lib/i18n/server', () => ({ resolveTranslations: async () => ({ translate: (key: string) => key }) }))
jest.mock('../lib/assessment-read', () => ({ readAssessment: jest.fn(), assessmentViewFeatures: ['photographers.evaluations.view'] }))
const evaluationId = '11111111-1111-4111-8111-111111111111'
const registrationId = '22222222-2222-4222-8222-222222222222'
const url = `https://example.test/api/photographers/assessments/${evaluationId}`
const request = new Request(`${url}?registrationId=${registrationId}`)
const routeContext = { params: Promise.resolve({ evaluationId }) }
beforeEach(() => { jest.clearAllMocks(); jest.mocked(getAuthFromRequest).mockResolvedValue({ sub: 'user', tenantId: 'tenant', orgId: 'org' }) })
test('requires authentication', async () => {
  jest.mocked(getAuthFromRequest).mockResolvedValue(null)
  expect((await GET(request, routeContext)).status).toBe(401)
  expect(readAssessment).not.toHaveBeenCalled()
})
test('requires registration binding', async () => {
  expect((await GET(new Request(url), routeContext)).status).toBe(400)
  expect(readAssessment).not.toHaveBeenCalled()
})
test('returns scoped private result', async () => {
  jest.mocked(readAssessment).mockResolvedValue({ evaluationId } as never)
  const response = await GET(request, routeContext)
  expect(response.status).toBe(200); expect(response.headers.get('cache-control')).toBe('no-store')
  expect(readAssessment).toHaveBeenCalledWith({ evaluationId, registrationId }, expect.objectContaining({ selectedOrganizationId: 'org', organizationIds: ['org'] }))
})
test.each([403, 404, 409, 503])('preserves service error %s', async (status) => {
  jest.mocked(readAssessment).mockRejectedValue(new CrudHttpError(status, { error: 'localized' }))
  const response = await GET(request, routeContext)
  expect(response.status).toBe(status); expect(response.headers.get('cache-control')).toBe('no-store')
})
