import { z } from 'zod'

export const demoRequestSchema = z.object({ requestId: z.string().uuid().transform((value) => value.toLowerCase()) }).strict()
const linkSchema = z.string().regex(/^\/backend\/[a-zA-Z0-9_/?=&.-]+$/)
export const demoStartRequestSchema = demoRequestSchema.extend({ registrationId: z.string().uuid().optional() }).strict()

export const demoExecutionSchema = z.object({
  requestId: z.string().uuid(),
  executionId: z.string().uuid(),
  workflowInstanceId: z.string().uuid().nullable(),
  status: z.enum(['starting', 'running', 'awaiting_review', 'completed', 'rejected', 'revoked', 'failed', 'cancelled', 'unavailable']),
  registrationId: z.string().uuid(),
  photographerId: z.string().uuid(),
  personId: z.string().uuid(),
  dealId: z.string().uuid(),
  evaluationId: z.string().uuid(),
  o1: z.object({ status: z.enum(['waiting', 'completed', 'failed']), runId: z.string().uuid().optional(), tracesRef: z.string().uuid().optional(), nextStage: z.literal('o2'), sourcesAccepted: z.literal(true) }).optional(),
  runIds: z.array(z.string().uuid()),
  proposalId: z.string().uuid().nullable(),
  materialRefs: z.object({ tracesRef: z.string().uuid().optional(), factsRef: z.string().uuid().optional(), messageSnapshotId: z.string().uuid().optional() }),
  links: z.object({ person: linkSchema, deal: linkSchema, execution: linkSchema.optional(), workflow: linkSchema.optional(), proposal: linkSchema.optional() }),
})

export type DemoExecution = z.infer<typeof demoExecutionSchema>
