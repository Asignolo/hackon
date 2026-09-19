import type { CommandRuntimeContext } from '@open-mercato/shared/lib/commands'
import { CrudHttpError } from '@open-mercato/shared/lib/crud/errors'
import { resolveTranslations } from '@open-mercato/shared/lib/i18n/server'

export async function requirePhotographerScope(ctx: Pick<CommandRuntimeContext, 'auth' | 'selectedOrganizationId' | 'organizationIds'>) {
  const { translate } = await resolveTranslations()
  const tenantId = ctx.auth?.tenantId
  const organizationId = ctx.selectedOrganizationId ?? ctx.auth?.orgId
  if (!tenantId || !organizationId) {
    throw new CrudHttpError(400, { error: translate('photographers.errors.scope_required') })
  }
  if (ctx.organizationIds !== null && !ctx.organizationIds.includes(organizationId)) {
    throw new CrudHttpError(403, { error: translate('photographers.errors.forbidden') })
  }
  return { tenantId, organizationId }
}
