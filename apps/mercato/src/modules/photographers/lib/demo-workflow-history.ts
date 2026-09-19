import type { EntityManager } from '@mikro-orm/postgresql'
import type { CommandRuntimeContext } from '@open-mercato/shared/lib/commands'
import type { RbacService } from '@open-mercato/core/modules/auth/services/rbacService'
import { WorkflowInstance } from '@open-mercato/core/modules/workflows/data/entities'
import { AgentRun } from '@open-mercato/enterprise/modules/agent_orchestrator/data/entities'
import { findOneWithDecryption } from '@open-mercato/shared/lib/encryption/find'
import { demoDispositionInputSchema } from '../data/demo-proposal-validators'
import { requirePhotographerScope } from './scope'
import { loadReviewProposal, reviewDigest, reviewError } from './proposal-review-materials'
import { readDemoCheckpoint } from './demo-proposal-journal'
import { DEMO_REVIEW_STEP, DEMO_WORKFLOW_ID } from './demo-workflow'

export async function readDemoRevocationHistory(rawInput: unknown, ctx: CommandRuntimeContext): Promise<'none' | 'partial' | 'revoked'> {
  const input = demoDispositionInputSchema.parse(rawInput)
  if (!ctx.auth?.sub) return reviewError(401, 'unauthorized')
  const scope = await requirePhotographerScope(ctx)
  if (input.tenantId !== scope.tenantId || input.organizationId !== scope.organizationId) return reviewError(403, 'forbidden')
  if (!await ctx.container.resolve<RbacService>('rbacService').userHasAllFeatures(ctx.auth.sub, ['photographers.evaluations.view', 'agent_orchestrator.proposals.view', 'workflows.instances.view'], scope)) return reviewError(403, 'forbidden')
  const proposal = await loadReviewProposal(input.proposalId, scope, ctx)
  if (proposal.agentId !== 'photographers.message_review' || proposal.stepId !== DEMO_REVIEW_STEP || !proposal.workflowInstanceId || !proposal.runId || !proposal.dispositionBy || !['approved', 'edited', 'rejected'].includes(proposal.disposition)) return reviewError(409, 'material_conflict')
  const em = ctx.container.resolve<EntityManager>('em').fork()
  const [workflow, run] = await Promise.all([
    findOneWithDecryption(em, WorkflowInstance, { id: proposal.workflowInstanceId, workflowId: DEMO_WORKFLOW_ID, ...scope }, {}, scope),
    findOneWithDecryption(em, AgentRun, { id: proposal.runId, agentId: proposal.agentId, workflowInstanceId: proposal.workflowInstanceId, stepId: DEMO_REVIEW_STEP, runtime: 'external', ...scope }, {}, scope),
  ])
  if (!workflow || !run?.invocationId) return reviewError(409, 'material_conflict')
  const identity = { scope, proposal, digest: reviewDigest({ payload: proposal.payload, disposition: proposal.disposition, selectedOptionId: proposal.selectedOptionId, updatedAt: proposal.updatedAt.toISOString() }) }
  const revoked = await readDemoCheckpoint(identity, 'revoke_interaction', ctx)
  if (revoked) return 'revoked'
  return await readDemoCheckpoint(identity, 'revoke_stage', ctx) ? 'partial' : 'none'
}
