import { createHash } from 'node:crypto'
import { z } from 'zod'
import type { EntityManager } from '@mikro-orm/postgresql'
import type { CommandRuntimeContext } from '@open-mercato/shared/lib/commands'
import type { RbacService } from '@open-mercato/core/modules/auth/services/rbacService'
import { CustomerEntity, CustomerDeal } from '@open-mercato/core/modules/customers/data/entities'
import { CrudHttpError } from '@open-mercato/shared/lib/crud/errors'
import { resolveTranslations } from '@open-mercato/shared/lib/i18n/server'
import { findOneWithDecryption } from '@open-mercato/shared/lib/encryption/find'
import { materialResponseSchema } from '../data/material-validators'
import { messageReviewEnvelopeSchema, type MessageReviewActionPayload, type MessageReviewEnvelope } from '../data/proposal-review-validators'
import { requirePhotographerScope } from './scope'
import { readEvaluationMaterial } from './material-store'

export const proposalReviewFeatures = [
  'agent_orchestrator.proposals.view', 'photographers.evaluations.view',
  'customers.people.view', 'customers.deals.view', 'customers.interactions.view',
]
export const manualReviewAgentIds = new Set([
  'photographers.message_review', 'photographers.identity_review', 'photographers.evaluation_review',
])

export async function reviewError(status: number, key: string): Promise<never> {
  const { translate } = await resolveTranslations()
  throw new CrudHttpError(status, { error: translate(`photographers.errors.${key}`) })
}

export async function authorizeProposalReview(ctx: CommandRuntimeContext, dispose = false) {
  if (!ctx.auth?.sub) return reviewError(401, 'unauthorized')
  const scope = await requirePhotographerScope(ctx)
  const rbac = ctx.container.resolve<RbacService>('rbacService')
  const features = dispose ? [...proposalReviewFeatures, 'agent_orchestrator.proposals.dispose'] : proposalReviewFeatures
  if (!await rbac.userHasAllFeatures(ctx.auth.sub, features, scope)) return reviewError(403, 'forbidden')
  return scope
}

export async function loadReviewProposal(id: string, scope: { tenantId: string; organizationId: string }, ctx: Pick<CommandRuntimeContext, 'container'>) {
  z.string().uuid().parse(id)
  const proposalScope = { tenantId: scope.tenantId, organizationId: scope.organizationId }
  const { AgentProposal } = await import('@open-mercato/enterprise/modules/agent_orchestrator/data/entities')
  const em = ctx.container.resolve<EntityManager>('em').fork()
  const proposal = await findOneWithDecryption(em, AgentProposal, { id, ...proposalScope, deletedAt: null, source: 'runtime' }, {}, proposalScope)
  if (!proposal) return reviewError(404, 'material_not_found')
  return proposal
}

function sortedJson(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortedJson)
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).sort(([left], [right]) => left.localeCompare(right)).map(([key, entry]) => [key, sortedJson(entry)]))
  return value
}

export function reviewDigest(value: unknown) {
  return createHash('sha256').update(JSON.stringify(sortedJson(value))).digest('hex')
}

export async function parseReviewEnvelope(payload: unknown) {
  const parsed = messageReviewEnvelopeSchema.safeParse(payload)
  if (!parsed.success) return reviewError(409, 'invalid_material')
  return parsed.data
}

export async function validateEditedReview(original: MessageReviewEnvelope, edited: MessageReviewEnvelope, selectedOptionId?: string) {
  if (original.rationale !== edited.rationale || original.options.length !== edited.options.length) return reviewError(409, 'invalid_material')
  for (let index = 0; index < original.options.length; index += 1) {
    const before = original.options[index]
    const after = edited.options[index]
    if (before.id !== selectedOptionId) {
      if (reviewDigest(before) !== reviewDigest(after)) return reviewError(409, 'invalid_material')
      continue
    }
    const beforeAction = before.actions[0]
    const afterAction = after.actions[0]
    const allowedPayload = { ...beforeAction.payload, messageSnapshotId: afterAction.payload.messageSnapshotId, expectedVersions: afterAction.payload.expectedVersions }
    const allowedOption = { ...before, actions: [{ ...beforeAction, payload: allowedPayload }] }
    if (reviewDigest(allowedOption) !== reviewDigest(after)) return reviewError(409, 'invalid_material')
  }
}

async function readReviewMaterials(payload: MessageReviewActionPayload, ctx: CommandRuntimeContext, requireCurrentVersions: boolean) {
  const scope = await requirePhotographerScope(ctx)
  const materials = await Promise.all([payload.factsRef, payload.messageSnapshotId].map(async (id) => materialResponseSchema.parse(await readEvaluationMaterial(id, ctx))))
  const [facts, message] = materials
  if (facts.id !== payload.factsRef || message.id !== payload.messageSnapshotId || facts.kind !== 'facts' || message.kind !== 'message' || message.data.factsRef !== payload.factsRef) return reviewError(409, 'material_conflict')
  if (materials.some((material) => material.evaluationId !== payload.evaluationId || material.photographerId !== payload.photographerId || material.personId !== payload.personId || material.dealId !== payload.dealId)) return reviewError(409, 'material_conflict')
  const em = ctx.container.resolve<EntityManager>('em').fork()
  const [person, deal] = await Promise.all([
    findOneWithDecryption(em, CustomerEntity, { id: payload.photographerId, kind: 'person', ...scope, deletedAt: null }, {}, scope),
    findOneWithDecryption(em, CustomerDeal, { id: payload.dealId, ...scope, deletedAt: null }, {}, scope),
  ])
  if (!person || !deal) return reviewError(404, 'material_not_found')
  if (requireCurrentVersions && (person.updatedAt.toISOString() !== new Date(payload.expectedVersions.personUpdatedAt).toISOString() || deal.updatedAt.toISOString() !== new Date(payload.expectedVersions.dealUpdatedAt).toISOString())) return reviewError(409, 'material_conflict')
  return materials
}

export async function readMessageReviewMaterials(payload: MessageReviewActionPayload, ctx: CommandRuntimeContext) {
  return readReviewMaterials(payload, ctx, true)
}

export async function readHistoricalMessageReviewMaterials(payload: MessageReviewActionPayload, ctx: CommandRuntimeContext) {
  return readReviewMaterials(payload, ctx, false)
}
