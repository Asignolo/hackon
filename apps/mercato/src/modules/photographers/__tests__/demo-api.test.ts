import { getAuthFromRequest } from '@open-mercato/shared/lib/auth/server'
import { runRouteMutationGuards } from '@open-mercato/shared/lib/crud/route-mutation-guard'
import { CrudHttpError } from '@open-mercato/shared/lib/crud/errors'
import { POST } from '../api/demo-evaluations/route'
import { GET, POST as reconcile } from '../api/demo-evaluations/[requestId]/route'
import { getPhotographerDemoExecution } from '../lib/demo-workflow-runtime'

const execute = jest.fn()
const userHasAllFeatures = jest.fn()
const afterSuccess = jest.fn()
jest.mock('@open-mercato/shared/lib/auth/server', () => ({ getAuthFromRequest: jest.fn() }))
jest.mock('@open-mercato/shared/lib/di/container', () => ({ createRequestContainer: async () => ({ resolve: (name: string) => name === 'commandBus' ? { execute } : { userHasAllFeatures, getGrantedFeatures: async () => ['*'] } }) }))
jest.mock('@open-mercato/core/modules/directory/utils/organizationScope', () => ({ resolveOrganizationScopeForRequest: async () => ({ selectedId: 'organization', filterIds: ['organization'] }) }))
jest.mock('@open-mercato/shared/lib/i18n/server', () => ({ resolveTranslations: async () => ({ translate: (key: string) => key }) }))
jest.mock('@open-mercato/shared/lib/crud/route-mutation-guard', () => ({ runRouteMutationGuards: jest.fn() }))
jest.mock('../lib/demo-workflow-runtime', () => ({ getPhotographerDemoExecution: jest.fn() }))

const requestId = '11111111-1111-4111-8111-111111111111'
const alternateId = '22222222-2222-4222-8222-222222222222'
const context = { params: Promise.resolve({ requestId }) }
const execution = {
  requestId, executionId: requestId, workflowInstanceId: null, status: 'starting' as const,
  registrationId: requestId, photographerId: requestId, personId: requestId, dealId: requestId, evaluationId: requestId,
  runIds: [], proposalId: null, materialRefs: {}, links: { person: `/backend/customers/people/${requestId}`, deal: `/backend/customers/deals/${requestId}` },
}
const request = (body: unknown = { requestId }) => new Request('https://example.test/api/photographers/demo-evaluations', { method: 'POST', body: JSON.stringify(body) })

beforeEach(() => {
  jest.clearAllMocks()
  jest.mocked(getAuthFromRequest).mockResolvedValue({ sub: 'operator', tenantId: 'tenant', orgId: 'organization' })
  userHasAllFeatures.mockResolvedValue(true)
  jest.mocked(runRouteMutationGuards).mockResolvedValue({ ok: true, runAfterSuccess: afterSuccess })
  execute.mockResolvedValue({ result: execution })
  jest.mocked(getPhotographerDemoExecution).mockResolvedValue(execution)
})

test('unauthenticated or unauthorized requests create nothing', async () => {
  jest.mocked(getAuthFromRequest).mockResolvedValue(null)
  expect((await POST(request())).status).toBe(401)
  jest.mocked(getAuthFromRequest).mockResolvedValue({ sub: 'operator', tenantId: 'tenant', orgId: 'organization' })
  userHasAllFeatures.mockResolvedValue(false)
  expect((await POST(request())).status).toBe(403)
  expect(execute).not.toHaveBeenCalled()
})

test('only accepts a request ID, never user-supplied real photographer data', async () => {
  expect((await POST(request({ requestId, email: 'person@example.test' }))).status).toBe(400)
  expect(execute).not.toHaveBeenCalled()
})

test('honors registry guard rejection before the start command', async () => {
  jest.mocked(runRouteMutationGuards).mockResolvedValue({ ok: false, errorStatus: 409, errorBody: { error: 'blocked' }, response: Response.json({ error: 'blocked' }, { status: 409 }) })
  expect((await POST(request())).status).toBe(409)
  expect(execute).not.toHaveBeenCalled()
  expect(afterSuccess).not.toHaveBeenCalled()
})

test('passes transformed validated input and the authenticated organization to the command', async () => {
  jest.mocked(runRouteMutationGuards).mockResolvedValue({ ok: true, modifiedPayload: { requestId: alternateId }, runAfterSuccess: afterSuccess })
  const response = await POST(request())
  expect(response.status).toBe(202)
  expect(response.headers.get('cache-control')).toBe('no-store')
  expect(execute).toHaveBeenCalledWith('photographers.demo.start', expect.objectContaining({ input: { requestId: alternateId }, ctx: expect.objectContaining({ selectedOrganizationId: 'organization', organizationIds: ['organization'] }) }))
  expect(afterSuccess).toHaveBeenCalledTimes(1)
})

test('status reads do not trigger reconciliation and preserve scoped not-found responses', async () => {
  jest.mocked(getPhotographerDemoExecution).mockRejectedValue(new CrudHttpError(404, { error: 'not found' }))
  const response = await GET(new Request('https://example.test'), context)
  expect(response.status).toBe(404)
  expect(execute).not.toHaveBeenCalled()
})

test('explicit recovery uses mutation guards and the existing request, without creating a new demo', async () => {
  const response = await reconcile(request({}), context)
  expect(response.status).toBe(200)
  expect(execute).toHaveBeenCalledWith('photographers.demo.reconcile', expect.objectContaining({ input: { requestId } }))
  expect(runRouteMutationGuards).toHaveBeenCalledWith(expect.objectContaining({ input: expect.objectContaining({ resourceId: requestId, operation: 'update' }) }))
})


test('uses the same canonical request ID for start and subsequent reads', async () => {
  const mixedCaseId = 'ABCDABCD-1111-4111-8111-111111111111'
  await POST(request({ requestId: mixedCaseId }))
  expect(execute).toHaveBeenCalledWith('photographers.demo.start', expect.objectContaining({ input: { requestId: mixedCaseId.toLowerCase() } }))
  await GET(new Request('https://example.test'), { params: Promise.resolve({ requestId: mixedCaseId }) })
  expect(getPhotographerDemoExecution).toHaveBeenCalledWith(mixedCaseId.toLowerCase(), expect.anything())
})

test('accepts an existing registration reference without copying source data into the request', async () => {
  const response = await POST(request({ requestId, registrationId: alternateId }))
  expect(response.status).toBe(202)
  expect(execute).toHaveBeenCalledWith('photographers.demo.start', expect.objectContaining({ input: { requestId, registrationId: alternateId } }))
})
