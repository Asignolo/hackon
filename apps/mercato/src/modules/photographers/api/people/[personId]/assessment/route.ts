import type { OpenApiRouteDoc } from '@open-mercato/shared/lib/openapi'
import { personAssessmentPathSchema, personAssessmentResponseSchema } from '../../../../data/person-assessment-validators'
import { assessmentViewFeatures } from '../../../../lib/assessment-read'
import { demoErrorResponse, demoHeaders, demoRequestContext } from '../../../../lib/demo-api'
import { readPersonAssessment } from '../../../../lib/person-assessment-read'

export const metadata = { GET: { requireAuth: true, requireFeatures: assessmentViewFeatures } }

export async function GET(request: Request, context: { params: Promise<{ personId: string }> }) {
  try {
    const ctx = await demoRequestContext(request)
    const result = await readPersonAssessment(personAssessmentPathSchema.parse(await context.params), ctx)
    return Response.json(personAssessmentResponseSchema.parse(result), { headers: demoHeaders })
  } catch (error) { return demoErrorResponse(error) }
}

export const openApi: OpenApiRouteDoc = {
  tag: 'Photographers', methods: { GET: {
    summary: 'Find the latest saved assessment for a CRM person',
    pathParams: personAssessmentPathSchema,
    responses: [{ status: 200, description: 'Latest scoped assessment binding, or null when absent', schema: personAssessmentResponseSchema }],
  } },
}
