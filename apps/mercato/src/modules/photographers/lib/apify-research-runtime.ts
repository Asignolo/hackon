import { z } from 'zod'
import { asValue, type AwilixContainer } from 'awilix'
import { LockMode } from '@mikro-orm/core'
import type { EntityManager } from '@mikro-orm/postgresql'
import { getTelemetryRuntime } from '@open-mercato/shared/lib/telemetry/runtime'
import { createModuleQueue } from '@open-mercato/queue'
import type { CommandBus, CommandRuntimeContext } from '@open-mercato/shared/lib/commands'
import { findOneWithDecryption, findWithDecryption } from '@open-mercato/shared/lib/encryption/find'
import type { TenantDataEncryptionService } from '@open-mercato/shared/lib/encryption/tenantDataEncryptionService'
import type { RbacService } from '@open-mercato/core/modules/auth/services/rbacService'
import type { ActivityContext } from '@open-mercato/core/modules/workflows/lib/activity-executor'
import type * as WorkflowExecutor from '@open-mercato/core/modules/workflows/lib/workflow-executor'
import type * as SignalHandler from '@open-mercato/core/modules/workflows/lib/signal-handler'
import { WorkflowInstance, StepInstance } from '@open-mercato/core/modules/workflows/data/entities'
import { AgentRun, AgentToolCall } from '@open-mercato/enterprise/modules/agent_orchestrator/data/entities'
import type { AgentRuntimeService } from '@open-mercato/enterprise/modules/agent_orchestrator/lib/runtime/agentRuntime'
import { PhotographerEvaluationMaterial } from '../data/entities'
import { apifyResearchArgumentsSchema, apifyResearchOutcomeSchema, apifyResearchSnapshotSchema } from '../data/apify-research-validators'
import { portfolioDiscoveryResultSchema } from '../data/portfolio-discovery-validators'
import { readPortfolioDiscoveryReferences } from '../data/portfolio-discovery-workflow-validators'
import type { EvaluationMaterial } from '../data/evaluation-validators'
import { materialOperationId } from './material-codec'
import { readEvaluationMaterial } from './material-store'
import { preparePortfolioDiscoveryMaterial, PORTFOLIO_DISCOVERY_AGENT_ID } from './portfolio-discovery-contract'
import { withDemoOperationLock } from './demo-operation-lock'

export const APIFY_RESEARCH_AGENT_ID = 'photographers.apify_link_researcher_o2'
export const APIFY_RESEARCH_STEP_ID = 'apify_o2'
export const APIFY_RESEARCH_QUEUE = 'photographers-apify-research'
export const APIFY_RESEARCH_SIGNAL = 'photographers.apify_o2.ready'
export const apifyResearchJobSchema = apifyResearchArgumentsSchema.extend({
  workflowInstanceId: z.string().uuid(), tenantId: z.string().uuid(), organizationId: z.string().uuid(),
  stepId: z.string().min(1), userId: z.string().uuid(),
}).strict()
export type ApifyResearchJob = z.infer<typeof apifyResearchJobSchema>
type Snapshot = z.infer<typeof apifyResearchSnapshotSchema>
type Receipt = { researchRef: string; runId: string | null; status: string }
const requiredFeatures = ['photographers.evaluations.run', 'photographers.evaluations.view', 'photographers.evaluations.manage', 'customers.people.view', 'customers.deals.view', 'customers.interactions.view', 'customers.interactions.manage', 'agent_orchestrator.agents.run', 'agent_orchestrator.trace.view', 'integration_apify.research']

function actorContext(container: AwilixContainer, job: ApifyResearchJob): CommandRuntimeContext {
  return { container, auth: { sub: job.userId, tenantId: job.tenantId, orgId: job.organizationId }, selectedOrganizationId: job.organizationId, organizationIds: [job.organizationId], organizationScope: null }
}
async function authorize(container: AwilixContainer, job: ApifyResearchJob) {
  if (!await container.resolve<RbacService>('rbacService').userHasAllFeatures(job.userId, requiredFeatures, job)) throw new Error('[internal] Apify research access denied')
}

export async function dispatchApifyResearchWorkflow(raw: unknown, context: ActivityContext, container: AwilixContainer) {
  const input = apifyResearchArgumentsSchema.parse(raw)
  if (context.workflowInstance.workflowId !== 'photographers.hidden_potential' || context.branchInstanceId) throw new Error('[internal] Invalid Apify workflow binding')
  const job = apifyResearchJobSchema.parse({ ...input,
    workflowInstanceId: context.workflowInstance.id, stepId: APIFY_RESEARCH_STEP_ID,
    tenantId: context.workflowInstance.tenantId, organizationId: context.workflowInstance.organizationId, userId: context.userId,
  })
  await authorize(container, job)
  const queue = createModuleQueue<ApifyResearchJob>(APIFY_RESEARCH_QUEUE, { concurrency: 1 })
  try { await queue.enqueue(job, { delayMs: 500 }) } finally { await queue.close() }
  return { workflowInstanceId: job.workflowInstanceId, signalName: APIFY_RESEARCH_SIGNAL }
}

async function requireEncryption(container: AwilixContainer, job: ApifyResearchJob) {
  const encryption = container.resolve<TenantDataEncryptionService>('tenantEncryptionService')
  if (!encryption.isEnabled()) throw new Error('[internal] Apify research encryption unavailable')
  for (const [entity, fields] of Object.entries({
    'agent_orchestrator:agent_run': ['input', 'output'],
    'agent_orchestrator:agent_tool_call': ['request_summary', 'response_summary'],
    'photographers:photographer_evaluation_material': ['body'],
  })) {
    const probe = Object.fromEntries(fields.map((field) => [field, 'apify-encryption-probe']))
    const sealed = await encryption.encryptEntityPayload(entity, probe, job.tenantId, job.organizationId)
    if (fields.some((field) => typeof sealed[field] !== 'string' || sealed[field] === probe[field])) throw new Error('[internal] Apify research encryption unavailable')
  }
}

async function runResearch(job: ApifyResearchJob, instance: WorkflowInstance, container: AwilixContainer): Promise<Receipt> {
  const scope = { tenantId: job.tenantId, organizationId: job.organizationId }
  const em = container.resolve<EntityManager>('em').fork()
  const ctx = actorContext(container, job)
  const references = readPortfolioDiscoveryReferences(instance.context)
  const traces = await readEvaluationMaterial(job.tracesRef, ctx)
  if (traces.kind !== 'traces' || traces.evaluationId !== references.evaluationId
    || traces.photographerId !== references.photographerId || traces.personId !== references.personId
    || traces.dealId !== references.dealId || traces.registrationId !== references.registrationId
    || traces.data.evaluatedAt !== references.evaluatedAt) throw new Error('[internal] Apify O1 material binding mismatch')
  const o1Run = await findOneWithDecryption(em, AgentRun, { id: job.o1RunId, agentId: PORTFOLIO_DISCOVERY_AGENT_ID,
    workflowInstanceId: instance.id, status: 'ok', resultKind: 'research', ...scope }, {}, scope)
  if (!o1Run?.completedAt) throw new Error('[internal] Apify O1 run is unavailable')
  const o1 = portfolioDiscoveryResultSchema.parse(o1Run.output)
  const expected = preparePortfolioDiscoveryMaterial(o1, { evaluationId: references.evaluationId,
    evaluatedAt: references.evaluatedAt, observedAt: o1Run.completedAt.toISOString() })
  const expectedRef = materialOperationId(materialOperationId(materialOperationId(o1Run.id, 'o1:traces'), `${job.tenantId}:${job.organizationId}`), 'manifest')
  if (job.tracesRef !== expectedRef || JSON.stringify(traces.data) !== JSON.stringify(expected.material.data)) throw new Error('[internal] Apify O1 result mismatch')
  const operationId = materialOperationId(job.tracesRef, 'apify-o2:claim')
  const resultOperationId = materialOperationId(job.tracesRef, 'apify-o2:result')
  const findMaterial = (operation: string) => findOneWithDecryption(em.fork(), PhotographerEvaluationMaterial, { operationId: operation, ...scope }, {}, scope)
  const requireBinding = (material: Awaited<ReturnType<typeof readEvaluationMaterial>>) => {
    if (material.kind !== 'apify_research' || material.data.o1RunId !== job.o1RunId
      || material.data.tracesRef !== job.tracesRef || material.data.workflowInstanceId !== instance.id
      || material.evaluationId !== traces.evaluationId || material.photographerId !== traces.photographerId
      || material.personId !== traces.personId || material.dealId !== traces.dealId
      || material.registrationId !== traces.registrationId) throw new Error('[internal] Apify receipt binding mismatch')
  }
  const existingResult = await findMaterial(resultOperationId)
  if (existingResult) {
    const result = await readEvaluationMaterial(existingResult.id, ctx)
    requireBinding(result)
    if (result.kind !== 'apify_research' || result.data.state !== 'finished') throw new Error('[internal] Invalid Apify receipt')
    return { researchRef: result.id, runId: result.data.runId, status: result.data.outcomeStatus ?? 'error' }
  }
  const store = async (operation: string, material: EvaluationMaterial) => {
    const saved = await container.resolve<CommandBus>('commandBus').execute<unknown, { id: string }>('photographers.evaluation.store_material', {
      input: { operationId: operation, snapshot: { photographerId: traces.photographerId, personId: traces.personId,
        registrationId: traces.registrationId, dealId: traces.dealId, material } }, ctx,
    })
    return z.string().uuid().parse(saved.result.id)
  }
  const claim = await findMaterial(operationId)
  let snapshot: Snapshot
  let claimRef: string
  if (claim) {
    const stored = await readEvaluationMaterial(claim.id, ctx)
    requireBinding(stored)
    if (stored.kind !== 'apify_research' || stored.data.state !== 'claimed') throw new Error('[internal] Invalid Apify claim')
    snapshot = stored.data
    claimRef = stored.id
  } else {
    await requireEncryption(container, job)
    snapshot = { schemaVersion: 1, evaluationId: references.evaluationId, evaluatedAt: references.evaluatedAt,
      o1RunId: job.o1RunId, tracesRef: job.tracesRef, workflowInstanceId: instance.id, stepId: job.stepId,
      invocationId: operationId, userId: job.userId, state: 'claimed', runId: null, runStatus: null, outcomeStatus: null, payloadRefs: [] }
    claimRef = await store(operationId, { kind: 'apify_research', data: snapshot })
  }
  const binding = { workflowInstanceId: snapshot.workflowInstanceId, stepId: snapshot.stepId, invocationId: snapshot.invocationId, agentId: APIFY_RESEARCH_AGENT_ID, ...scope }
  let run = await findOneWithDecryption(em.fork(), AgentRun, binding, {}, scope)
  let invocationError: string | null = null
  if (!claim && !run) {
    try {
      await container.resolve<AgentRuntimeService>('agentRuntime').run(APIFY_RESEARCH_AGENT_ID, { o1: o1.data }, {
        ...scope, userId: job.userId, workflowInstanceId: snapshot.workflowInstanceId,
        stepId: snapshot.stepId, invocationId: snapshot.invocationId, runTimeoutMs: 300_000,
      })
    } catch {
      invocationError = '[internal] Apify agent invocation failed; inspect the scoped agent run'
      getTelemetryRuntime()?.reportError(new Error(invocationError), { module: 'photographers', code: 'photographers.apify_invocation_failed' })
    }
    run = await findOneWithDecryption(em.fork(), AgentRun, binding, {}, scope)
  }
  if ((!run || !run.completedAt) && !invocationError) return { researchRef: claimRef, runId: run?.id ?? null, status: 'pending' }
  if (run && !run.completedAt) return { researchRef: claimRef, runId: run.id, status: 'pending' }
  const parsed = apifyResearchOutcomeSchema.safeParse(run?.output)
  const outcome = parsed.success ? parsed.data : null
  const calls = run ? await findWithDecryption(em.fork(), AgentToolCall, { agentRunId: run.id, ...scope }, { orderBy: { createdAt: 'ASC', id: 'ASC' } }, scope) : []
  const payload = JSON.stringify({ outcome, rawOutput: run?.output ?? null, o1,
    error: run?.errorMessage ?? invocationError ?? (outcome ? null : '[internal] Apify outcome is unavailable'),
    toolCalls: calls.map((call) => ({ id: call.id, toolName: call.toolName, status: call.status,
      observedAt: call.createdAt.toISOString(), requestSummary: call.requestSummary ?? null, responseSummary: call.responseSummary ?? null,
      requestArtifactKey: call.requestArtifactKey ?? null, responseArtifactKey: call.responseArtifactKey ?? null, error: call.errorMessage ?? null })),
  })
  const payloadOperationId = materialOperationId(resultOperationId, payload)
  const payloadRefs: string[] = []
  for (let offset = 0; offset < payload.length; offset += 16000) {
    const index = payloadRefs.length
    payloadRefs.push(await store(materialOperationId(payloadOperationId, `part:${index}`), { kind: 'apify_research_part', data: {
      schemaVersion: 1, evaluationId: snapshot.evaluationId, evaluatedAt: snapshot.evaluatedAt,
      invocationId: snapshot.invocationId, index, content: payload.slice(offset, offset + 16000),
    } }))
  }
  const researchRef = await store(resultOperationId, { kind: 'apify_research', data: {
    ...snapshot, state: 'finished', runId: run?.id ?? null, runStatus: run?.status ?? 'error',
    outcomeStatus: outcome?.data.status ?? null, payloadRefs,
  } })
  return { researchRef, runId: run?.id ?? null, status: outcome?.data.status ?? 'error' }
}

async function deliverResult(job: ApifyResearchJob, receipt: Receipt, container: AwilixContainer) {
  const scope = { tenantId: job.tenantId, organizationId: job.organizationId }
  const executor = container.resolve<typeof WorkflowExecutor>('workflowExecutor')
  const signalContainer = container.createScope()
  let resume = false
  signalContainer.register({ workflowExecutor: asValue({ ...executor, executeWorkflow: async () => { resume = true } }) })
  try {
    await container.resolve<EntityManager>('em').fork().transactional(async (transaction) => {
      const instance = await findOneWithDecryption(transaction, WorkflowInstance, { id: job.workflowInstanceId, ...scope }, { lockMode: LockMode.PESSIMISTIC_WRITE }, scope)
      if (!instance || instance.currentStepId !== job.stepId || instance.status !== 'PAUSED') return
      await container.resolve<typeof SignalHandler>('signalHandler').sendSignal(transaction, signalContainer, {
        instanceId: instance.id, ...scope, userId: job.userId, signalName: APIFY_RESEARCH_SIGNAL,
        payload: { apifyResearchRef: receipt.researchRef, apifyRunId: receipt.runId, apifyResearchStatus: receipt.status },
      })
    })
    if (resume) await executor.executeWorkflow(container.resolve<EntityManager>('em').fork(), container, job.workflowInstanceId, { userId: job.userId })
  } finally { await signalContainer.dispose() }
}

export async function processApifyResearchJob(raw: unknown, container: AwilixContainer) {
  const job = apifyResearchJobSchema.parse(raw)
  await authorize(container, job)
  return withDemoOperationLock(container, `${job.tenantId}:${job.organizationId}:apify-o2:${job.tracesRef}`, async () => {
    const scope = { tenantId: job.tenantId, organizationId: job.organizationId }
    const em = container.resolve<EntityManager>('em').fork()
    let instance = await findOneWithDecryption(em, WorkflowInstance, { id: job.workflowInstanceId, workflowId: 'photographers.hidden_potential', ...scope }, {}, scope)
    if (!instance || ['COMPLETED', 'FAILED', 'CANCELLED'].includes(instance.status)) return
    if (instance.metadata?.initiatedBy !== job.userId) throw new Error('[internal] Apify workflow actor mismatch')
    if (instance.status === 'RUNNING') {
      await container.resolve<typeof WorkflowExecutor>('workflowExecutor').executeWorkflow(em.fork(), container, instance.id, { userId: job.userId })
      instance = await findOneWithDecryption(em.fork(), WorkflowInstance, { id: job.workflowInstanceId, ...scope }, {}, scope)
    }
    if (!instance || instance.currentStepId !== job.stepId || ['COMPLETED', 'FAILED', 'CANCELLED'].includes(instance.status)) return
    if (instance.status !== 'PAUSED') throw new Error('[internal] Apify workflow wait is not ready')
    const steps = await findWithDecryption(em, StepInstance, { workflowInstanceId: instance.id, stepId: job.stepId, status: 'ACTIVE', branchInstanceId: null, ...scope }, { limit: 2 }, scope)
    if (steps.length !== 1) throw new Error('[internal] Apify workflow step is ambiguous')
    const result = await runResearch(job, instance, container)
    if (result.status === 'pending') throw new Error('[internal] Apify research pending; reconcile existing invocation, never rerun paid calls')
    await deliverResult(job, result, container)
    return result
  })
}
