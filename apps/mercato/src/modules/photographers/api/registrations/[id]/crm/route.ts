import { z, ZodError } from 'zod'
import type { CommandBus } from '@open-mercato/shared/lib/commands'
import type { RbacService } from '@open-mercato/core/modules/auth/services/rbacService'
import { runRouteMutationGuards } from '@open-mercato/shared/lib/crud/route-mutation-guard'
import { readJsonSafe } from '@open-mercato/shared/lib/http/readJsonSafe'
import type { OpenApiRouteDoc } from '@open-mercato/shared/lib/openapi'
import { resolveTranslations } from '@open-mercato/shared/lib/i18n/server'
import { registrationCrmInputSchema, registrationCrmResponseSchema } from '../../../../data/registration-crm-validators'
import { authorizeRegistrationCrm, readRegistrationCrm, registrationCrmError, registrationCrmViewFeatures, registrationCrmWriteFeatures } from '../../../../lib/registration-crm'
import { demoRequestContext, demoErrorResponse } from '../../../../lib/demo-api'

const paramsSchema = z.object({ id: z.string().uuid() }).strict()
const bodySchema = z.object({}).strict()
const headers = { 'Cache-Control': 'no-store' }
type RouteContext = { params: Promise<{ id: string }> }
export const metadata = {
  GET: { requireAuth: true, requireFeatures: registrationCrmViewFeatures },
  POST: { requireAuth: true, requireFeatures: registrationCrmWriteFeatures },
}

async function errorResponse(error: unknown) {
  if (error instanceof ZodError) {
    const { translate } = await resolveTranslations()
    return Response.json({ error: translate('photographers.errors.registration_crm_invalid') }, { status: 400, headers })
  }
  return demoErrorResponse(error)
}

export async function GET(request: Request, context: RouteContext) {
  try {
    const { id } = paramsSchema.parse(await context.params)
    const ctx = await demoRequestContext(request)
    const result = await readRegistrationCrm({ registrationId: id }, ctx)
    return Response.json(registrationCrmResponseSchema.parse(result), { headers })
  } catch (error) { return errorResponse(error) }
}

export async function POST(request: Request, context: RouteContext) {
  try {
    const { id } = paramsSchema.parse(await context.params)
    bodySchema.parse(await readJsonSafe(request))
    const ctx = await demoRequestContext(request)
    const scope = await authorizeRegistrationCrm(ctx, true)
    const userFeatures = await ctx.container.resolve<RbacService>('rbacService').getGrantedFeatures(ctx.auth!.sub, scope)
    const input = { registrationId: id }
    const guard = await runRouteMutationGuards({ container: ctx.container, req: request, auth: { ...scope, userId: ctx.auth!.sub, userFeatures },
      input: { resourceKind: 'photographers:registration', resourceId: id, operation: 'update', mutationPayload: input },
    })
    if (!guard.ok) return guard.response
    const payload = registrationCrmInputSchema.parse({ ...input, ...guard.modifiedPayload })
    if (payload.registrationId !== id) return await registrationCrmError(409, 'registration_crm_conflict')
    const result = await ctx.container.resolve<CommandBus>('commandBus').execute('photographers.registration.prepare_crm', { input: payload, ctx })
    await guard.runAfterSuccess()
    return Response.json(registrationCrmResponseSchema.parse(result.result), { headers })
  } catch (error) { return errorResponse(error) }
}

export const openApi: OpenApiRouteDoc = {
  tag: 'Photographers',
  methods: {
    GET: { summary: 'Read CRM links for a photographer registration', pathParams: paramsSchema, responses: [{ status: 200, description: 'Registration CRM state', schema: registrationCrmResponseSchema }] },
    POST: { summary: 'Prepare or recover CRM links without starting an evaluation', pathParams: paramsSchema, requestBody: { contentType: 'application/json', schema: bodySchema }, responses: [{ status: 200, description: 'CRM prepared', schema: registrationCrmResponseSchema }] },
  },
}
