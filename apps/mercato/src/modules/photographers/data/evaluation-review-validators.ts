import { z } from 'zod'

const uuid = z.string().uuid()

export const evaluationReviewPayloadSchema = z.object({
  evaluationId: uuid,
  registrationId: uuid,
  photographerId: uuid,
  personId: uuid,
  dealId: uuid,
  factsRef: uuid,
  scoreRef: uuid,
}).strict()

export const evaluationReviewEnvelopeSchema = z.object({
  options: z.array(z.object({
    id: z.literal('review'),
    label: z.string().min(1).max(120),
    rationale: z.string().max(2000).optional(),
    actions: z.array(z.object({
      type: z.literal('photographers.evaluation.review'),
      risk: z.literal('high'),
      payload: evaluationReviewPayloadSchema,
    }).strict()).length(1),
  }).strict()).length(1),
  rationale: z.string().max(2000).optional(),
}).strict()

export type EvaluationReviewPayload = z.infer<typeof evaluationReviewPayloadSchema>
