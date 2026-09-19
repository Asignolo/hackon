import { z } from 'zod'
import { expectedVersionsSchema } from './evaluation-validators'
import { materialResponseSchema } from './material-validators'

const uuid = z.string().uuid()
export const messageReviewActionPayloadSchema = z.object({
  evaluationId: uuid,
  photographerId: uuid,
  personId: uuid,
  dealId: uuid,
  factsRef: uuid,
  messageSnapshotId: uuid,
  expectedVersions: expectedVersionsSchema,
}).strict().refine((value) => value.factsRef === value.expectedVersions.factsRef)

export const messageReviewEnvelopeSchema = z.object({
  options: z.array(z.object({
    id: z.string().min(1).max(100),
    label: z.string().min(1).max(120),
    rationale: z.string().max(2000).optional(),
    confidence: z.number().min(0).max(1).optional(),
    actions: z.array(z.object({
      type: z.literal('photographers.message.accept'),
      payload: messageReviewActionPayloadSchema,
      risk: z.enum(['low', 'medium', 'high']).optional(),
    }).strict()).length(1),
  }).strict()).min(1).max(10),
  rationale: z.string().max(2000).optional(),
}).strict().refine((value) => new Set(value.options.map((option) => option.id)).size === value.options.length)

export const proposalReviewMaterialsResponseSchema = z.object({
  proposalId: uuid,
  proposalUpdatedAt: z.string().datetime(),
  options: z.array(z.object({
    selectedOptionId: z.string().min(1).max(100),
    label: z.string().min(1).max(120),
    materials: z.array(materialResponseSchema).length(2),
  }).strict()).max(10),
}).strict()

export type MessageReviewEnvelope = z.infer<typeof messageReviewEnvelopeSchema>
export type MessageReviewActionPayload = z.infer<typeof messageReviewActionPayloadSchema>
export type ProposalReviewMaterialsResponse = z.infer<typeof proposalReviewMaterialsResponseSchema>
