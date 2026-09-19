import { z } from 'zod'
import type { EntityManager } from '@mikro-orm/postgresql'
import type { CommandInterceptor } from '@open-mercato/shared/lib/commands/command-interceptor'
import { WorkflowInstance } from '@open-mercato/core/modules/workflows/data/entities'
import { findOneWithDecryption } from '@open-mercato/shared/lib/encryption/find'
import { loadReviewProposal, reviewError } from './proposal-review-materials'
import { authorizeDemoCommand, demoCommandContext } from './demo-proposal-support'
import { authorizeProposalReview } from './proposal-review-materials'

const inputSchema = z.object({ tenantId: z.string().uuid(), organizationId: z.string().uuid(), proposalId: z.string().uuid(), userId: z.string().uuid(), disposition: z.enum(['approved', 'edited', 'rejected', 'auto_approved']) })

export const demoProposalDispositionInterceptor: CommandInterceptor = {
  id: 'photographers.demo_proposal_disposition', targetCommand: 'agent_orchestrator.proposals.dispose', priority: 20,
  async beforeExecute(rawInput, context) {
    const parsed = inputSchema.safeParse(rawInput)
    if (!parsed.success) return
    const input = parsed.data
    const scope = { tenantId: input.tenantId, organizationId: input.organizationId }
    const proposal = await loadReviewProposal(input.proposalId, scope, context)
    if (proposal.agentId !== 'photographers.message_review' || !proposal.workflowInstanceId) return
    const em = context.container.resolve<EntityManager>('em').fork()
    const workflow = await findOneWithDecryption(em, WorkflowInstance, { id: proposal.workflowInstanceId, workflowId: 'photographers.demo-evaluation', ...scope }, {}, scope)
    if (!workflow) return
    if (!context.auth?.sub || input.userId !== context.auth.sub || context.auth.tenantId !== scope.tenantId || (context.selectedOrganizationId ?? context.auth.orgId) !== scope.organizationId || input.disposition === 'auto_approved') return reviewError(403, 'forbidden')
    const ctx = demoCommandContext({ ...scope, prepared: { userId: input.userId } }, context.container)
    await authorizeProposalReview(ctx, true)
    await authorizeDemoCommand(ctx)
    const { getDemoReviewBinding } = await import('./demo-workflow-runtime')
    const binding = await getDemoReviewBinding({ ...scope, workflowInstanceId: workflow.id }, context.container)
    const { AgentRun } = await import('@open-mercato/enterprise/modules/agent_orchestrator/data/entities')
    const run = await findOneWithDecryption(em, AgentRun, { id: proposal.runId, ...scope, workflowInstanceId: workflow.id, stepId: binding.stepId, invocationId: binding.invocationId, agentId: proposal.agentId, runtime: 'external' }, {}, scope)
    if (!run || proposal.stepId !== binding.stepId || proposal.disposition !== 'pending') return reviewError(409, 'material_conflict')
    return { modifiedInput: { skipResume: true } }
  },
}
