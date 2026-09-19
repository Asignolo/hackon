import { z } from 'zod'

export const portfolioDiscoveryStartSchema = z.object({
  registrationId: z.string().uuid(), evaluationId: z.string().uuid(),
  evaluatedAt: z.string().datetime({ offset: true }),
})
export const portfolioDiscoveryReferencesSchema = portfolioDiscoveryStartSchema.extend({
  photographerId: z.string().uuid(), personId: z.string().uuid(), dealId: z.string().uuid(),
})
export const portfolioDiscoveryPreparationSchema = portfolioDiscoveryReferencesSchema.extend({ userId: z.string().uuid() }).strict()
export const portfolioDiscoveryJobSchema = z.object({
  workflowInstanceId: z.string().uuid(), tenantId: z.string().uuid(), organizationId: z.string().uuid(),
}).strict()
export type PortfolioDiscoveryJob = z.infer<typeof portfolioDiscoveryJobSchema>

export function readPortfolioDiscoveryReferences(context: Record<string, unknown>) {
  const references = context.o1Preparation === undefined ? context : z.object({ result: portfolioDiscoveryPreparationSchema }).parse(context.o1Preparation).result
  return portfolioDiscoveryReferencesSchema.parse(references)
}
