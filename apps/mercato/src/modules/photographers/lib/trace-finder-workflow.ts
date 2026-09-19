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
import { traceFinderInputSchema } from '../data/trace-finder-validators'
import { materialOperationId } from './material-codec'
import { prepareTraceFinderInput, prepareTraceFinderMaterial, TRACE_FINDER_AGENT_ID, TRACE_FINDER_STEP_ID, TRACE_FINDER_WORKFLOW_ID } from './trace-finder-contract'

const argumentsSchema = z.object({ runId: z.string().uuid() }).strict()
const referencesSchema = z.object({
  registrationId: z.string().uuid(), photographerId: z.string().uuid(),
  personId: z.string().uuid(), dealId: z.string().uuid(),
  evaluationId: z.string().uuid(), evaluatedAt: z.string().datetime({ offset: true }),
})

export async function storeTraceFinderWorkflowResult(raw: unknown, context: ActivityContext, container: AwilixContainer) {
  const { runId } = argumentsSchema.parse(raw)
  const { workflowInstance, userId } = context
  const scope = { tenantId: workflowInstance.tenantId, organizationId: workflowInstance.organizationId }
  if (!userId || workflowInstance.workflowId !== TRACE_FINDER_WORKFLOW_ID) throw new Error('[internal] Invalid O2 workflow binding')
  const features = ['photographers.view', 'photographers.evaluations.manage', 'agent_orchestrator.trace.view', 'customers.people.view', 'customers.deals.view']
  if (!await container.resolve<RbacService>('rbacService').userHasAllFeatures(userId, features, scope)) throw new Error('[internal] O2 material access denied')
  const em = container.resolve<EntityManager>('em').fork()
  const instance = await findOneWithDecryption(em, WorkflowInstance, { id: workflowInstance.id, workflowId: TRACE_FINDER_WORKFLOW_ID, ...scope }, {}, scope)
  if (!instance || instance.currentStepId !== TRACE_FINDER_STEP_ID || !['RUNNING', 'PAUSED'].includes(instance.status)) throw new Error('[internal] O2 step is not current')
  const references = referencesSchema.parse(instance.context)
  const run = await findOneWithDecryption(em, AgentRun, {
    id: runId, workflowInstanceId: instance.id, stepId: TRACE_FINDER_STEP_ID,
    agentId: TRACE_FINDER_AGENT_ID, status: 'ok', resultKind: 'research', ...scope,
  }, {}, scope)
  if (!run?.invocationId || !run.completedAt) throw new Error('[internal] O2 research run is not complete')
  const step = await findOneWithDecryption(em, StepInstance, {
    id: run.invocationId, workflowInstanceId: instance.id, stepId: TRACE_FINDER_STEP_ID, ...scope,
  }, {}, scope)
  const attempts = await em.count(StepInstance, { workflowInstanceId: instance.id, stepId: TRACE_FINDER_STEP_ID, ...scope })
  if (!step || attempts !== 1 || !['ACTIVE', 'COMPLETED'].includes(step.status)) throw new Error('[internal] O2 step attempt does not match')
  const registration = await findOneWithDecryption(em, PhotographerRawData, {
    id: references.registrationId, customerEntityId: references.photographerId,
    isActive: true, deletedAt: null, ...scope,
  }, {}, scope)
  if (!registration) throw new Error('[internal] O2 registration is unavailable')
  const expected = prepareTraceFinderInput(registration)
  const actual = traceFinderInputSchema.parse(run.input)
  if (actual.registrationId !== expected.registrationId || actual.firstName !== expected.firstName || actual.lastName !== expected.lastName || actual.email !== expected.email || (actual.portfolioRaw ?? '') !== expected.portfolioRaw) {
    throw new Error('[internal] O2 run does not belong to this registration')
  }
  const prepared = prepareTraceFinderMaterial(run.output, {
    evaluationId: references.evaluationId, evaluatedAt: references.evaluatedAt,
    observedAt: run.completedAt.toISOString(),
  })
  const ctx: CommandRuntimeContext = {
    container, auth: { sub: userId, tenantId: scope.tenantId, orgId: scope.organizationId },
    selectedOrganizationId: scope.organizationId, organizationIds: [scope.organizationId], organizationScope: null,
  }
  const stored = await container.resolve<CommandBus>('commandBus').execute<unknown, { id: string }>('photographers.evaluation.store_material', {
    input: {
      operationId: materialOperationId(run.id, 'o2:traces'),
      snapshot: {
        registrationId: references.registrationId, photographerId: references.photographerId,
        personId: references.personId, dealId: references.dealId, material: prepared.material,
      },
    }, ctx,
  })
  return { runId: run.id, tracesRef: z.string().uuid().parse(stored.result.id), status: prepared.research.status }
}
