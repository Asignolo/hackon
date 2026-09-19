import { LockMode } from '@mikro-orm/core'
import type { EntityManager } from '@mikro-orm/postgresql'
import { asValue, type AwilixContainer } from 'awilix'
import { z } from 'zod'
import { createModuleQueue } from '@open-mercato/queue'
import type { CommandBus, CommandRuntimeContext } from '@open-mercato/shared/lib/commands'
import type { TenantDataEncryptionService } from '@open-mercato/shared/lib/encryption/tenantDataEncryptionService'
import { findOneWithDecryption, findWithDecryption } from '@open-mercato/shared/lib/encryption/find'
import type { RbacService } from '@open-mercato/core/modules/auth/services/rbacService'
import type { ActivityContext } from '@open-mercato/core/modules/workflows/lib/activity-executor'
import type * as WorkflowExecutor from '@open-mercato/core/modules/workflows/lib/workflow-executor'
import type * as SignalHandler from '@open-mercato/core/modules/workflows/lib/signal-handler'
import { WorkflowInstance, StepInstance } from '@open-mercato/core/modules/workflows/data/entities'
import { AgentRun } from '@open-mercato/enterprise/modules/agent_orchestrator/data/entities'
import type { AgentRuntimeService } from '@open-mercato/enterprise/modules/agent_orchestrator/lib/runtime/agentRuntime'
import { PhotographerRawData } from '../data/entities'
import { portfolioDiscoveryStartSchema, portfolioDiscoveryPreparationSchema, portfolioDiscoveryJobSchema, type PortfolioDiscoveryJob } from '../data/portfolio-discovery-workflow-validators'
import { preparePortfolioDiscoveryInput, PORTFOLIO_DISCOVERY_AGENT_ID, PORTFOLIO_DISCOVERY_STEP_ID, PORTFOLIO_DISCOVERY_WORKFLOW_ID } from './portfolio-discovery-contract'
import { readRegistrationCrm } from './registration-crm'
import { withDemoOperationLock } from './demo-operation-lock'

export const PORTFOLIO_DISCOVERY_QUEUE = 'photographers-portfolio-discovery'
export const PORTFOLIO_DISCOVERY_SIGNAL = 'photographers.o1.ready'
const emptyArgumentsSchema = z.object({}).strict()
const preparationReceiptSchema = z.object({ result: portfolioDiscoveryPreparationSchema })
const discoveryFeatures = ['photographers.view', 'photographers.evaluations.run', 'photographers.evaluations.manage', 'agent_orchestrator.trace.view', 'agent_orchestrator.agents.run', 'agent_orchestrator.web_search', 'customers.people.view', 'customers.deals.view']

type Scope = { tenantId: string; organizationId: string }
function actorContext(container: AwilixContainer, scope: Scope, userId: string): CommandRuntimeContext {
  return { container, auth: { sub: userId, tenantId: scope.tenantId, orgId: scope.organizationId }, selectedOrganizationId: scope.organizationId, organizationIds: [scope.organizationId], organizationScope: null }
}
async function authorize(container: AwilixContainer, scope: Scope, userId: string) {
  if (!await container.resolve<RbacService>('rbacService').userHasAllFeatures(userId, discoveryFeatures, scope)) throw new Error('[internal] O1 execution access denied')
}
async function requireDiscoveryEncryption(container: AwilixContainer, scope: Scope) {
  const encryption = container.resolve<TenantDataEncryptionService>('tenantEncryptionService')
  if (!encryption.isEnabled()) throw new Error('[internal] O1 encryption is unavailable')
  for (const [entityId, fields] of Object.entries({
    'agent_orchestrator:agent_run': ['input', 'output'],
    'agent_orchestrator:agent_tool_call': ['request_summary', 'response_summary'],
    'photographers:photographer_evaluation_material': ['body'],
  })) {
    const probe = Object.fromEntries(fields.map((field) => [field, 'o1-encryption-probe']))
    const encrypted = await encryption.encryptEntityPayload(entityId, probe, scope.tenantId, scope.organizationId)
    if (fields.some((field) => typeof encrypted[field] !== 'string' || encrypted[field] === probe[field])) throw new Error('[internal] O1 encryption is unavailable')
  }
}
function assertWorkflow(instance: WorkflowInstance) {
  if (instance.workflowId !== PORTFOLIO_DISCOVERY_WORKFLOW_ID) throw new Error('[internal] Invalid O1 workflow binding')
}

export async function preparePortfolioDiscoveryWorkflow(raw: unknown, context: ActivityContext, container: AwilixContainer) {
  emptyArgumentsSchema.parse(raw)
  assertWorkflow(context.workflowInstance)
  const userId = z.string().uuid().parse(context.userId)
  const scope = { tenantId: context.workflowInstance.tenantId, organizationId: context.workflowInstance.organizationId }
  await authorize(container, scope, userId)
  await requireDiscoveryEncryption(container, scope)
  const input = portfolioDiscoveryStartSchema.parse(context.workflowContext)
  const ctx = actorContext(container, scope, userId)
  await container.resolve<CommandBus>('commandBus').execute('photographers.registration.prepare_crm', { input: { registrationId: input.registrationId }, ctx })
  const crm = await readRegistrationCrm({ registrationId: input.registrationId }, ctx)
  if (crm.status !== 'ready') throw new Error('[internal] O1 registration is not ready')
  return portfolioDiscoveryPreparationSchema.parse({ ...input, photographerId: crm.photographerId, personId: crm.personId, dealId: crm.dealId, userId })
}

export async function dispatchPortfolioDiscoveryWorkflow(raw: unknown, context: ActivityContext, _container: AwilixContainer) {
  emptyArgumentsSchema.parse(raw)
  assertWorkflow(context.workflowInstance)
  const { result: prepared } = preparationReceiptSchema.parse(context.workflowContext.o1Preparation)
  if (prepared.userId !== context.userId) throw new Error('[internal] O1 execution actor changed')
  const job = portfolioDiscoveryJobSchema.parse({ workflowInstanceId: context.workflowInstance.id, tenantId: context.workflowInstance.tenantId, organizationId: context.workflowInstance.organizationId })
  const queue = createModuleQueue<PortfolioDiscoveryJob>(PORTFOLIO_DISCOVERY_QUEUE, { concurrency: 1 })
  try { await queue.enqueue(job, { delayMs: 500 }) } finally { await queue.close() }
  return { workflowInstanceId: job.workflowInstanceId }
}

async function deliverResult(instance: WorkflowInstance, step: StepInstance, run: AgentRun, userId: string, container: AwilixContainer) {
  const scope = { tenantId: instance.tenantId, organizationId: instance.organizationId }
  const executor = container.resolve<typeof WorkflowExecutor>('workflowExecutor')
  const signalHandler = container.resolve<typeof SignalHandler>('signalHandler')
  const signalContainer = container.createScope()
  let continueExecution = false
  signalContainer.register({ workflowExecutor: asValue({ ...executor, executeWorkflow: async () => { continueExecution = true } }) })
  try {
    await container.resolve<EntityManager>('em').fork().transactional(async (transaction) => {
      const current = await findOneWithDecryption(transaction, WorkflowInstance, { id: instance.id, workflowId: PORTFOLIO_DISCOVERY_WORKFLOW_ID, ...scope }, { lockMode: LockMode.PESSIMISTIC_WRITE }, scope)
      if (!current || ['COMPLETED', 'FAILED', 'CANCELLED'].includes(current.status)) return
      if (current.currentStepId !== PORTFOLIO_DISCOVERY_STEP_ID) return
      const attempt = await findOneWithDecryption(transaction, StepInstance, { id: step.id, workflowInstanceId: instance.id, stepId: PORTFOLIO_DISCOVERY_STEP_ID, ...scope }, {}, scope)
      if (!attempt || attempt.status !== 'ACTIVE') throw new Error('[internal] O1 completion attempt is unavailable')
      await signalHandler.sendSignal(transaction, signalContainer, { instanceId: instance.id, ...scope, userId, signalName: PORTFOLIO_DISCOVERY_SIGNAL, payload: { o1RunId: run.id } })
    })
    if (continueExecution) await executor.executeWorkflow(container.resolve<EntityManager>('em').fork(), container, instance.id, { userId })
  } finally { await signalContainer.dispose() }
}

export async function processPortfolioDiscoveryJob(raw: unknown, container: AwilixContainer) {
  const job = portfolioDiscoveryJobSchema.parse(raw)
  return withDemoOperationLock(container, `o1:${job.workflowInstanceId}`, async () => {
    const { workflowInstanceId, ...scope } = job
    const em = container.resolve<EntityManager>('em').fork()
    let instance = await findOneWithDecryption(em, WorkflowInstance, { id: workflowInstanceId, workflowId: PORTFOLIO_DISCOVERY_WORKFLOW_ID, ...scope }, {}, scope)
    if (!instance || ['COMPLETED', 'FAILED', 'CANCELLED'].includes(instance.status)) return
    const { result: prepared } = preparationReceiptSchema.parse(instance.context.o1Preparation)
    await authorize(container, scope, prepared.userId)
    if (instance.metadata?.initiatedBy !== prepared.userId) throw new Error('[internal] O1 execution actor does not match')
    if (instance.status === 'RUNNING') {
      await container.resolve<typeof WorkflowExecutor>('workflowExecutor').executeWorkflow(em.fork(), container, instance.id, { userId: prepared.userId })
      instance = await findOneWithDecryption(em.fork(), WorkflowInstance, { id: workflowInstanceId, workflowId: PORTFOLIO_DISCOVERY_WORKFLOW_ID, ...scope }, {}, scope)
    }
    if (!instance || ['COMPLETED', 'FAILED', 'CANCELLED'].includes(instance.status)) return
    if (instance.currentStepId !== PORTFOLIO_DISCOVERY_STEP_ID) return
    if (instance.status !== 'PAUSED') throw new Error('[internal] O1 wait is not ready')
    const steps = await findWithDecryption(em, StepInstance, { workflowInstanceId: instance.id, stepId: PORTFOLIO_DISCOVERY_STEP_ID, ...scope }, { limit: 2 }, scope)
    if (steps.length !== 1 || steps[0].status !== 'ACTIVE') throw new Error('[internal] O1 step attempt is ambiguous')
    const step = steps[0]
    await requireDiscoveryEncryption(container, scope)
    const ctx = actorContext(container, scope, prepared.userId)
    const crm = await readRegistrationCrm({ registrationId: prepared.registrationId }, ctx)
    if (crm.status !== 'ready' || crm.photographerId !== prepared.photographerId || crm.personId !== prepared.personId || crm.dealId !== prepared.dealId) throw new Error('[internal] O1 registration binding changed')
    const registration = await findOneWithDecryption(em, PhotographerRawData, { id: prepared.registrationId, customerEntityId: prepared.photographerId, isActive: true, deletedAt: null, ...scope }, {}, scope)
    if (!registration) throw new Error('[internal] O1 registration is unavailable')
    const binding = { workflowInstanceId: instance.id, stepId: PORTFOLIO_DISCOVERY_STEP_ID, invocationId: step.id, agentId: PORTFOLIO_DISCOVERY_AGENT_ID, ...scope }
    let run = await findOneWithDecryption(em.fork(), AgentRun, binding, {}, scope)
    if (!run) {
      try {
        await container.resolve<AgentRuntimeService>('agentRuntime').run(PORTFOLIO_DISCOVERY_AGENT_ID, preparePortfolioDiscoveryInput(registration), { ...scope, userId: prepared.userId, workflowInstanceId: instance.id, stepId: PORTFOLIO_DISCOVERY_STEP_ID, invocationId: step.id, runTimeoutMs: 300_000 })
      } catch {
        run = await findOneWithDecryption(em.fork(), AgentRun, binding, {}, scope)
        if (!run?.completedAt) throw new Error('[internal] O1 invocation did not complete')
      }
      run = await findOneWithDecryption(em.fork(), AgentRun, binding, {}, scope)
    }
    if (!run || !run.completedAt) throw new Error('[internal] O1 run is not complete')
    if (run.status !== 'ok' || run.resultKind !== 'research') {
      await container.resolve<typeof WorkflowExecutor>('workflowExecutor').completeWorkflow(em.fork(), container, instance.id, 'FAILED', { failedStepId: PORTFOLIO_DISCOVERY_STEP_ID, error: { code: 'photographers.o1.run_failed' } })
      return
    }
    await deliverResult(instance, step, run, prepared.userId, container)
  })
}
