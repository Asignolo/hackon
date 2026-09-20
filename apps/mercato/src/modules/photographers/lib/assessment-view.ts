import { z } from 'zod'
import { ForbiddenError, UnauthorizedError } from '@open-mercato/ui/backend/utils/api'
import { apiCall } from '@open-mercato/ui/backend/utils/apiCall'
import { assessmentInputSchema, assessmentResponseSchema, type AssessmentResponse } from '../data/assessment-validators'

export const researchViewSchema = z.object({
  status: z.enum(['waiting', 'partial', 'completed', 'failed', 'unavailable']),
  summary: z.string().nullable(),
  sources: z.array(z.object({ url: z.string(), status: z.enum(['ok', 'partial', 'empty', 'unavailable', 'blocked', 'timeout', 'error']), summary: z.string().nullable() })),
})
export type ResearchView = z.infer<typeof researchViewSchema>
export type AssessmentView = AssessmentResponse & { researchView: ResearchView }
export type AssessmentLoadResult = { state: 'ready'; data: AssessmentView } | { state: 'forbidden' | 'notFound' | 'failed' | 'invalid' }

export function toAssessmentView(response: AssessmentResponse): AssessmentView {
  return { ...response, researchView: { status: response.research.status, summary: response.research.summary ?? null, sources: response.research.sources ?? [] } }
}

export async function loadAssessment(input: unknown, signal?: AbortSignal): Promise<AssessmentLoadResult> {
  const parsed = assessmentInputSchema.safeParse(input)
  if (!parsed.success) return { state: 'invalid' }
  const { evaluationId, registrationId } = parsed.data
  const response = await apiCall<unknown>(`/api/photographers/assessments/${encodeURIComponent(evaluationId)}?registrationId=${encodeURIComponent(registrationId)}`, { cache: 'no-store', signal }).catch((caught: unknown) => {
    if (caught instanceof ForbiddenError || caught instanceof UnauthorizedError) return { ok: false, status: caught.status, result: null }
    throw caught
  })
  if (response.status === 401 || response.status === 403) return { state: 'forbidden' }
  if (response.status === 404) return { state: 'notFound' }
  if (!response.ok) return { state: 'failed' }
  const result = assessmentResponseSchema.safeParse(response.result)
  if (!result.success || result.data.evaluationId !== evaluationId || result.data.registration.id !== registrationId) return { state: 'failed' }
  return { state: 'ready', data: toAssessmentView(result.data) }
}

export function safeSourceHref(value: string): string | undefined {
  try {
    const url = new URL(value)
    return ['https:', 'http:'].includes(url.protocol) && !url.username && !url.password ? url.href : undefined
  } catch { return undefined }
}
