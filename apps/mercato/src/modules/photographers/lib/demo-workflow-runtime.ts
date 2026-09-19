import { LockMode } from '@mikro-orm/core'
import type { EntityManager } from '@mikro-orm/postgresql'
import { asValue, type AwilixContainer } from 'awilix'
import { createModuleQueue } from '@open-mercato/queue'
import type { CommandBus, CommandRuntimeContext } from '@open-mercato/shared/lib/commands'
import { commandRegistry } from '@open-mercato/shared/lib/commands/registry'
import { CrudHttpError, isCrudHttpError } from '@open-mercato/shared/lib/crud/errors'
import { findOneWithDecryption, findWithDecryption } from '@open-mercato/shared/lib/encryption/find'
import { resolveTranslations } from '@open-mercato/shared/lib/i18n/server'
import { readJsonSafe } from '@open-mercato/shared/lib/http/readJsonSafe'
import { getCodeWorkflow } from '@open-mercato/shared/modules/workflows/code-registry'
import type { RbacService } from '@open-mercato/core/modules/auth/services/rbacService'
import type { ActivityContext } from '@open-mercato/core/modules/workflows/lib/activity-executor'
import type * as WorkflowExecutor from '@open-mercato/core/modules/workflows/lib/workflow-executor'
import type * as SignalHandler from '@open-mercato/core/modules/workflows/lib/signal-handler'
import { WorkflowInstance, WorkflowBranchInstance, StepInstance } from '@open-mercato/core/modules/workflows/data/entities'
import { AgentProposal, AgentRun, ProcessDefinition, ProcessInstance } from '@open-mercato/enterprise/modules/agent_orchestrator/data/entities'
import type { SchedulerService } from '@open-mercato/scheduler/modules/scheduler/services/schedulerService'
import { demoDispatchReceiptSchema, demoDispatchSchema, demoResearchResultSchema, demoWorkflowJobSchema, preparedPhotographerDemoSchema, type DemoWorkflowJob, type PreparedPhotographerDemo } from '../data/demo-workflow-validators'
import { requirePhotographerScope } from './scope'
import { materialOperationId } from './material-codec'
import { DEMO_REVIEW_SIGNAL, DEMO_REVIEW_STEP, DEMO_WORKFLOW_ID, DEMO_WORKFLOW_QUEUE } from './demo-workflow'
import { demoExecutionSchema } from '../data/demo-api-validators'
import { z } from 'zod'
import { messageReviewEnvelopeSchema } from '../data/proposal-review-validators'
import { withDemoOperationLock as operationLock } from './demo-operation-lock'

type Scope = { tenantId: string; organizationId: string }
type Executor = typeof WorkflowExecutor
type DemoBinding = Scope & { workflowInstanceId: string; stepId: 'wait_review'; invocationId: string; operationId: string; userId: string; prepared: PreparedPhotographerDemo }
const ownedDefinitionMetadata = z.object({ source: z.literal('photographers.demo') })

async function demoError(status: number, key: string): Promise<never> {
  const { translate } = await resolveTranslations()
  throw new CrudHttpError(status, { error: translate(`photographers.demo.errors.${key}`) })
}

async function authorize(ctx: CommandRuntimeContext, write = false) {
  if (!ctx.auth?.sub) return demoError(401, 'unauthorized')
  const scope = await requirePhotographerScope(ctx)
  const features = ['photographers.evaluations.view', 'agent_orchestrator.processes.view', 'agent_orchestrator.trace.view', 'agent_orchestrator.proposals.view', 'workflows.instances.view']
  if (write) features.push('photographers.evaluations.run', 'agent_orchestrator.processes.run')
  if (!await ctx.container.resolve<RbacService>('rbacService').userHasAllFeatures(ctx.auth.sub, features, scope)) return demoError(403, 'forbidden')
  return scope
}

export async function assertPhotographerDemoAvailable(ctx: CommandRuntimeContext) {
  const scope = await authorize(ctx, true)
  if (!getCodeWorkflow(DEMO_WORKFLOW_ID)?.enabled) return demoError(503, 'unavailable')
  for (const key of ['workflowExecutor', 'signalHandler', 'workflowFunction:photographers.demo.dispatch', 'workflowFunction:photographers.demo.finalize', 'commandBus', 'schedulerService', 'dispositionService', 'guardrailService']) {
    if (!ctx.container.hasRegistration(key)) return demoError(503, 'unavailable')
  }
  for (const id of ['agent_orchestrator.processes.startExecution', 'agent_orchestrator.runs.create', 'agent_orchestrator.proposals.create']) {
    if (!await commandRegistry.load(id)) return demoError(503, 'unavailable')
  }
  const definitions = await findWithDecryption(ctx.container.resolve<EntityManager>('em').fork(), ProcessDefinition, { ...scope, workflowId: DEMO_WORKFLOW_ID, deletedAt: null }, { limit: 2 }, scope)
  if (definitions.length > 1 || definitions.some((definition) => !definition.enabled || !ownedDefinitionMetadata.safeParse(definition.uiMetadata).success)) return demoError(409, 'unavailable')
  if (!definitions.length && (!ctx.request || !await ctx.container.resolve<RbacService>('rbacService').userHasAllFeatures(ctx.auth!.sub, ['agent_orchestrator.processes.manage'], scope))) return demoError(403, 'forbidden')
}

function actorContext(container: AwilixContainer, scope: Scope, userId: string): CommandRuntimeContext {
  return { container, auth: { sub: userId, ...scope, orgId: scope.organizationId }, selectedOrganizationId: scope.organizationId, organizationIds: [scope.organizationId], organizationScope: null }
}

export async function startDemoWorkflowOnce(executor: Executor, container: AwilixContainer, manager: Parameters<Executor['startWorkflow']>[0], options: Parameters<Executor['startWorkflow']>[1]) {
  const em = manager as EntityManager
  if (options.workflowId !== DEMO_WORKFLOW_ID) return executor.startWorkflow(em, options)
  if (!options.tenantId || !options.organizationId || !options.correlationKey?.startsWith('process_execution:')) return demoError(409, 'invalid_execution')
  const scope = { tenantId: options.tenantId, organizationId: options.organizationId }
  const prepared = preparedPhotographerDemoSchema.parse(options.initialContext?.demo)
  const executionId = options.correlationKey.slice('process_execution:'.length)
  const execution = await findOneWithDecryption(em.fork(), ProcessInstance, { id: executionId, workflowId: DEMO_WORKFLOW_ID, sourceEntityId: prepared.dealId, idempotencyKey: `photographers.demo:${prepared.requestId}`, ...scope }, {}, scope)
  if (!execution || JSON.stringify(z.object({ demo: preparedPhotographerDemoSchema }).parse(execution.input).demo) !== JSON.stringify(prepared)) return demoError(409, 'invalid_execution')
  const { assertPreparedPhotographerDemo } = await import('./demo-preparation')
  await assertPreparedPhotographerDemo(prepared, scope, container)
  return em.fork().transactional(async (transaction) => {
    await transaction.getConnection().execute('select pg_advisory_xact_lock(hashtextextended(?, 0))', [`photographers:demo:start:${scope.tenantId}:${scope.organizationId}:${options.correlationKey}`], 'all', transaction.getTransactionContext())
    const existing = await findWithDecryption(transaction, WorkflowInstance, { ...scope, workflowId: DEMO_WORKFLOW_ID, correlationKey: options.correlationKey }, { limit: 2 }, scope)
    if (existing.length > 1 || (existing[0] && existing[0].version !== 1)) return demoError(409, 'invalid_execution')
    if (existing[0]) {
      const prepared = preparedPhotographerDemoSchema.parse(options.initialContext?.demo)
      if (preparedPhotographerDemoSchema.parse(existing[0].context.demo).requestId !== prepared.requestId) return demoError(409, 'invalid_execution')
      return existing[0]
    }
    return executor.startWorkflow(transaction, options)
  })
}

async function ensureDefinition(ctx: CommandRuntimeContext, scope: Scope) {
  return operationLock(ctx.container, `definition:${scope.tenantId}:${scope.organizationId}`, async () => {
    const em = ctx.container.resolve<EntityManager>('em').fork()
    const definitions = await findWithDecryption(em, ProcessDefinition, { ...scope, workflowId: DEMO_WORKFLOW_ID, deletedAt: null }, { limit: 2 }, scope)
    if (definitions.length > 1) return demoError(409, 'invalid_execution')
    if (definitions[0]) {
      if (!definitions[0].enabled || !ownedDefinitionMetadata.safeParse(definitions[0].uiMetadata).success) return demoError(409, 'unavailable')
      return definitions[0]
    }
    if (!ctx.request) return demoError(503, 'unavailable')
    if (!await ctx.container.resolve<RbacService>('rbacService').userHasAllFeatures(ctx.auth!.sub, ['agent_orchestrator.processes.manage'], scope)) return demoError(403, 'forbidden')
    const { translate } = await resolveTranslations()
    const { POST } = await import('@open-mercato/enterprise/modules/agent_orchestrator/api/processes/route')
    const headers = new Headers(ctx.request.headers)
    headers.set('content-type', 'application/json')
    headers.delete('content-length')
    const response = await POST(new Request(new URL('/api/agent_orchestrator/processes', ctx.request.url), {
      method: 'POST', headers,
      body: JSON.stringify({ name: translate('photographers.demo.workflow.name'), workflowMode: 'workflow', workflowId: DEMO_WORKFLOW_ID, enabled: true, triggers: [{ kind: 'manual', requireFeatures: ['photographers.evaluations.run'] }], uiMetadata: { source: 'photographers.demo' } }),
    }))
    if (!response.ok) throw new CrudHttpError(response.status, await readJsonSafe(response, { error: translate('photographers.demo.errors.unavailable') }) ?? undefined)
    const created = await findOneWithDecryption(em, ProcessDefinition, { ...scope, workflowId: DEMO_WORKFLOW_ID, deletedAt: null }, {}, scope)
    if (!created) return demoError(503, 'unavailable')
    return created
  })
}

async function ensureRecoverySchedule(container: AwilixContainer, scope: Scope) {
  const { translate } = await resolveTranslations()
  await container.resolve<SchedulerService>('schedulerService').register({
    id: materialOperationId(scope.organizationId, `photographers:demo:recovery:${scope.tenantId}`),
    name: translate('photographers.demo.recovery_schedule'), scopeType: 'organization', ...scope,
    scheduleType: 'interval', scheduleValue: '1m', timezone: 'UTC', targetType: 'queue', targetQueue: DEMO_WORKFLOW_QUEUE,
    targetPayload: { kind: 'sweep', ...scope }, sourceType: 'module', sourceModule: 'photographers', isEnabled: true,
  })
}

async function enqueue(job: DemoWorkflowJob) {
  const queue = createModuleQueue<DemoWorkflowJob>(DEMO_WORKFLOW_QUEUE, { concurrency: 1 })
  try { await queue.enqueue(demoWorkflowJobSchema.parse(job), { delayMs: 500 }) } finally { await queue.close() }
}

export async function startPhotographerDemoWorkflow(raw: PreparedPhotographerDemo, ctx: CommandRuntimeContext) {
  await assertPhotographerDemoAvailable(ctx)
  const scope = await authorize(ctx, true)
  const prepared = preparedPhotographerDemoSchema.parse(raw)
  if (prepared.userId !== ctx.auth!.sub) return demoError(403, 'forbidden')
  const definition = await ensureDefinition(ctx, scope)
  await ensureRecoverySchedule(ctx.container, scope)
  await ctx.container.resolve<CommandBus>('commandBus').execute('agent_orchestrator.processes.startExecution', {
    input: { ...scope, processDefinitionId: definition.id, input: { demo: prepared }, idempotencyKey: `photographers.demo:${prepared.requestId}`, sourceEntityType: 'customers:customer_deal', sourceEntityId: prepared.dealId, triggeredBy: { kind: 'manual', ref: prepared.userId } }, ctx,
  })
  return getPhotographerDemoExecution(prepared.requestId, ctx)
}

async function findExecution(requestId: string, scope: Scope, container: AwilixContainer) {
  const execution = await findOneWithDecryption(container.resolve<EntityManager>('em').fork(), ProcessInstance, { ...scope, workflowId: DEMO_WORKFLOW_ID, idempotencyKey: `photographers.demo:${requestId}` }, {}, scope)
  if (!execution) return demoError(404, 'not_found')
  return execution
}

export async function getPhotographerDemoExecution(requestId: string, ctx: CommandRuntimeContext) {
  const scope = await authorize(ctx)
  const execution = await findExecution(requestId, scope, ctx.container)
  const { demo: prepared } = z.object({ demo: preparedPhotographerDemoSchema }).parse(execution.input)
  const em = ctx.container.resolve<EntityManager>('em').fork()
  const instance = execution.workflowInstanceId ? await findOneWithDecryption(em, WorkflowInstance, { id: execution.workflowInstanceId, workflowId: DEMO_WORKFLOW_ID, ...scope }, {}, scope) : null
  const runs = instance ? await findWithDecryption(em, AgentRun, { ...scope, workflowInstanceId: instance.id }, { orderBy: { createdAt: 'asc' }, limit: 10 }, scope) : []
  const proposal = instance ? await findOneWithDecryption(em, AgentProposal, { ...scope, workflowInstanceId: instance.id, stepId: DEMO_REVIEW_STEP, agentId: 'photographers.message_review' }, { orderBy: { createdAt: 'desc' } }, scope) : null
  const state = instance?.status
  const envelope = messageReviewEnvelopeSchema.safeParse(proposal?.payload)
  const payload = envelope.success && envelope.data.options.length === 1 ? envelope.data.options[0].actions[0].payload : null
  const reviewAttempts = instance ? await em.count(StepInstance, { ...scope, workflowInstanceId: instance.id, stepId: DEMO_REVIEW_STEP }) : 0
  let status = reviewAttempts > 1 ? 'unavailable' : state === 'COMPLETED' ? (proposal?.disposition === 'rejected' ? 'rejected' : 'completed')
    : state === 'FAILED' || execution.status === 'failed' ? 'failed'
      : state === 'CANCELLED' || execution.status === 'cancelled' ? 'cancelled'
        : state === 'PAUSED' && instance?.currentStepId === DEMO_REVIEW_STEP && proposal?.disposition === 'pending' ? 'awaiting_review'
          : instance ? 'running' : 'starting'
  if (status === 'completed' || status === 'rejected') {
    try {
      if (!proposal) return demoError(409, 'invalid_execution')
      const { readDemoRevocationHistory } = await import('./demo-workflow-history')
      const revocation = await readDemoRevocationHistory({ ...scope, proposalId: proposal.id }, ctx)
      if (revocation === 'revoked') status = 'revoked'
      else if (revocation === 'partial') status = 'failed'
    } catch (error) {
      if (isCrudHttpError(error) && error.status === 403) status = 'unavailable'
      else if (isCrudHttpError(error) && error.status === 409) status = 'failed'
      else throw error
    }
  }
  if (['starting', 'running', 'awaiting_review'].includes(status)) {
    try {
      await authorize(actorContext(ctx.container, scope, prepared.userId), true)
      if (proposal && ['approved', 'edited', 'rejected'].includes(proposal.disposition)) {
        const { probeDemoReviewEffectStatus } = await import('./demo-proposal-effects')
        if (await probeDemoReviewEffectStatus({ ...scope, proposalId: proposal.id }, ctx.container) === 'conflict') status = 'failed'
      }
    } catch (error) {
      if (isCrudHttpError(error) && error.status === 403) status = 'unavailable'
      else if (isCrudHttpError(error) && error.status === 409) status = 'failed'
      else throw error
    }
  }
  return demoExecutionSchema.parse({
    requestId, executionId: execution.id, workflowInstanceId: instance?.id ?? null, status,
    registrationId: prepared.registrationId, photographerId: prepared.photographerId, personId: prepared.personId, dealId: prepared.dealId, evaluationId: prepared.evaluationId,
    runIds: runs.map((run) => run.id), proposalId: proposal?.id ?? null, materialRefs: payload ? { factsRef: payload.factsRef, messageSnapshotId: payload.messageSnapshotId } : {},
    links: { person: `/backend/customers/people/${prepared.photographerId}`, deal: `/backend/customers/deals/${prepared.dealId}`, execution: `/backend/processes/${execution.id}`, ...(instance ? { workflow: `/backend/instances/${instance.id}` } : {}), ...(proposal ? { proposal: `/backend/caseload/${proposal.id}` } : {}) },
  })
}

export async function reconcilePhotographerDemoExecution(requestId: string, ctx: CommandRuntimeContext) {
  const scope = await authorize(ctx, true)
  const execution = await findExecution(requestId, scope, ctx.container)
  await enqueue({ kind: 'execution', ...scope, executionId: execution.id })
  return getPhotographerDemoExecution(requestId, ctx)
}

export async function enqueuePhotographerDemoDisposition(input: Scope & { proposalId: string }, _container: AwilixContainer) {
  await enqueue({ kind: 'disposition', ...input })
}

export async function dispatchPhotographerDemoWorkflow(raw: unknown, context: ActivityContext, _container: AwilixContainer) {
  const { lane } = demoDispatchSchema.parse(raw)
  const instance = context.workflowInstance
  if (instance.workflowId !== DEMO_WORKFLOW_ID || !instance.correlationKey?.startsWith('process_execution:')) return demoError(409, 'invalid_execution')
  const prepared = preparedPhotographerDemoSchema.parse(context.workflowContext.demo)
  await enqueue({ kind: 'execution', tenantId: instance.tenantId, organizationId: instance.organizationId, executionId: instance.correlationKey.slice('process_execution:'.length) })
  return { operationId: materialOperationId(prepared.requestId, lane) }
}

export async function finalizePhotographerDemoWorkflow(_raw: unknown, context: ActivityContext, container: AwilixContainer) {
  const instance = context.workflowInstance
  if (instance.workflowId !== DEMO_WORKFLOW_ID) return demoError(409, 'invalid_execution')
  const scope = { tenantId: instance.tenantId, organizationId: instance.organizationId }
  const references = z.object({ proposalId: z.string().uuid(), reviewAttemptId: z.string().uuid(), interactionId: z.string().uuid(), disposition: z.enum(['approved', 'rejected']) }).parse(context.workflowContext)
  const em = container.resolve<EntityManager>('em').fork()
  const proposal = await findOneWithDecryption(em, AgentProposal, { id: references.proposalId, workflowInstanceId: instance.id, stepId: DEMO_REVIEW_STEP, disposition: { $in: references.disposition === 'approved' ? ['approved', 'edited'] : ['rejected'] }, ...scope }, {}, scope)
  if (!proposal) return demoError(409, 'invalid_attempt')
  const run = await findOneWithDecryption(em, AgentRun, { id: proposal.runId, workflowInstanceId: instance.id, stepId: DEMO_REVIEW_STEP, invocationId: references.reviewAttemptId, ...scope }, {}, scope)
  if (!run) return demoError(409, 'invalid_attempt')
  const step = await loadWait(instance, DEMO_REVIEW_STEP, null, container)
  if (step.id !== references.reviewAttemptId || step.status !== 'COMPLETED') return demoError(409, 'invalid_attempt')
  const { readDemoEffectResult } = await import('./demo-proposal-effects')
  const effect = await readDemoEffectResult({ ...scope, proposalId: proposal.id }, container)
  if (!effect || effect.interactionId !== references.interactionId || effect.disposition !== references.disposition) return demoError(409, 'invalid_attempt')
  return references
}

async function loadWait(instance: WorkflowInstance, stepId: string, branchInstanceId: string | null, container: AwilixContainer) {
  const scope = { tenantId: instance.tenantId, organizationId: instance.organizationId }
  const steps = await findWithDecryption(container.resolve<EntityManager>('em').fork(), StepInstance, { ...scope, workflowInstanceId: instance.id, stepId, branchInstanceId }, { limit: 2, orderBy: { createdAt: 'asc' } }, scope)
  if (steps.length !== 1) return demoError(409, 'invalid_attempt')
  return steps[0]
}

async function trustedPrepared(instance: WorkflowInstance, container: AwilixContainer) {
  const prepared = preparedPhotographerDemoSchema.parse(instance.context.demo)
  const scope = { tenantId: instance.tenantId, organizationId: instance.organizationId }
  const execution = await findExecution(prepared.requestId, scope, container)
  const original = z.object({ demo: preparedPhotographerDemoSchema }).parse(execution.input).demo
  if (execution.workflowInstanceId !== instance.id || JSON.stringify(original) !== JSON.stringify(prepared)) return demoError(409, 'invalid_execution')
  const { assertPreparedPhotographerDemo } = await import('./demo-preparation')
  await assertPreparedPhotographerDemo(prepared, scope, container)
  return prepared
}

export async function getDemoReviewBinding(input: Scope & { workflowInstanceId: string }, container: AwilixContainer): Promise<DemoBinding> {
  const { workflowInstanceId, ...scope } = input
  const instance = await findOneWithDecryption(container.resolve<EntityManager>('em').fork(), WorkflowInstance, { id: workflowInstanceId, workflowId: DEMO_WORKFLOW_ID, ...scope }, {}, scope)
  if (!instance || instance.status !== 'PAUSED' || instance.currentStepId !== DEMO_REVIEW_STEP) return demoError(409, 'invalid_attempt')
  const step = await loadWait(instance, DEMO_REVIEW_STEP, null, container)
  if (step.status !== 'ACTIVE') return demoError(409, 'invalid_attempt')
  const receipt = demoDispatchReceiptSchema.parse(instance.context.reviewDispatch)
  const prepared = await trustedPrepared(instance, container)
  return { ...scope, workflowInstanceId, stepId: DEMO_REVIEW_STEP, invocationId: step.id, operationId: receipt.result.operationId, userId: prepared.userId, prepared }
}

async function deliverSignal(container: AwilixContainer, input: Scope & { workflowInstanceId: string; branchInstanceId: string | null; stepId: string; invocationId: string; userId: string; signalName: string; payload: Record<string, string> }) {
  const executor = container.resolve<Executor>('workflowExecutor')
  const signalHandler = container.resolve<typeof SignalHandler>('signalHandler')
  const signalContainer = container.createScope()
  let continueExecution = false
  signalContainer.register({ workflowExecutor: asValue({ ...executor, executeWorkflow: async () => { continueExecution = true } }) })
  const em = container.resolve<EntityManager>('em').fork()
  try {
    await em.transactional(async (transaction) => {
      const scope = { tenantId: input.tenantId, organizationId: input.organizationId }
      const instance = await findOneWithDecryption(transaction, WorkflowInstance, { id: input.workflowInstanceId, workflowId: DEMO_WORKFLOW_ID, ...scope }, { lockMode: LockMode.PESSIMISTIC_WRITE }, scope)
      if (!instance || ['COMPLETED', 'FAILED', 'CANCELLED'].includes(instance.status)) return
      const step = await findOneWithDecryption(transaction, StepInstance, { id: input.invocationId, workflowInstanceId: instance.id, stepId: input.stepId, branchInstanceId: input.branchInstanceId, ...scope }, {}, scope)
      if (!step) return demoError(409, 'invalid_attempt')
      const count = await transaction.count(StepInstance, { workflowInstanceId: instance.id, stepId: input.stepId, branchInstanceId: input.branchInstanceId, ...scope })
      if (count !== 1) return demoError(409, 'invalid_attempt')
      if (step.status === 'COMPLETED') { continueExecution = instance.status === 'RUNNING' || instance.status === 'FORKED'; return }
      if (step.status !== 'ACTIVE') return demoError(409, 'invalid_attempt')
      await signalHandler.sendSignal(transaction, signalContainer, { instanceId: instance.id, ...scope, userId: input.userId, signalName: input.signalName, payload: input.payload })
    })
    if (continueExecution) await executor.executeWorkflow(em.fork(), container, input.workflowInstanceId, { userId: input.userId })
  } finally { await signalContainer.dispose() }
}

async function processExecution(executionId: string, scope: Scope, container: AwilixContainer) {
  const em = container.resolve<EntityManager>('em').fork()
  const execution = await findOneWithDecryption(em, ProcessInstance, { id: executionId, workflowId: DEMO_WORKFLOW_ID, ...scope }, {}, scope)
  if (!execution || ['failed', 'cancelled', 'completed'].includes(execution.status)) return
  const { demo: prepared } = z.object({ demo: preparedPhotographerDemoSchema }).parse(execution.input)
  const ctx = actorContext(container, scope, prepared.userId)
  await authorize(ctx, true)
  if (!execution.workflowInstanceId) {
    const queue = createModuleQueue<{ executionId: string }>('agent-process-executions', { concurrency: 1 })
    try { await queue.enqueue({ executionId }) } finally { await queue.close() }
    return
  }
  let instance = await findOneWithDecryption(em, WorkflowInstance, { id: execution.workflowInstanceId, workflowId: DEMO_WORKFLOW_ID, ...scope }, {}, scope)
  if (!instance || ['COMPLETED', 'FAILED', 'CANCELLED'].includes(instance.status)) return
  if (instance.status === 'RUNNING' || instance.status === 'FORKED') {
    await container.resolve<Executor>('workflowExecutor').executeWorkflow(em.fork(), container, instance.id, { userId: prepared.userId })
    instance = await findOneWithDecryption(em.fork(), WorkflowInstance, { id: instance.id, ...scope }, {}, scope)
  }
  if (!instance) return
  await trustedPrepared(instance, container)
  const publication = await import('./demo-proposal-publication')
  if (instance.status === 'FORKED') {
    const branches = await findWithDecryption(em.fork(), WorkflowBranchInstance, { workflowInstanceId: instance.id, ...scope }, {}, scope)
    for (const branch of branches) {
      const lane = branch.currentStepId === 'wait_portfolio' ? 'portfolio' : branch.currentStepId === 'wait_social' ? 'social' : null
      if (!lane || branch.status !== 'PAUSED') continue
      const step = await loadWait(instance, branch.currentStepId, branch.id, container)
      if (step.status !== 'ACTIVE') continue
      const result = await publication.ensureDemoResearch({ prepared, ...scope, workflowInstanceId: instance.id, stepId: step.stepId, invocationId: step.id, lane }, container)
      await deliverSignal(container, { ...scope, workflowInstanceId: instance.id, branchInstanceId: branch.id, stepId: step.stepId, invocationId: step.id, userId: prepared.userId, signalName: `photographers.demo.${lane}.ready`, payload: { runId: result.runId, materialId: result.materialId } })
    }
    await enqueue({ kind: 'execution', executionId, ...scope })
    return
  }
  if (instance.status === 'PAUSED' && instance.currentStepId === DEMO_REVIEW_STEP) {
    const binding = await getDemoReviewBinding({ ...scope, workflowInstanceId: instance.id }, container)
    const branches = instance.context.branches as Record<string, unknown> | undefined
    const research = { portfolio: demoResearchResultSchema.parse(branches?.dispatch_portfolio), social: demoResearchResultSchema.parse(branches?.dispatch_social) }
    const published = await publication.publishDemoReview({ prepared, ...scope, workflowInstanceId: instance.id, stepId: DEMO_REVIEW_STEP, invocationId: binding.invocationId, research }, container)
    const proposal = await findOneWithDecryption(em.fork(), AgentProposal, { id: published.proposalId, ...scope }, {}, scope)
    if (proposal && proposal.disposition !== 'pending') await processDisposition(proposal.id, scope, container)
  }
}

async function processDisposition(proposalId: string, scope: Scope, container: AwilixContainer) {
  const em = container.resolve<EntityManager>('em').fork()
  const proposal = await findOneWithDecryption(em, AgentProposal, { id: proposalId, agentId: 'photographers.message_review', ...scope }, {}, scope)
  if (!proposal?.workflowInstanceId || !['approved', 'edited', 'rejected'].includes(proposal.disposition)) return
  const instance = await findOneWithDecryption(em, WorkflowInstance, { id: proposal.workflowInstanceId, workflowId: DEMO_WORKFLOW_ID, ...scope }, {}, scope)
  if (!instance || ['COMPLETED', 'FAILED', 'CANCELLED'].includes(instance.status)) return
  if (instance.status === 'RUNNING') {
    await container.resolve<Executor>('workflowExecutor').executeWorkflow(em.fork(), container, instance.id)
    return
  }
  const binding = await getDemoReviewBinding({ ...scope, workflowInstanceId: instance.id }, container)
  const run = await findOneWithDecryption(em, AgentRun, { id: proposal.runId, workflowInstanceId: instance.id, stepId: DEMO_REVIEW_STEP, invocationId: binding.invocationId, ...scope }, {}, scope)
  if (!run) return demoError(409, 'invalid_attempt')
  const { resolveDemoReview } = await import('./demo-proposal-effects')
  const result = await resolveDemoReview({ ...scope, proposalId }, container)
  await deliverSignal(container, { ...scope, workflowInstanceId: instance.id, branchInstanceId: null, stepId: DEMO_REVIEW_STEP, invocationId: binding.invocationId, userId: binding.userId, signalName: DEMO_REVIEW_SIGNAL, payload: { proposalId, disposition: result.disposition, interactionId: result.interactionId, reviewAttemptId: binding.invocationId } })
}

export async function processPhotographerDemoJob(raw: unknown, container: AwilixContainer) {
  const job = demoWorkflowJobSchema.parse(raw)
  const scope = { tenantId: job.tenantId, organizationId: job.organizationId }
  if (job.kind === 'disposition') return operationLock(container, `proposal:${job.proposalId}`, () => processDisposition(job.proposalId, scope, container))
  if (job.kind === 'execution') return operationLock(container, `execution:${job.executionId}`, () => processExecution(job.executionId, scope, container))
  const executions = await findWithDecryption(container.resolve<EntityManager>('em').fork(), ProcessInstance, { ...scope, workflowId: DEMO_WORKFLOW_ID, status: { $nin: ['completed', 'cancelled', 'failed'] }, ...(job.afterId ? { id: { $gt: job.afterId } } : {}) }, { orderBy: { id: 'asc' }, limit: 50 }, scope)
  for (const execution of executions) await enqueue({ kind: 'execution', ...scope, executionId: execution.id })
  if (executions.length === 50) await enqueue({ kind: 'sweep', ...scope, afterId: executions[executions.length - 1].id })
}
