import { ForbiddenError, UnauthorizedError } from '@open-mercato/ui/backend/utils/api'
import { apiCall } from '@open-mercato/ui/backend/utils/apiCall'
import { loadAssessment, safeSourceHref, toAssessmentView } from '../lib/assessment-view'
import type { AssessmentResponse } from '../data/assessment-validators'

jest.mock('@open-mercato/ui/backend/utils/apiCall', () => ({ apiCall: jest.fn() }))
const evaluationId = '11111111-1111-4111-8111-111111111111'
const registrationId = '22222222-2222-4222-8222-222222222222'
const timestamp = '2026-09-20T10:00:00.000Z'
const missing = { status: 'missing' as const, id: null, data: null }
function response(): AssessmentResponse {
  return {
    evaluationId, registration: { id: registrationId, firstName: 'Anna', lastName: 'Photo', email: 'anna@example.test', portfolioRaw: '', submittedAt: timestamp, updatedAt: timestamp },
    owners: null, source: 'real', process: { workflowInstanceId: evaluationId, status: 'pending', currentStepId: null, errorCode: null }, stages: [],
    materials: { traces: missing, facts: missing, score: missing, summary: missing }, research: { status: 'unavailable', reason: 'contract_pending' },
  }
}
function apiResult(result: unknown, status = 200) {
  return { ok: status >= 200 && status < 300, status, result, response: new Response(null, { status }), cacheStatus: null }
}
beforeEach(() => jest.resetAllMocks())

it('loads only the selected evaluation and registration with an abort signal and no cache', async () => {
  const controller = new AbortController()
  jest.mocked(apiCall).mockResolvedValue(apiResult(response()))
  const result = await loadAssessment({ evaluationId, registrationId }, controller.signal)
  expect(apiCall).toHaveBeenCalledWith(`/api/photographers/assessments/${evaluationId}?registrationId=${registrationId}`, { cache: 'no-store', signal: controller.signal })
  expect(result).toEqual({ state: 'ready', data: toAssessmentView(response()) })
  expect(result.state === 'ready' && result.data.process.status).toBe('pending')
})

it.each([null, {}, { evaluationId: 'bad', registrationId }, { evaluationId }])('rejects invalid input without a request: %p', async (input) => {
  expect(await loadAssessment(input)).toEqual({ state: 'invalid' })
  expect(apiCall).not.toHaveBeenCalled()
})

it.each([[401, 'forbidden'], [403, 'forbidden'], [404, 'notFound'], [500, 'failed']] as const)('maps HTTP %s to %s', async (status, state) => {
  jest.mocked(apiCall).mockResolvedValue(apiResult(null, status))
  expect(await loadAssessment({ evaluationId, registrationId })).toEqual({ state })
})

it.each(['evaluation', 'registration', 'malformed'])('rejects a %s response mismatch', async (kind) => {
  const body = response()
  if (kind === 'evaluation') body.evaluationId = registrationId
  if (kind === 'registration') body.registration.id = evaluationId
  jest.mocked(apiCall).mockResolvedValue(apiResult(kind === 'malformed' ? { ...body, process: {} } : body))
  expect(await loadAssessment({ evaluationId, registrationId })).toEqual({ state: 'failed' })
})

it('keeps missing o2 unavailable even for a completed workflow', () => {
  const body = response()
  body.process.status = 'completed'
  expect(toAssessmentView(body).researchView).toEqual({ status: 'unavailable', sources: [], summary: null })
})

it.each(['javascript:alert(1)', 'data:text/html,test', '//example.test', '/relative', 'https://user:password@example.test', 'not a URL'])('does not link unsafe source %s', (value) => {
  expect(safeSourceHref(value)).toBeUndefined()
})
it('allows public HTTP and HTTPS source URLs', () => {
  expect(safeSourceHref('https://example.test/portfolio')).toBe('https://example.test/portfolio')
  expect(safeSourceHref('http://example.test')).toBe('http://example.test/')
})

it.each([new ForbiddenError(), new UnauthorizedError()])('maps shared transport auth exceptions to denied access', async (error) => {
  jest.mocked(apiCall).mockRejectedValue(error)
  expect(await loadAssessment({ evaluationId, registrationId })).toEqual({ state: 'forbidden' })
})
