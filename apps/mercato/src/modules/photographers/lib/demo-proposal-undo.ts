import type { EntityManager } from '@mikro-orm/postgresql'
import type { CommandBus, CommandRuntimeContext } from '@open-mercato/shared/lib/commands'
import { CustomerInteraction } from '@open-mercato/core/modules/customers/data/entities'
import { findOneWithDecryption } from '@open-mercato/shared/lib/encryption/find'
import { resolveTranslations } from '@open-mercato/shared/lib/i18n/server'
import { demoDispositionInputSchema, demoEffectPhaseInputSchema, type DemoEffectCheckpoint } from '../data/demo-proposal-validators'
import { materialOperationId } from './material-codec'
import { loadDemoDecision } from './demo-proposal-decision'
import { assertDemoCheckpoint, readDemoCheckpoint, requireDemoEffectEncryption } from './demo-proposal-journal'
import { loadDemoOwners, executeDemoCrmCommand, versionedContext, withDemoOperationLock } from './demo-proposal-support'
import { reviewError } from './proposal-review-materials'

export async function executeDemoUndoPhase(rawInput: unknown, ctx: CommandRuntimeContext): Promise<DemoEffectCheckpoint> {
  const { phase, ...input } = demoEffectPhaseInputSchema.parse(rawInput)
  if (phase !== 'revoke_stage' && phase !== 'revoke_interaction') return reviewError(409, 'invalid_material')
  const decision = await loadDemoDecision(input, ctx)
  if (decision.disposition !== 'approved') return reviewError(409, 'material_conflict')
  const previous = await readDemoCheckpoint(decision, phase, ctx)
  if (previous) {
    await assertDemoCheckpoint(decision, previous, ctx)
    return previous
  }
  const checkpoint = await readDemoCheckpoint(decision, phase === 'revoke_stage' ? 'interaction' : 'revoke_stage', ctx)
  if (!checkpoint?.interactionUpdatedAt) return reviewError(409, 'material_conflict')
  await assertDemoCheckpoint(decision, checkpoint, ctx)
  await requireDemoEffectEncryption(ctx, decision.scope)
  if (phase === 'revoke_stage') {
    const versions = await executeDemoCrmCommand('customers.deals.update', { id: decision.prepared.dealId, ...decision.scope, pipelineId: checkpoint.pipelineId, pipelineStageId: checkpoint.beforeStageId }, versionedContext(ctx, checkpoint.dealUpdatedAt), { ...checkpoint, photographerId: decision.prepared.photographerId, dealId: decision.prepared.dealId })
    const after = await loadDemoOwners({ ...input, prepared: decision.prepared }, ctx.container)
    if (after.person.updatedAt.toISOString() !== versions.personUpdatedAt || after.deal.updatedAt.toISOString() !== versions.dealUpdatedAt) return reviewError(409, 'material_conflict')
    return { ...checkpoint, personUpdatedAt: after.person.updatedAt.toISOString(), dealUpdatedAt: after.deal.updatedAt.toISOString() }
  }
  const interactionId = materialOperationId(input.proposalId, 'revocation-interaction')
  const em = ctx.container.resolve<EntityManager>('em').fork()
  if (await findOneWithDecryption(em, CustomerInteraction, { id: interactionId, ...decision.scope }, {}, decision.scope)) return reviewError(409, 'material_conflict')
  const { translate } = await resolveTranslations()
  const title = translate('photographers.demo.audit.revoke')
  const versions = await executeDemoCrmCommand('customers.interactions.create', { ...decision.scope, id: interactionId, entityId: decision.prepared.photographerId, dealId: decision.prepared.dealId, interactionType: 'note', status: 'completed', title, body: title, occurredAt: new Date(), authorUserId: ctx.auth!.sub, source: `photographers:revoke:${checkpoint.interactionId}` }, ctx, { ...checkpoint, photographerId: decision.prepared.photographerId, dealId: decision.prepared.dealId })
  const [interaction, owners] = await Promise.all([
    findOneWithDecryption(em.fork(), CustomerInteraction, { id: interactionId, ...decision.scope, deletedAt: null }, {}, decision.scope),
    loadDemoOwners({ ...input, prepared: decision.prepared }, ctx.container),
  ])
  if (!interaction || interaction.updatedAt.toISOString() !== versions.interactionUpdatedAt || owners.person.updatedAt.toISOString() !== versions.personUpdatedAt || owners.deal.updatedAt.toISOString() !== versions.dealUpdatedAt) return reviewError(409, 'material_conflict')
  return { ...checkpoint, interactionId, personUpdatedAt: owners.person.updatedAt.toISOString(), dealUpdatedAt: owners.deal.updatedAt.toISOString(), interactionUpdatedAt: interaction.updatedAt.toISOString() }
}

export async function undoDemoEffect(rawInput: unknown, ctx: CommandRuntimeContext) {
  const input = demoDispositionInputSchema.parse(rawInput)
  await withDemoOperationLock(ctx.container, `effect:${input.tenantId}:${input.organizationId}:${input.proposalId}`, async () => {
    const decision = await loadDemoDecision(input, ctx)
    const done = await readDemoCheckpoint(decision, 'revoke_interaction', ctx)
    if (done) return
    const bus = ctx.container.resolve<CommandBus>('commandBus')
    await bus.execute('photographers.demo.message.phase', { input: { ...input, phase: 'revoke_stage' }, ctx })
    await bus.execute('photographers.demo.message.phase', { input: { ...input, phase: 'revoke_interaction' }, ctx })
  })
}
