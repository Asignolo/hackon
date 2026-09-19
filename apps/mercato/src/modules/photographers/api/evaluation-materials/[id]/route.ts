import { ZodError } from 'zod'
import { createRequestContainer } from '@open-mercato/shared/lib/di/container'
import { getAuthFromRequest } from '@open-mercato/shared/lib/auth/server'
import { resolveOrganizationScopeForRequest } from '@open-mercato/core/modules/directory/utils/organizationScope'
import { resolveTranslations } from '@open-mercato/shared/lib/i18n/server'
import { isCrudHttpError } from '@open-mercato/shared/lib/crud/errors'
import type { OpenApiRouteDoc } from '@open-mercato/shared/lib/openapi'
import { materialQuerySchema } from '../../../data/evaluation-validators'
import { materialResponseSchema } from '../../../data/material-validators'
import { readEvaluationMaterial } from '../../../lib/material-store'

export const metadata = {
  GET: { requireAuth: true, requireFeatures: ['photographers.evaluations.view', 'customers.people.view', 'customers.deals.view', 'customers.interactions.view'] },
}

export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  const { translate } = await resolveTranslations()
  const headers = { 'Cache-Control': 'no-store' }
  const auth = await getAuthFromRequest(request)
  if (!auth?.tenantId) return Response.json({ error: translate('photographers.errors.unauthorized') }, { status: 401, headers })
  try {
    const { id } = materialQuerySchema.parse(await context.params)
    const container = await createRequestContainer()
    const organizationScope = await resolveOrganizationScopeForRequest({ container, auth, request })
    const selectedOrganizationId = organizationScope.selectedId ?? auth.orgId ?? null
    const result = await readEvaluationMaterial(id, {
      container, auth, organizationScope, selectedOrganizationId,
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
  tag: 'Photographers',
  methods: {
    GET: {
      summary: 'Read an authorized photographer evaluation material',
      pathParams: materialQuerySchema,
      responses: [{ status: 200, description: 'Decrypted, integrity-checked material', schema: materialResponseSchema }]
    },
  },
}
