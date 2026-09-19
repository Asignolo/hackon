import type { EntityManager } from '@mikro-orm/postgresql'
import type { CommandRuntimeContext } from '@open-mercato/shared/lib/commands'
import { ActionLog } from '@open-mercato/core/modules/audit_logs/data/entities'
import { findWithDecryption } from '@open-mercato/shared/lib/encryption/find'
import { demoPublicationCheckpointSchema, demoReviewInputSchema } from '../data/demo-proposal-validators'
import { authorizeDemoCommand, demoInstallation, loadDemoOwners, setDemoStage } from './demo-proposal-support'
import { reviewDigest, reviewError } from './proposal-review-materials'

export async function prepareDemoProposal(rawInput: unknown, ctx: CommandRuntimeContext) {
  const input = demoReviewInputSchema.parse(rawInput)
  const scope = await authorizeDemoCommand(ctx)
  if (scope.tenantId !== input.tenantId || scope.organizationId !== input.organizationId) return reviewError(403, 'forbidden')
  const { getDemoReviewBinding } = await import('./demo-workflow-runtime')
  const binding = await getDemoReviewBinding({ ...scope, workflowInstanceId: input.workflowInstanceId }, ctx.container)
  if (binding.invocationId !== input.invocationId || reviewDigest(binding.prepared) !== reviewDigest(input.prepared)) return reviewError(409, 'material_conflict')
  const logs = await findWithDecryption(ctx.container.resolve<EntityManager>('em').fork(), ActionLog, { ...scope, resourceId: input.invocationId, executionState: 'done', deletedAt: null }, { limit: 100, orderBy: { createdAt: 'desc' } }, scope)
  const existing = logs.find((log) => log.commandId === 'photographers.demo.review.prepare')
  const before = await loadDemoOwners(input, ctx.container)
  if (existing) {
    const checkpoint = demoPublicationCheckpointSchema.parse(existing.snapshotAfter)
    if (checkpoint.invocationId !== input.invocationId || checkpoint.personUpdatedAt !== before.person.updatedAt.toISOString() || checkpoint.dealUpdatedAt !== before.deal.updatedAt.toISOString()) return reviewError(409, 'material_conflict')
    return checkpoint
  }
  const installation = await demoInstallation(ctx)
  if (before.deal.pipelineId !== installation.pipelineId || before.deal.pipelineStageId !== installation.stageIds.new) return reviewError(409, 'material_conflict')
  const versions = await setDemoStage(input, 'contact_ready', ctx, { personUpdatedAt: before.person.updatedAt.toISOString(), dealUpdatedAt: before.deal.updatedAt.toISOString() })
  const after = await loadDemoOwners(input, ctx.container)
  if (after.person.updatedAt.toISOString() !== versions.personUpdatedAt || after.deal.updatedAt.toISOString() !== versions.dealUpdatedAt) return reviewError(409, 'material_conflict')
  return { invocationId: input.invocationId, personUpdatedAt: versions.personUpdatedAt, dealUpdatedAt: versions.dealUpdatedAt }
}
