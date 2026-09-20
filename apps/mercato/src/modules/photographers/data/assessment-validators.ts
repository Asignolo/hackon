import { z } from 'zod'
import { tracesSnapshotSchema, factsSnapshotSchema, scoreSnapshotSchema, evaluationSummarySchema } from './evaluation-validators'

const uuid = z.string().uuid()
export const assessmentPathSchema = z.object({ evaluationId: uuid })
export const assessmentQuerySchema = z.object({ registrationId: uuid })
export const assessmentInputSchema = assessmentPathSchema.extend({ registrationId: uuid })
function slot<Schema extends z.ZodType>(schema: Schema) {
  return z.object({ status: z.enum(['available', 'missing', 'invalid', 'unavailable', 'excluded']), id: uuid.nullable(), data: schema.nullable() })
}
export const assessmentResponseSchema = z.object({
  evaluationId: uuid,
  registration: z.object({ id: uuid, firstName: z.string(), lastName: z.string(), email: z.string(), portfolioRaw: z.string(), submittedAt: z.string().datetime(), updatedAt: z.string().datetime() }),
  owners: z.object({ photographerId: uuid, personId: uuid, dealId: uuid, links: z.object({ person: z.string(), deal: z.string() }) }).nullable(),
  source: z.enum(['real', 'demo_fixture', 'unknown']),
  process: z.object({ workflowInstanceId: uuid.nullable(), status: z.enum(['pending', 'running', 'partial', 'completed', 'failed', 'unknown']), currentStepId: z.string().nullable(), errorCode: z.string().nullable() }),
  stages: z.array(z.object({ stepId: z.string(), status: z.enum(['done', 'partial', 'unavailable', 'waiting', 'rejected']) })),
  materials: z.object({ traces: slot(tracesSnapshotSchema), facts: slot(factsSnapshotSchema), score: slot(scoreSnapshotSchema), summary: slot(evaluationSummarySchema) }),
  o1: slot(tracesSnapshotSchema).optional(),
  research: z.object({
    status: z.enum(['waiting', 'partial', 'completed', 'failed', 'unavailable']),
    reason: z.string().optional(),
    summary: z.string().nullable().optional(),
    sources: z.array(z.object({ url: z.string(), status: z.enum(['ok', 'partial', 'empty', 'unavailable', 'blocked', 'timeout', 'error']), summary: z.string().nullable() })).optional(),
  }),
})
export type AssessmentResponse = z.infer<typeof assessmentResponseSchema>
