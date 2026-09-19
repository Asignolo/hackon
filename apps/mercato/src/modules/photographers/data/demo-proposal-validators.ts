import { z } from 'zod'
import { demoResearchResultSchema, demoWorkflowScopeSchema, preparedPhotographerDemoSchema } from './demo-workflow-validators'

export const demoAgentInputSchema = demoWorkflowScopeSchema.extend({
  prepared: preparedPhotographerDemoSchema,
  workflowInstanceId: z.string().uuid(), stepId: z.string().min(1), invocationId: z.string().uuid(),
})
export const demoResearchInputSchema = demoAgentInputSchema.extend({ lane: z.enum(['portfolio', 'social']) }).strict()
export const demoReviewInputSchema = demoAgentInputSchema.extend({
  stepId: z.literal('wait_review'),
  research: z.object({ portfolio: demoResearchResultSchema, social: demoResearchResultSchema }).strict(),
}).strict()
export const demoDispositionInputSchema = demoWorkflowScopeSchema.extend({ proposalId: z.string().uuid() }).strict()
export const demoEffectResultSchema = z.object({
  proposalId: z.string().uuid(), disposition: z.enum(['approved', 'rejected']), interactionId: z.string().uuid(),
}).strict()
export type DemoAgentInput = z.infer<typeof demoAgentInputSchema>
export type DemoResearchInput = z.infer<typeof demoResearchInputSchema>
export type DemoReviewInput = z.infer<typeof demoReviewInputSchema>
export type DemoDispositionInput = z.infer<typeof demoDispositionInputSchema>
export type DemoEffectResult = z.infer<typeof demoEffectResultSchema>

export const demoEffectCheckpointSchema = z.object({
  ...demoEffectResultSchema.shape,
  digest: z.string().length(64),
  personUpdatedAt: z.string().datetime(), dealUpdatedAt: z.string().datetime(),
  interactionUpdatedAt: z.string().datetime().nullable(),
  beforeStageId: z.string().uuid(), pipelineId: z.string().uuid(),
}).strict()
export const demoEffectPhaseInputSchema = demoDispositionInputSchema.extend({ phase: z.enum(['stage', 'interaction', 'revoke_stage', 'revoke_interaction']) }).strict()
export type DemoEffectCheckpoint = z.infer<typeof demoEffectCheckpointSchema>
export const demoPublicationCheckpointSchema = z.object({
  personUpdatedAt: z.string().datetime(), dealUpdatedAt: z.string().datetime(), invocationId: z.string().uuid(),
}).strict()
