import { z } from 'zod'
import type { CommandRuntimeContext } from '@open-mercato/shared/lib/commands'
import type { EntityManager } from '@mikro-orm/postgresql'
import { findOneWithDecryption } from '@open-mercato/shared/lib/encryption/find'
import { WorkflowInstance } from '@open-mercato/core/modules/workflows/data/entities'
import { AgentRun } from '@open-mercato/enterprise/modules/agent_orchestrator/data/entities'
import { portfolioDiscoveryResultSchema } from '../data/portfolio-discovery-validators'
import { readPortfolioDiscoveryReferences } from '../data/portfolio-discovery-workflow-validators'
import { readEvaluationMaterial } from './material-store'
import { authorizeDemo } from './demo-api'
import { DEMO_WORKFLOW_ID } from '../data/demo-workflow-validators'
import { PORTFOLIO_DISCOVERY_AGENT_ID } from './portfolio-discovery-contract'

export async function readDemoO1Handoff(workflowInstanceId: string, ctx: CommandRuntimeContext) {
  z.string().uuid().parse(workflowInstanceId)
  const scope = await authorizeDemo(ctx, false)
  const em = ctx.container.resolve<EntityManager>('em').fork()
  const instance = await findOneWithDecryption(em, WorkflowInstance, { id: workflowInstanceId, workflowId: DEMO_WORKFLOW_ID, ...scope }, {}, scope)
  if (!instance) throw new Error('[internal] O1 workflow is unavailable')
  const references = readPortfolioDiscoveryReferences(instance.context)
  const { result } = z.object({ result: z.object({ runId: z.string().uuid(), tracesRef: z.string().uuid(), status: z.string() }) }).parse(instance.context.o1Result)
  const run = await findOneWithDecryption(em, AgentRun, { id: result.runId, workflowInstanceId, stepId: 'o1', agentId: PORTFOLIO_DISCOVERY_AGENT_ID, status: 'ok', resultKind: 'research', ...scope }, {}, scope)
  if (!run?.completedAt) throw new Error('[internal] O1 run is unavailable')
  const material = await readEvaluationMaterial(result.tracesRef, ctx)
  if (material.kind !== 'traces' || material.evaluationId !== references.evaluationId || material.registrationId !== references.registrationId || material.photographerId !== references.photographerId || material.personId !== references.personId || material.dealId !== references.dealId) throw new Error('[internal] O1 material binding mismatch')
  return { ...references, workflowInstanceId, ...result, sourcesAccepted: true as const, output: portfolioDiscoveryResultSchema.parse(run.output) }
}
