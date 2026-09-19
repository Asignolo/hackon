import type { CommandBus } from '@open-mercato/shared/lib/commands'
import type { RbacService } from '@open-mercato/core/modules/auth/services/rbacService'
import { runRouteMutationGuards } from '@open-mercato/shared/lib/crud/route-mutation-guard'
import type { OpenApiRouteDoc } from '@open-mercato/shared/lib/openapi'
import { demoExecutionSchema, demoRequestSchema } from '../../../data/demo-api-validators'
import { authorizeDemo, demoErrorResponse, demoHeaders, demoRequestContext, demoRunFeatures, demoViewFeatures } from '../../../lib/demo-api'
import { getPhotographerDemoExecution } from '../../../lib/demo-workflow-runtime'

type RouteContext = { params: Promise<{ requestId: string }> }
export const metadata = {
  GET: { requireAuth: true, requireFeatures: demoViewFeatures },
  POST: { requireAuth: true, requireFeatures: demoRunFeatures },
}

export async function GET(request: Request, context: RouteContext) {
  try {
    const ctx = await demoRequestContext(request)
    await authorizeDemo(ctx, false)
    const { requestId } = demoRequestSchema.parse(await context.params)
    return Response.json(demoExecutionSchema.parse(await getPhotographerDemoExecution(requestId, ctx)), { headers: demoHeaders })
  } catch (error) { return demoErrorResponse(error) }
}

export async function POST(request: Request, context: RouteContext) {
  try {
    const ctx = await demoRequestContext(request)
    const scope = await authorizeDemo(ctx, true)
    const input = demoRequestSchema.parse(await context.params)
    const userFeatures = await ctx.container.resolve<RbacService>('rbacService').getGrantedFeatures(ctx.auth!.sub, scope)
    const guard = await runRouteMutationGuards({
      container: ctx.container, req: request, auth: { ...scope, userId: ctx.auth!.sub, userFeatures },
      input: { resourceKind: 'photographers:demo_execution', resourceId: input.requestId, operation: 'update', mutationPayload: input },
    })
    if (!guard.ok) return guard.response
    const payload = demoRequestSchema.parse({ ...input, ...guard.modifiedPayload })
    const result = await ctx.container.resolve<CommandBus>('commandBus').execute('photographers.demo.reconcile', { input: payload, ctx })
    await guard.runAfterSuccess()
    return Response.json(demoExecutionSchema.parse(result.result), { headers: demoHeaders })
  } catch (error) { return demoErrorResponse(error) }
}

export const openApi: OpenApiRouteDoc = {
  tag: 'Photographers',
  methods: {
    GET: { summary: 'Read a photographer demonstration', pathParams: demoRequestSchema, responses: [{ status: 200, description: 'Current demonstration state', schema: demoExecutionSchema }] },
    POST: { summary: 'Resume unfinished work for an existing demonstration', pathParams: demoRequestSchema, responses: [{ status: 200, description: 'Current demonstration state', schema: demoExecutionSchema }] },
  },
}
