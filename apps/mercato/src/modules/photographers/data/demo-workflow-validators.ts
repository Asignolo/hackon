import { z } from 'zod'

export const preparedPhotographerDemoSchema = z.object({
  requestId: z.string().uuid(), registrationId: z.string().uuid(), photographerId: z.string().uuid(),
  personId: z.string().uuid(), dealId: z.string().uuid(), evaluationId: z.string().uuid(),
  evaluatedAt: z.string().datetime(), userId: z.string().uuid(), source: z.literal('demo_fixture'),
}).strict()
export type PreparedPhotographerDemo = z.infer<typeof preparedPhotographerDemoSchema>

export const demoWorkflowScopeSchema = z.object({ tenantId: z.string().uuid(), organizationId: z.string().uuid() })
export const demoWorkflowJobSchema = z.discriminatedUnion('kind', [
  demoWorkflowScopeSchema.extend({ kind: z.literal('execution'), executionId: z.string().uuid() }).strict(),
  demoWorkflowScopeSchema.extend({ kind: z.literal('disposition'), proposalId: z.string().uuid() }).strict(),
  demoWorkflowScopeSchema.extend({ kind: z.literal('sweep'), afterId: z.string().uuid().optional() }).strict(),
])
export type DemoWorkflowJob = z.infer<typeof demoWorkflowJobSchema>

export const demoDispatchSchema = z.object({ lane: z.enum(['portfolio', 'social', 'review']) }).strict()
export const demoDispatchReceiptSchema = z.object({ result: z.object({ operationId: z.string().uuid() }) })
export const demoResearchResultSchema = z.object({ runId: z.string().uuid(), materialId: z.string().uuid() })
