import { z } from 'zod'
import type { EntityManager } from '@mikro-orm/postgresql'
import type { CommandRuntimeContext } from '@open-mercato/shared/lib/commands'
import { CrudHttpError } from '@open-mercato/shared/lib/crud/errors'
import { findOneWithDecryption } from '@open-mercato/shared/lib/encryption/find'
import { resolveTranslations } from '@open-mercato/shared/lib/i18n/server'
import type { RbacService } from '@open-mercato/core/modules/auth/services/rbacService'
import type { ModuleConfigService } from '@open-mercato/core/modules/configs/lib/module-config-service'
import { CustomerPipeline, CustomerPipelineStage } from '@open-mercato/core/modules/customers/data/entities'
import { requirePhotographerScope } from './scope'

const installationSchema = z.object({
  pipelineId: z.string().uuid(),
  stageIds: z.object({ new: z.string().uuid(), observed: z.string().uuid(), contact_ready: z.string().uuid(), contacted: z.string().uuid() }),
})

export async function requireDemoInstallation(ctx: CommandRuntimeContext) {
  const scope = await requirePhotographerScope(ctx)
  const { translate } = await resolveTranslations()
  if (!ctx.auth?.sub || !await ctx.container.resolve<RbacService>('rbacService').userHasAllFeatures(ctx.auth.sub, ['customers.pipelines.view'], scope)) {
    throw new CrudHttpError(403, { error: translate('photographers.errors.forbidden') })
  }
  const config = await ctx.container.resolve<ModuleConfigService>('moduleConfigService').getValue('photographers', `hidden_potential_installation_${scope.organizationId}`, { scope })
  const parsed = installationSchema.safeParse(config)
  const unavailable = () => new CrudHttpError(503, { error: translate('photographers.errors.demo_unavailable') })
  if (!parsed.success) throw unavailable()
  const installation = parsed.data
  const em = ctx.container.resolve<EntityManager>('em').fork()
  const pipeline = await findOneWithDecryption(em, CustomerPipeline, { id: installation.pipelineId, ...scope }, {}, scope)
  const stageIds = Object.values(installation.stageIds)
  if (!pipeline || new Set(stageIds).size !== stageIds.length) throw unavailable()
  for (const id of stageIds) {
    const stage = await findOneWithDecryption(em, CustomerPipelineStage, { id, pipelineId: installation.pipelineId, ...scope }, {}, scope)
    if (!stage) throw unavailable()
  }
  return installation
}
