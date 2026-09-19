import type { EntityManager } from '@mikro-orm/postgresql'
import type { CommandRuntimeContext } from '@open-mercato/shared/lib/commands'
import { WorkflowInstance } from '@open-mercato/core/modules/workflows/data/entities'
import { findOneWithDecryption } from '@open-mercato/shared/lib/encryption/find'
import { demoDispositionInputSchema } from '../data/demo-proposal-validators'
import { preparedPhotographerDemoSchema } from '../data/demo-workflow-validators'
import { authorizeDemoCommand } from './demo-proposal-support'
import { authorizeProposalReview, loadReviewProposal, parseReviewEnvelope, reviewDigest, reviewError } from './proposal-review-materials'

export async function loadDemoDecision(rawInput: unknown, ctx: CommandRuntimeContext) {
  const input = demoDispositionInputSchema.parse(rawInput)
  const scope = await authorizeDemoCommand(ctx)
  if (input.tenantId !== scope.tenantId || input.organizationId !== scope.organizationId) return reviewError(403, 'forbidden')
  await authorizeProposalReview(ctx, true)
  const proposal = await loadReviewProposal(input.proposalId, input, ctx)
  if (proposal.agentId !== 'photographers.message_review' || !proposal.workflowInstanceId || proposal.stepId !== 'wait_review' || !proposal.runId || !proposal.dispositionBy || proposal.dispositionBy !== ctx.auth?.sub || !['approved', 'edited', 'rejected'].includes(proposal.disposition)) return reviewError(409, 'material_conflict')
  const em = ctx.container.resolve<EntityManager>('em').fork()
  const { AgentRun } = await import('@open-mercato/enterprise/modules/agent_orchestrator/data/entities')
  const [workflow, run] = await Promise.all([
    findOneWithDecryption(em, WorkflowInstance, { id: proposal.workflowInstanceId, workflowId: 'photographers.demo-evaluation', ...scope }, {}, scope),
    findOneWithDecryption(em, AgentRun, { id: proposal.runId, agentId: proposal.agentId, workflowInstanceId: proposal.workflowInstanceId, stepId: proposal.stepId, runtime: 'external', ...scope }, {}, scope),
  ])
  if (!workflow || !run?.invocationId) return reviewError(409, 'material_conflict')
  const prepared = preparedPhotographerDemoSchema.parse(workflow.context.demo)
  const envelope = await parseReviewEnvelope(proposal.payload)
  const option = proposal.disposition === 'rejected' ? envelope.options[0] : envelope.options.find((entry) => entry.id === proposal.selectedOptionId)
  if (!option || envelope.options.length !== 1) return reviewError(409, 'invalid_material')
  const payload = option.actions[0].payload
  if (payload.evaluationId !== prepared.evaluationId || payload.photographerId !== prepared.photographerId || payload.personId !== prepared.personId || payload.dealId !== prepared.dealId) return reviewError(409, 'material_conflict')
  return { input, prepared, proposal, payload, scope, run, disposition: proposal.disposition === 'rejected' ? 'rejected' as const : 'approved' as const, digest: reviewDigest({ payload: proposal.payload, disposition: proposal.disposition, selectedOptionId: proposal.selectedOptionId, updatedAt: proposal.updatedAt.toISOString() }) }
}

export async function assertCurrentDemoDecision(decision: Awaited<ReturnType<typeof loadDemoDecision>>, ctx: CommandRuntimeContext) {
  const { getDemoReviewBinding } = await import('./demo-workflow-runtime')
  const binding = await getDemoReviewBinding({ ...decision.scope, workflowInstanceId: decision.proposal.workflowInstanceId! }, ctx.container)
  if (binding.invocationId !== decision.run.invocationId || reviewDigest(binding.prepared) !== reviewDigest(decision.prepared)) return reviewError(409, 'material_conflict')
}
