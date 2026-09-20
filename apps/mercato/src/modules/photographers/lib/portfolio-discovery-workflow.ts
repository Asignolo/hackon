import { DEMO_WORKFLOW_ID } from './demo-workflow'
import { z } from 'zod'
import type { AwilixContainer } from 'awilix'
import type { EntityManager } from '@mikro-orm/postgresql'
import type { CommandBus, CommandRuntimeContext } from '@open-mercato/shared/lib/commands'
import { findOneWithDecryption } from '@open-mercato/shared/lib/encryption/find'
import type { RbacService } from '@open-mercato/core/modules/auth/services/rbacService'
import type { ActivityContext } from '@open-mercato/core/modules/workflows/lib/activity-executor'
import { StepInstance, WorkflowInstance } from '@open-mercato/core/modules/workflows/data/entities'
import { AgentRun } from '@open-mercato/enterprise/modules/agent_orchestrator/data/entities'
import { PhotographerRawData } from '../data/entities'
import { portfolioDiscoveryInputSchema } from '../data/portfolio-discovery-validators'
import { materialOperationId } from './material-codec'
import { readPortfolioDiscoveryReferences } from '../data/portfolio-discovery-workflow-validators'
import { acceptDemoPortfolioDiscoverySources, preparePortfolioDiscoveryInput, preparePortfolioDiscoveryMaterial, PORTFOLIO_DISCOVERY_AGENT_ID, PORTFOLIO_DISCOVERY_STEP_ID, PORTFOLIO_DISCOVERY_WORKFLOW_ID } from './portfolio-discovery-contract'

const argumentsSchema = z.object({ runId: z.string().uuid() }).strict()

export async function storePortfolioDiscoveryWorkflowResult(raw: unknown, context: ActivityContext, container: AwilixContainer, manager?: EntityManager) {
  const { runId } = argumentsSchema.parse(raw)
  const { workflowInstance, userId } = context
  const scope = { tenantId: workflowInstance.tenantId, organizationId: workflowInstance.organizationId }
  if (!userId || ![PORTFOLIO_DISCOVERY_WORKFLOW_ID, DEMO_WORKFLOW_ID].includes(workflowInstance.workflowId)) throw new Error('[internal] Invalid O1 workflow binding')
  const features = ['photographers.view', 'photographers.evaluations.manage', 'agent_orchestrator.trace.view', 'customers.people.view', 'customers.deals.view']
  if (!await container.resolve<RbacService>('rbacService').userHasAllFeatures(userId, features, scope)) throw new Error('[internal] O1 material access denied')
  const em = manager ?? container.resolve<EntityManager>('em').fork()
  const instance = await findOneWithDecryption(em, WorkflowInstance, { id: workflowInstance.id, workflowId: { $in: [PORTFOLIO_DISCOVERY_WORKFLOW_ID, DEMO_WORKFLOW_ID] }, ...scope }, {}, scope)
  if (!instance || instance.currentStepId !== PORTFOLIO_DISCOVERY_STEP_ID || !['RUNNING', 'PAUSED'].includes(instance.status)) throw new Error('[internal] O1 step is not current')
  const references = readPortfolioDiscoveryReferences(instance.context)
  const run = await findOneWithDecryption(em, AgentRun, {
    id: runId, workflowInstanceId: instance.id, stepId: PORTFOLIO_DISCOVERY_STEP_ID,
    agentId: PORTFOLIO_DISCOVERY_AGENT_ID, status: 'ok', resultKind: 'research', ...scope,
  }, {}, scope)
  if (!run?.invocationId || !run.completedAt) throw new Error('[internal] O1 research run is not complete')
  const step = await findOneWithDecryption(em, StepInstance, {
    id: run.invocationId, workflowInstanceId: instance.id, stepId: PORTFOLIO_DISCOVERY_STEP_ID, ...scope,
  }, {}, scope)
  const attempts = await em.count(StepInstance, { workflowInstanceId: instance.id, stepId: PORTFOLIO_DISCOVERY_STEP_ID, ...scope })
  if (!step || attempts !== 1 || !['ACTIVE', 'COMPLETED'].includes(step.status)) throw new Error('[internal] O1 step attempt does not match')
  const registration = await findOneWithDecryption(em, PhotographerRawData, {
    id: references.registrationId, customerEntityId: references.photographerId,
    isActive: true, deletedAt: null, ...scope,
  }, {}, scope)
  if (!registration) throw new Error('[internal] O1 registration is unavailable')
  const expected = preparePortfolioDiscoveryInput(registration)
  const actual = portfolioDiscoveryInputSchema.parse(run.input)
  if (actual.firstName !== expected.firstName || actual.lastName !== expected.lastName || actual.registrationEmail !== expected.registrationEmail || actual.originalPortfolio !== expected.originalPortfolio) {
    throw new Error('[internal] O1 run does not belong to this registration')
  }
  const prepared = preparePortfolioDiscoveryMaterial(run.output, {
    evaluationId: references.evaluationId, evaluatedAt: references.evaluatedAt,
    observedAt: run.completedAt.toISOString(),
  })
  if (instance.workflowId === DEMO_WORKFLOW_ID) {
    prepared.material = acceptDemoPortfolioDiscoverySources(prepared.material)
  }
  const ctx: CommandRuntimeContext = {
    container, auth: { sub: userId, tenantId: scope.tenantId, orgId: scope.organizationId },
    selectedOrganizationId: scope.organizationId, organizationIds: [scope.organizationId], organizationScope: null,
  }
  const stored = await container.resolve<CommandBus>('commandBus').execute<unknown, { id: string }>('photographers.evaluation.store_material', {
    input: {
      operationId: materialOperationId(run.id, 'o1:traces'),
      snapshot: {
        registrationId: references.registrationId, photographerId: references.photographerId,
        personId: references.personId, dealId: references.dealId, material: prepared.material,
      },
    }, ctx,
  })
  return { runId: run.id, tracesRef: z.string().uuid().parse(stored.result.id), status: prepared.research.status }
}
