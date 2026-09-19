import type { CommandRuntimeContext } from '@open-mercato/shared/lib/commands'
import { evaluationReviewPayloadSchema } from '../data/evaluation-review-validators'
import { materialResponseSchema } from '../data/material-validators'
import { readEvaluationMaterial } from './material-store'
import { reviewError } from './proposal-review-materials'

export async function readEvaluationReviewMaterials(raw: unknown, ctx: CommandRuntimeContext) {
  const parsed = evaluationReviewPayloadSchema.safeParse(raw)
  if (!parsed.success) return reviewError(409, 'invalid_material')
  const payload = parsed.data
  const materials = await Promise.all([payload.factsRef, payload.scoreRef].map(async (id) => materialResponseSchema.parse(await readEvaluationMaterial(id, ctx))))
  const [facts, score] = materials
  if (facts.id !== payload.factsRef || score.id !== payload.scoreRef || facts.kind !== 'facts' || score.kind !== 'score') return reviewError(409, 'material_conflict')
  if (materials.some((material) => material.evaluationId !== payload.evaluationId || material.registrationId !== payload.registrationId || material.photographerId !== payload.photographerId || material.personId !== payload.personId || material.dealId !== payload.dealId)) return reviewError(409, 'material_conflict')
  if (facts.data.evaluationId !== payload.evaluationId || score.data.evaluationId !== payload.evaluationId || score.data.factsRef !== facts.id || score.data.evaluatedAt !== facts.data.evaluatedAt || score.data.flags.length === 0 || score.data.suggestedAction !== 'review') return reviewError(409, 'material_conflict')
  return materials
}
