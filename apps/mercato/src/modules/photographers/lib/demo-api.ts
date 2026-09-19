import { ZodError } from 'zod'
import { createRequestContainer } from '@open-mercato/shared/lib/di/container'
import { getAuthFromRequest } from '@open-mercato/shared/lib/auth/server'
import { resolveOrganizationScopeForRequest } from '@open-mercato/core/modules/directory/utils/organizationScope'
import type { RbacService } from '@open-mercato/core/modules/auth/services/rbacService'
import { resolveTranslations } from '@open-mercato/shared/lib/i18n/server'
import { CrudHttpError, isCrudHttpError } from '@open-mercato/shared/lib/crud/errors'
import { getCommandInterceptorHttpRejection, type CommandRuntimeContext } from '@open-mercato/shared/lib/commands'
import { requirePhotographerScope } from './scope'

export const demoViewFeatures = ['photographers.view', 'photographers.evaluations.view', 'customers.people.view', 'customers.deals.view', 'agent_orchestrator.processes.view', 'agent_orchestrator.trace.view', 'agent_orchestrator.proposals.view', 'workflows.instances.view']
export const demoRunFeatures = [...demoViewFeatures, 'photographers.create', 'photographers.evaluations.run', 'photographers.evaluations.manage', 'customers.people.manage', 'customers.deals.manage', 'customers.interactions.view', 'customers.interactions.manage', 'customers.pipelines.view', 'configs.manage', 'agent_orchestrator.processes.manage', 'agent_orchestrator.processes.run']
export const demoHeaders = { 'Cache-Control': 'no-store' }

export async function authorizeDemo(ctx: CommandRuntimeContext, write: boolean) {
  const { translate } = await resolveTranslations()
  if (!ctx.auth?.sub) throw new CrudHttpError(401, { error: translate('photographers.errors.unauthorized') })
  const scope = await requirePhotographerScope(ctx)
  const allowed = await ctx.container.resolve<RbacService>('rbacService').userHasAllFeatures(ctx.auth.sub, write ? demoRunFeatures : demoViewFeatures, scope)
  if (!allowed) throw new CrudHttpError(403, { error: translate('photographers.errors.forbidden') })
  return scope
}

export async function demoRequestContext(request: Request): Promise<CommandRuntimeContext> {
  const { translate } = await resolveTranslations()
  const auth = await getAuthFromRequest(request)
  if (!auth?.tenantId) throw new CrudHttpError(401, { error: translate('photographers.errors.unauthorized') })
  const container = await createRequestContainer()
  const organizationScope = await resolveOrganizationScopeForRequest({ container, auth, request })
  return { container, auth, request, organizationScope, selectedOrganizationId: organizationScope.selectedId ?? auth.orgId ?? null, organizationIds: organizationScope.filterIds ?? (auth.orgId ? [auth.orgId] : []) }
}

export async function demoErrorResponse(error: unknown): Promise<Response> {
  if (isCrudHttpError(error)) return Response.json(error.body, { status: error.status, headers: demoHeaders })
  const rejection = getCommandInterceptorHttpRejection(error)
  if (rejection) return Response.json(rejection.body, { status: rejection.status, headers: demoHeaders })
  if (error instanceof ZodError) {
    const { translate } = await resolveTranslations()
    return Response.json({ error: translate('photographers.demo.invalid_request') }, { status: 400, headers: demoHeaders })
  }
  throw error
}
