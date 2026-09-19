import { z } from 'zod'

const uuid = z.string().uuid()
export const syntheticDispatchArgsSchema = z.object({
  lane: z.enum(['portfolio', 'social', 'review']),
  waitStepId: z.enum(['wait_portfolio', 'wait_social', 'wait_review']),
}).strict().refine((value) => value.waitStepId === `wait_${value.lane}`, { message: '[internal] Synthetic lane and wait mismatch' })

export const syntheticWorkflowInputSchema = z.object({
  enabled: z.literal(true),
  evaluationId: uuid,
  photographerId: uuid,
  personId: uuid,
  dealId: uuid,
  materials: z.object({ portfolio: uuid, social: uuid, review: uuid }).strict(),
}).strict()

export const syntheticWorkflowJobSchema = z.object({
  tenantId: uuid,
  organizationId: uuid,
  userId: uuid,
  workflowInstanceId: uuid,
  branchInstanceId: uuid.nullable(),
  operationId: uuid,
  lane: z.enum(['portfolio', 'social', 'review']),
  waitStepId: z.enum(['wait_portfolio', 'wait_social', 'wait_review']),
  materialId: uuid,
}).strict().refine((value) => value.waitStepId === `wait_${value.lane}`, { message: '[internal] Synthetic lane and wait mismatch' })

export type SyntheticWorkflowJob = z.infer<typeof syntheticWorkflowJobSchema>
