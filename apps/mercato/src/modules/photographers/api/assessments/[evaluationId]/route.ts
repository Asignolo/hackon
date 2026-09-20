import { ZodError } from 'zod'
import { createRequestContainer } from '@open-mercato/shared/lib/di/container'
import { getAuthFromRequest } from '@open-mercato/shared/lib/auth/server'
import { resolveOrganizationScopeForRequest } from '@open-mercato/core/modules/directory/utils/organizationScope'
import { resolveTranslations } from '@open-mercato/shared/lib/i18n/server'
import { isCrudHttpError } from '@open-mercato/shared/lib/crud/errors'
import type { OpenApiRouteDoc } from '@open-mercato/shared/lib/openapi'
import { assessmentPathSchema, assessmentQuerySchema, assessmentResponseSchema } from '../../../data/assessment-validators'
import { assessmentViewFeatures, readAssessment } from '../../../lib/assessment-read'

export const metadata = { GET: { requireAuth: true, requireFeatures: assessmentViewFeatures } }
export async function GET(request: Request, context: { params: Promise<{ evaluationId: string }> }) {
  const { translate } = await resolveTranslations()
  const headers = { 'Cache-Control': 'no-store' }
  const auth = await getAuthFromRequest(request)
  if (!auth?.tenantId) return Response.json({ error: translate('photographers.errors.unauthorized') }, { status: 401, headers })
  try {
    const path = assessmentPathSchema.parse(await context.params)
    const query = assessmentQuerySchema.parse(Object.fromEntries(new URL(request.url).searchParams))
    const container = await createRequestContainer()
    const organizationScope = await resolveOrganizationScopeForRequest({ container, auth, request })
    const result = await readAssessment({ ...path, ...query }, {
      container, auth, organizationScope, selectedOrganizationId: organizationScope.selectedId ?? auth.orgId ?? null,
      organizationIds: organizationScope.filterIds ?? (auth.orgId ? [auth.orgId] : []), request,
    })
    return Response.json(result, { headers })
  } catch (caught) {
    if (isCrudHttpError(caught)) return Response.json(caught.body, { status: caught.status, headers })
    if (caught instanceof ZodError) return Response.json({ error: translate('photographers.errors.invalid_material') }, { status: 400, headers })
    throw caught
  }
}
export const openApi: OpenApiRouteDoc = {
  tag: 'Photographers', methods: { GET: {
    summary: 'Read saved assessment materials and bound workflow status for one registration',
    pathParams: assessmentPathSchema, query: assessmentQuerySchema,
    responses: [{ status: 200, description: 'Scoped assessment; unavailable o2 contract is explicitly identified; demo fixture payloads excluded', schema: assessmentResponseSchema }],
  } },
}
