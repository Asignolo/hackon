import { z } from 'zod'
import type { AccessLogService } from '@open-mercato/core/modules/audit_logs/services/accessLogService'
import type { CommandRuntimeContext } from '@open-mercato/shared/lib/commands'
import type { CommandInterceptor } from '@open-mercato/shared/lib/commands/command-interceptor'
import { proposalReviewMaterialsResponseSchema, type MessageReviewEnvelope } from '../data/proposal-review-validators'
import { evaluationReviewEnvelopeSchema } from '../data/evaluation-review-validators'
import { readEvaluationReviewMaterials } from './evaluation-review-materials'
import { authorizeProposalReview, loadReviewProposal, manualReviewAgentIds, parseReviewEnvelope, readHistoricalMessageReviewMaterials, readMessageReviewMaterials, reviewDigest, reviewError, validateEditedReview } from './proposal-review-materials'

const resourceKind = 'photographers.proposal_material'
const accessType = 'review_material'
const maxAccessAgeMs = 5 * 60 * 1000
const commandInputSchema = z.object({
  proposalId: z.string().uuid(), tenantId: z.string().uuid(), organizationId: z.string().uuid(),
  disposition: z.enum(['approved', 'auto_approved', 'edited', 'rejected']),
  selectedOptionId: z.string().min(1).max(100).optional(), userId: z.string().uuid().nullable().optional(),
  payload: z.unknown().optional(),
})
const accessContextSchema = z.object({
  proposalUpdatedAt: z.string().datetime(), envelopeDigest: z.string().length(64),
  options: z.array(z.object({ selectedOptionId: z.string(), materialDigest: z.string().length(64) }).strict()).max(10),
}).strict()

async function accessService(ctx: Pick<CommandRuntimeContext, 'container'>) {
  let service: AccessLogService | undefined
  try { service = ctx.container.resolve<AccessLogService>('accessLogService') } catch { return reviewError(503, 'review_unavailable') }
  if (!service || typeof service.log !== 'function' || typeof service.list !== 'function') return reviewError(503, 'review_unavailable')
  return service
}

export async function recordProposalReviewAccess(proposalId: string, ctx: CommandRuntimeContext, edit?: { payload: MessageReviewEnvelope; selectedOptionId: string }) {
  const scope = await authorizeProposalReview(ctx)
  const proposal = await loadReviewProposal(proposalId, scope, ctx)
  const base = { proposalId, proposalUpdatedAt: proposal.updatedAt.toISOString(), options: [] }
  if (!manualReviewAgentIds.has(proposal.agentId)) return proposalReviewMaterialsResponseSchema.parse(base)
  if (proposal.agentId === 'photographers.evaluation_review') {
    if (edit) return reviewError(409, 'evaluation_decision_unavailable')
    const envelope = evaluationReviewEnvelopeSchema.safeParse(proposal.payload)
    if (!envelope.success) return reviewError(409, 'invalid_material')
    const option = envelope.data.options[0]
    return proposalReviewMaterialsResponseSchema.parse({
      ...base,
      options: [{ selectedOptionId: option.id, label: option.label, materials: await readEvaluationReviewMaterials(option.actions[0].payload, ctx) }],
    })
  }
  if (proposal.agentId !== 'photographers.message_review') return reviewError(409, 'review_unavailable')
  const original = await parseReviewEnvelope(proposal.payload)
  const envelope = edit ? await parseReviewEnvelope(edit.payload) : original
  if (edit) {
    if (proposal.disposition !== 'pending') return reviewError(409, 'material_conflict')
    await authorizeProposalReview(ctx, true)
    if (!envelope.options.some((option) => option.id === edit.selectedOptionId)) return reviewError(409, 'invalid_material')
    await validateEditedReview(original, envelope, edit.selectedOptionId)
  }
  const options = await Promise.all(envelope.options.map(async (option) => ({
    selectedOptionId: option.id, label: option.label,
    materials: await (proposal.disposition === 'pending' ? readMessageReviewMaterials : readHistoricalMessageReviewMaterials)(option.actions[0].payload, ctx),
  })))
  const response = proposalReviewMaterialsResponseSchema.parse({ ...base, options })
  if (proposal.disposition !== 'pending') return response
  const context = accessContextSchema.parse({
    proposalUpdatedAt: base.proposalUpdatedAt,
    envelopeDigest: reviewDigest(envelope),
    options: options.map((option) => ({ selectedOptionId: option.selectedOptionId, materialDigest: reviewDigest(option.materials) })),
  })
  const service = await accessService(ctx)
  const entry = await service.log({ ...scope, actorUserId: ctx.auth!.sub, resourceKind, resourceId: proposalId, accessType, context })
  if (!entry) return reviewError(503, 'review_unavailable')
  return response
}

export const readProposalReviewMaterials = recordProposalReviewAccess

export const proposalReviewAccessInterceptor: CommandInterceptor = {
  id: 'photographers.proposal_review_access',
  targetCommand: 'agent_orchestrator.proposals.dispose',
  priority: 10,
  async beforeExecute(rawInput, context) {
    const parsed = commandInputSchema.safeParse(rawInput)
    if (!parsed.success) return
    const input = parsed.data
    const scope = { tenantId: input.tenantId, organizationId: input.organizationId }
    const proposal = await loadReviewProposal(input.proposalId, scope, context)
    if (proposal.agentId === 'photographers.evaluation_review') return reviewError(409, 'evaluation_decision_unavailable')
    if (input.disposition === 'rejected') return
    if (!manualReviewAgentIds.has(proposal.agentId)) return
    if (context.auth && (context.auth.tenantId !== scope.tenantId || (context.selectedOrganizationId ?? context.auth.orgId) !== scope.organizationId)) return reviewError(403, 'forbidden')
    if (!context.auth?.sub || input.userId !== context.auth.sub || input.disposition === 'auto_approved') return reviewError(403, 'review_required')
    if (proposal.agentId !== 'photographers.message_review') return reviewError(409, 'review_unavailable')
    const ctx: CommandRuntimeContext = {
      container: context.container, auth: context.auth, selectedOrganizationId: scope.organizationId,
      organizationScope: null, organizationIds: [scope.organizationId],
    }
    await authorizeProposalReview(ctx, true)
    if (proposal.disposition !== 'pending') return reviewError(409, 'material_conflict')
    const original = await parseReviewEnvelope(proposal.payload)
    const envelope = input.disposition === 'edited' ? await parseReviewEnvelope(input.payload) : original
    if (input.disposition === 'edited') await validateEditedReview(original, envelope, input.selectedOptionId)
    const selected = envelope.options.find((option) => option.id === input.selectedOptionId)
    if (!selected) return reviewError(409, 'invalid_material')
    const materials = await readMessageReviewMaterials(selected.actions[0].payload, ctx)
    const service = await accessService(ctx)
    const earliest = new Date(Date.now() - maxAccessAgeMs)
    const result = await service.list({ ...scope, actorUserId: context.auth.sub, resourceKind, accessType, after: earliest, pageSize: 100 })
    const materialDigest = reviewDigest(materials)
    const envelopeDigest = reviewDigest(envelope)
    const reviewed = result.items.some((entry) => {
      if (entry.resourceId !== proposal.id || entry.actorUserId !== context.auth!.sub || entry.tenantId !== scope.tenantId || entry.organizationId !== scope.organizationId || entry.resourceKind !== resourceKind || entry.accessType !== accessType || entry.deletedAt || entry.createdAt <= earliest || entry.createdAt.getTime() > Date.now()) return false
      const evidence = accessContextSchema.safeParse(entry.contextJson)
      return evidence.success && evidence.data.proposalUpdatedAt === proposal.updatedAt.toISOString()
        && evidence.data.envelopeDigest === envelopeDigest
        && evidence.data.options.some((option) => option.selectedOptionId === selected.id && option.materialDigest === materialDigest)
    })
    if (!reviewed) return reviewError(409, 'review_required')
  },
}
