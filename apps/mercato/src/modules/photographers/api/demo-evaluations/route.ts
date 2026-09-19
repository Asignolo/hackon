import type { CommandBus } from '@open-mercato/shared/lib/commands'
import type { RbacService } from '@open-mercato/core/modules/auth/services/rbacService'
import { readJsonSafe } from '@open-mercato/shared/lib/http/readJsonSafe'
import { runRouteMutationGuards } from '@open-mercato/shared/lib/crud/route-mutation-guard'
import type { OpenApiRouteDoc } from '@open-mercato/shared/lib/openapi'
import { demoExecutionSchema, demoRequestSchema } from '../../data/demo-api-validators'
import { authorizeDemo, demoErrorResponse, demoHeaders, demoRequestContext, demoRunFeatures } from '../../lib/demo-api'

export const metadata = { POST: { requireAuth: true, requireFeatures: demoRunFeatures } }

export async function POST(request: Request) {
  try {
    const ctx = await demoRequestContext(request)
    const scope = await authorizeDemo(ctx, true)
    const input = demoRequestSchema.parse(await readJsonSafe(request))
    const userFeatures = await ctx.container.resolve<RbacService>('rbacService').getGrantedFeatures(ctx.auth!.sub, scope)
    const guard = await runRouteMutationGuards({
      container: ctx.container, req: request, auth: { ...scope, userId: ctx.auth!.sub, userFeatures },
      input: { resourceKind: 'photographers:demo_execution', resourceId: input.requestId, operation: 'create', mutationPayload: input },
    })
    if (!guard.ok) return guard.response
    const payload = demoRequestSchema.parse({ ...input, ...guard.modifiedPayload })
    const result = await ctx.container.resolve<CommandBus>('commandBus').execute('photographers.demo.start', { input: payload, ctx })
    await guard.runAfterSuccess()
    return Response.json(demoExecutionSchema.parse(result.result), { status: 202, headers: demoHeaders })
  } catch (error) { return demoErrorResponse(error) }
}

export const openApi: OpenApiRouteDoc = {
  tag: 'Photographers',
  methods: { POST: { summary: 'Start a synthetic photographer demonstration', requestBody: { contentType: 'application/json', schema: demoRequestSchema }, responses: [{ status: 202, description: 'Demonstration accepted', schema: demoExecutionSchema }] } },
}
