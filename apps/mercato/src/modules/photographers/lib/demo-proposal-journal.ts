import type { EntityManager } from '@mikro-orm/postgresql'
import type { CommandRuntimeContext } from '@open-mercato/shared/lib/commands'
import type { TenantDataEncryptionService } from '@open-mercato/shared/lib/encryption/tenantDataEncryptionService'
import { ActionLog } from '@open-mercato/core/modules/audit_logs/data/entities'
import { CustomerInteraction } from '@open-mercato/core/modules/customers/data/entities'
import { findOneWithDecryption, findWithDecryption } from '@open-mercato/shared/lib/encryption/find'
import { demoEffectCheckpointSchema, type DemoEffectCheckpoint } from '../data/demo-proposal-validators'
import type { loadDemoDecision } from './demo-proposal-decision'
import { loadDemoOwners } from './demo-proposal-support'
import { reviewError } from './proposal-review-materials'

type Decision = Awaited<ReturnType<typeof loadDemoDecision>>
export async function readDemoCheckpoint(decision: Pick<Decision, 'scope' | 'proposal' | 'digest'>, phase: 'stage' | 'interaction' | 'revoke_stage' | 'revoke_interaction', ctx: CommandRuntimeContext) {
  const logs = await findWithDecryption(ctx.container.resolve<EntityManager>('em').fork(), ActionLog, { ...decision.scope, resourceId: decision.proposal.id, commandId: 'photographers.demo.message.phase', executionState: 'done', deletedAt: null }, { limit: 100, orderBy: { createdAt: 'desc' } }, decision.scope)
  for (const log of logs) {
    if (log.contextJson?.phase !== phase) continue
    const result = demoEffectCheckpointSchema.safeParse(log.snapshotAfter)
    if (!result.success || result.data.digest !== decision.digest || result.data.proposalId !== decision.proposal.id || log.actorUserId !== decision.proposal.dispositionBy) return reviewError(409, 'material_conflict')
    return result.data
  }
  return null
}

export async function assertDemoCheckpoint(decision: Decision, checkpoint: DemoEffectCheckpoint, ctx: CommandRuntimeContext) {
  const input = { ...decision.scope, prepared: decision.prepared }
  const { person, deal } = await loadDemoOwners(input, ctx.container)
  if (person.updatedAt.toISOString() !== checkpoint.personUpdatedAt || deal.updatedAt.toISOString() !== checkpoint.dealUpdatedAt) return reviewError(409, 'material_conflict')
  if (checkpoint.interactionUpdatedAt) {
    const interaction = await findOneWithDecryption(ctx.container.resolve<EntityManager>('em').fork(), CustomerInteraction, { id: checkpoint.interactionId, ...decision.scope, deletedAt: null }, {}, decision.scope)
    if (!interaction || interaction.updatedAt.toISOString() !== checkpoint.interactionUpdatedAt || interaction.dealId !== decision.prepared.dealId || interaction.entity.id !== decision.prepared.photographerId) return reviewError(409, 'material_conflict')
  }
  return { person, deal }
}

export async function requireDemoEffectEncryption(ctx: CommandRuntimeContext, scope: { tenantId: string; organizationId: string }) {
  const encryption = ctx.container.resolve<TenantDataEncryptionService>('tenantEncryptionService')
  if (!encryption.isEnabled()) return reviewError(503, 'encryption_unavailable')
  for (const [entity, fields] of [['customers:customer_interaction', ['title', 'body']], ['audit_logs:action_log', ['command_payload', 'snapshot_before', 'snapshot_after', 'changes_json', 'context_json']]] as const) {
    const probe = Object.fromEntries(fields.map((field) => [field, 'photographers-encryption-check']))
    const sealed = await encryption.encryptEntityPayload(entity, probe, scope.tenantId, scope.organizationId)
    if (fields.some((field) => typeof sealed[field] !== 'string' || sealed[field] === probe[field])) return reviewError(503, 'encryption_unavailable')
  }
}
