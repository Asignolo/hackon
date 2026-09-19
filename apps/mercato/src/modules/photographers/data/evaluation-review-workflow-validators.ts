import { z } from 'zod'

export const evaluationReviewJobSchema = z.object({
  workflowInstanceId: z.string().uuid(), tenantId: z.string().uuid(), organizationId: z.string().uuid(),
  userId: z.string().uuid(), operationId: z.string().uuid(), scoreRef: z.string().uuid(),
}).strict()
export const evaluationScoreReceiptSchema = z.object({ result: z.object({
  scoreRef: z.string().uuid(), factsRef: z.string().uuid(), rulesVersion: z.string().min(1), reviewRequired: z.boolean(),
}) })
export type EvaluationReviewJob = z.infer<typeof evaluationReviewJobSchema>
