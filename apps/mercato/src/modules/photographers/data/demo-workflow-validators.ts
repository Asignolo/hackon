import { z } from 'zod'

export const preparedPhotographerDemoSchema = z.object({
  requestId: z.string().uuid(), registrationId: z.string().uuid(), photographerId: z.string().uuid(),
  personId: z.string().uuid(), dealId: z.string().uuid(), evaluationId: z.string().uuid(),
  evaluatedAt: z.string().datetime(), userId: z.string().uuid(), source: z.literal('demo_fixture'),
}).strict()
export type PreparedPhotographerDemo = z.infer<typeof preparedPhotographerDemoSchema>

export const demoWorkflowScopeSchema = z.object({ tenantId: z.string().uuid(), organizationId: z.string().uuid() })
const demoWorkflowDomainJobSchema = z.discriminatedUnion('kind', [
  demoWorkflowScopeSchema.extend({ kind: z.literal('execution'), executionId: z.string().uuid() }).strict(),
  demoWorkflowScopeSchema.extend({ kind: z.literal('disposition'), proposalId: z.string().uuid() }).strict(),
  demoWorkflowScopeSchema.extend({ kind: z.literal('sweep'), afterId: z.string().uuid().optional() }).strict(),
])
export const demoWorkflowJobSchema = demoWorkflowScopeSchema.extend({
  scope: demoWorkflowScopeSchema.strict().optional(),
  _idempotencyKey: z.string().optional(),
  _jobOrigin: z.literal('scheduler').optional(),
}).passthrough().superRefine((payload, context) => {
  if (payload.scope && (payload.scope.tenantId !== payload.tenantId || payload.scope.organizationId !== payload.organizationId)) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ['scope'], message: '[internal] Scheduler scope does not match demo job scope' })
  }
}).transform(({ scope: _scope, _idempotencyKey, _jobOrigin, ...payload }) => payload).pipe(demoWorkflowDomainJobSchema)
export type DemoWorkflowJob = z.infer<typeof demoWorkflowJobSchema>

export const demoDispatchSchema = z.object({ lane: z.enum(['portfolio', 'social', 'review']) }).strict()
export const demoDispatchReceiptSchema = z.object({ result: z.object({ operationId: z.string().uuid() }) })
export const demoResearchResultSchema = z.object({ runId: z.string().uuid(), materialId: z.string().uuid() })
