import { z } from 'zod'
import type { CommandBus, CommandRuntimeContext } from '@open-mercato/shared/lib/commands'
import type { InitSetupContext } from '@open-mercato/shared/modules/setup'
import type { CacheStrategy } from '@open-mercato/cache'
import { invalidateDefinitionsCache } from '@open-mercato/core/modules/entities/api/definitions.cache'
import type { ModuleConfigService } from '@open-mercato/core/modules/configs/lib/module-config-service'
import { CustomerPipeline, CustomerPipelineStage } from '@open-mercato/core/modules/customers/data/entities'
import { ensureCustomFieldDefinitions } from '@open-mercato/core/modules/entities/lib/field-definitions'
import { findOneWithDecryption, findWithDecryption } from '@open-mercato/shared/lib/encryption/find'
import { resolveTranslations } from '@open-mercato/shared/lib/i18n/server'
import { entities } from '../ce'
import { installHiddenPotentialRules } from './rules-config'

export const HIDDEN_POTENTIAL_STAGE_KEYS = ['new', 'researching', 'observed', 'review', 'contact_ready', 'contacted', 'closed'] as const
const installationSchema = z.object({
  schemaVersion: z.literal(1),
  pipelineId: z.string().uuid(),
  stageIds: z.partialRecord(z.enum(HIDDEN_POTENTIAL_STAGE_KEYS), z.string().uuid()),
}).strict()
export type HiddenPotentialInstallation = z.infer<typeof installationSchema>
const labelsSchema = z.object({
  pipelineName: z.string().min(1).max(200),
  stageLabels: z.record(z.enum(HIDDEN_POTENTIAL_STAGE_KEYS), z.string().min(1).max(200)),
}).strict()

export async function installHiddenPotential(context: InitSetupContext): Promise<HiddenPotentialInstallation> {
  const { tenantId, organizationId, container } = context
  const scope = { tenantId, organizationId }
  const service = container.resolve<ModuleConfigService>('moduleConfigService')
  const commandBus = container.resolve<CommandBus>('commandBus')
  const { translate } = await resolveTranslations()
  const configKey = `hidden_potential_installation_${organizationId}`
  const commandContext: CommandRuntimeContext = {
    container, auth: null, organizationScope: null,
    selectedOrganizationId: organizationId, organizationIds: [organizationId], systemActor: true,
  }
  return context.em.fork().transactional(async (lockEm) => {
    await lockEm.getConnection().execute(
      'select pg_advisory_xact_lock(hashtextextended(?, 0))',
      [`photographers:hidden-potential:install:${tenantId}`], 'all', lockEm.getTransactionContext(),
    )
    await installHiddenPotentialRules(service, scope)
    const fieldChanges = await ensureCustomFieldDefinitions(context.em.fork(), entities.map((entity) => ({
      entity: entity.id,
      source: 'photographers',
      fields: (entity.fields ?? []).map((field) => ({ ...field, label: translate(field.label ?? field.key) })),
    })), { tenantId, organizationId: null })
    if (fieldChanges.created > 0 || fieldChanges.updated > 0) {
      const cache = container.hasRegistration('cache') ? container.resolve<CacheStrategy>('cache') : undefined
      await invalidateDefinitionsCache(cache, { tenantId, organizationId: null, entityIds: entities.map((entity) => entity.id) })
    }

    const labelsKey = `hidden_potential_installation_labels_${organizationId}`
    const previousLabels = await service.getValue('photographers', labelsKey, { scope })
    const labels = labelsSchema.parse(previousLabels ?? {
      pipelineName: translate('photographers.hiddenPotential.pipeline'),
      stageLabels: Object.fromEntries(HIDDEN_POTENTIAL_STAGE_KEYS.map((key) => [key, translate(`photographers.hiddenPotential.stages.${key}`)])),
    })
    if (!previousLabels) {
      const saved = await service.setValue('photographers', labelsKey, labels, scope)
      if (!saved) throw new Error('[internal] Hidden potential installation labels could not be persisted')
    }
    const previous = await service.getValue('photographers', configKey, { scope })
    let installation = previous ? installationSchema.parse(previous) : null
    const em = context.em.fork()
    const pipelineName = labels.pipelineName
    let pipeline = installation
      ? await findOneWithDecryption(em, CustomerPipeline, { id: installation.pipelineId, ...scope }, {}, scope)
      : null
    if (installation && !pipeline) throw new Error('[internal] Installed hidden potential pipeline is missing')
    if (!pipeline) {
      const matches = await findWithDecryption(em, CustomerPipeline, { name: pipelineName, ...scope }, { limit: 2 }, scope)
      if (matches.length > 1) throw new Error('[internal] Hidden potential pipeline is ambiguous')
      pipeline = matches[0] ?? null
    }
    if (!installation) {
      const pipelineId = pipeline?.id ?? (await commandBus.execute<unknown, { pipelineId: string }>(
        'customers.pipelines.create', { input: { ...scope, name: pipelineName, isDefault: false }, ctx: commandContext },
      )).result.pipelineId
      installation = { schemaVersion: 1, pipelineId, stageIds: {} }
      const saved = await service.setValue('photographers', configKey, installation, scope)
      if (!saved) throw new Error('[internal] Hidden potential installation could not be persisted')
    }
    const stages = await findWithDecryption(em, CustomerPipelineStage, { pipelineId: installation.pipelineId, ...scope }, { limit: 100 }, scope)
    for (const [order, key] of HIDDEN_POTENTIAL_STAGE_KEYS.entries()) {
      const savedId = installation.stageIds[key]
      if (savedId) {
        if (!stages.some((stage) => stage.id === savedId)) throw new Error('[internal] Installed hidden potential stage is missing')
        continue
      }
      const label = labels.stageLabels[key]
      const matches = stages.filter((stage) => stage.label === label)
      if (matches.length > 1) throw new Error('[internal] Hidden potential stage is ambiguous')
      const stageId = matches[0]?.id ?? (await commandBus.execute<unknown, { stageId: string }>(
        'customers.pipeline-stages.create', { input: { ...scope, pipelineId: installation.pipelineId, label, order }, ctx: commandContext },
      )).result.stageId
      installation.stageIds[key] = stageId
      const saved = await service.setValue('photographers', configKey, installation, scope)
      if (!saved) throw new Error('[internal] Hidden potential stage mapping could not be persisted')
    }
    return installation
  })
}
