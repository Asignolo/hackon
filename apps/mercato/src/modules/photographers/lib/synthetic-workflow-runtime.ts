import { randomUUID } from 'node:crypto'
import { LockMode } from '@mikro-orm/core'
import type { EntityManager } from '@mikro-orm/postgresql'
import { asValue, type AwilixContainer } from 'awilix'
import { createModuleQueue } from '@open-mercato/queue'
import { findOneWithDecryption } from '@open-mercato/shared/lib/encryption/find'
import type { CommandRuntimeContext } from '@open-mercato/shared/lib/commands'
import type { RbacService } from '@open-mercato/core/modules/auth/services/rbacService'
import type { ActivityContext } from '@open-mercato/core/modules/workflows/lib/activity-executor'
import { WorkflowInstance, WorkflowBranchInstance, StepInstance } from '@open-mercato/core/modules/workflows/data/entities'
import { sendSignal } from '@open-mercato/core/modules/workflows/lib/signal-handler'
import type * as WorkflowExecutor from '@open-mercato/core/modules/workflows/lib/workflow-executor'
import { syntheticDispatchArgsSchema, syntheticWorkflowInputSchema, syntheticWorkflowJobSchema, type SyntheticWorkflowJob } from '../data/synthetic-workflow-validators'
import { classifySyntheticCallback } from './synthetic-workflow'
import { readEvaluationMaterial } from './material-store'

export const SYNTHETIC_WORKFLOW_ID = 'photographers.synthetic-evaluation'
export const SYNTHETIC_WORKFLOW_QUEUE = 'photographers-synthetic-workflow'

function requireSyntheticMode() {
  if (process.env.OM_INTEGRATION_TEST !== 'true') throw new Error('[internal] Synthetic workflow requires integration test mode')
}

function commandContext(container: AwilixContainer, job: SyntheticWorkflowJob): CommandRuntimeContext {
  return {
    container,
    auth: { sub: job.userId, tenantId: job.tenantId, orgId: job.organizationId },
    selectedOrganizationId: job.organizationId,
    organizationIds: [job.organizationId],
    organizationScope: null,
  }
}

async function authorize(container: AwilixContainer, job: SyntheticWorkflowJob) {
  const rbac = container.resolve<RbacService>('rbacService')
  const allowed = await rbac.userHasAllFeatures(job.userId, ['photographers.evaluations.run', 'photographers.evaluations.view', 'workflows.instances.view', 'workflows.instances.signal'], { tenantId: job.tenantId, organizationId: job.organizationId })
  if (!allowed) throw new Error('[internal] Synthetic workflow actor is not authorized')
}

export async function dispatchSyntheticWorkflow(rawArgs: unknown, context: ActivityContext, container: AwilixContainer) {
  requireSyntheticMode()
  const args = syntheticDispatchArgsSchema.parse(rawArgs)
  const input = syntheticWorkflowInputSchema.parse(context.workflowContext.synthetic)
  const instance = context.workflowInstance
  if (instance.workflowId !== SYNTHETIC_WORKFLOW_ID) throw new Error('[internal] Synthetic dispatch workflow mismatch')
  const job = syntheticWorkflowJobSchema.parse({
    ...args,
    tenantId: instance.tenantId,
    organizationId: instance.organizationId,
    userId: context.userId,
    workflowInstanceId: instance.id,
    branchInstanceId: context.branchInstanceId ?? null,
    operationId: randomUUID(),
    materialId: input.materials[args.lane],
  })
  await authorize(container, job)
  const queue = createModuleQueue<SyntheticWorkflowJob>(SYNTHETIC_WORKFLOW_QUEUE, { concurrency: 1 })
  try { await queue.enqueue(job, { delayMs: 1000 }) } finally { await queue.close() }
  return { operationId: job.operationId }
}

export async function processSyntheticWorkflow(raw: unknown, container: AwilixContainer): Promise<'delivered' | 'obsolete' | 'awaiting_review'> {
  return deliverSyntheticCallback(raw, container, false)
}

export async function deliverSyntheticReviewForEngineProof(raw: unknown, container: AwilixContainer): Promise<'delivered' | 'obsolete' | 'awaiting_review'> {
  const job = syntheticWorkflowJobSchema.parse(raw)
  if (job.lane !== 'review') throw new Error('[internal] Synthetic review driver only accepts the review lane')
  return deliverSyntheticCallback(job, container, true)
}

async function deliverSyntheticCallback(raw: unknown, container: AwilixContainer, simulateReview: boolean): Promise<'delivered' | 'obsolete' | 'awaiting_review'> {
  requireSyntheticMode()
  const job = syntheticWorkflowJobSchema.parse(raw)
  await authorize(container, job)
  const scope = { tenantId: job.tenantId, organizationId: job.organizationId }
  const em = container.resolve<EntityManager>('em').fork()
  const material = await readEvaluationMaterial(job.materialId, commandContext(container, job))
  const executor = container.resolve<typeof WorkflowExecutor>('workflowExecutor')
  let continueExecution = false
  const signalContainer = container.createScope()
  signalContainer.register({ workflowExecutor: asValue({ ...executor, executeWorkflow: async () => { continueExecution = true } }) })
  const result = await em.transactional(async (transaction): Promise<'delivered' | 'obsolete' | 'awaiting_review'> => {
    const instance = await findOneWithDecryption(transaction, WorkflowInstance, { id: job.workflowInstanceId, ...scope }, { lockMode: LockMode.PESSIMISTIC_WRITE }, scope)
    if (!instance) throw new Error('[internal] Synthetic workflow instance is unavailable')
    if (instance.workflowId !== SYNTHETIC_WORKFLOW_ID) throw new Error('[internal] Synthetic callback workflow mismatch')
    const input = syntheticWorkflowInputSchema.parse(instance.context.synthetic)
    if (input.materials[job.lane] !== job.materialId || material.evaluationId !== input.evaluationId || material.photographerId !== input.photographerId || material.personId !== input.personId || material.dealId !== input.dealId) throw new Error('[internal] Synthetic material correlation mismatch')
    if (material.kind !== (job.lane === 'review' ? 'facts' : 'traces')) throw new Error('[internal] Synthetic material kind mismatch')
    if (['COMPLETED', 'CANCELLED', 'FAILED'].includes(instance.status)) return 'obsolete'
    const branch = job.branchInstanceId ? await findOneWithDecryption(transaction, WorkflowBranchInstance, { id: job.branchInstanceId, workflowInstanceId: instance.id, ...scope }, {}, scope) : null
    if (job.branchInstanceId && !branch) return 'obsolete'
    if ((job.lane === 'review') !== (job.branchInstanceId === null)) throw new Error('[internal] Synthetic callback branch mismatch')
    const context = branch?.contextNamespace ?? instance.context
    const step = await findOneWithDecryption(transaction, StepInstance, { workflowInstanceId: instance.id, branchInstanceId: job.branchInstanceId, stepId: job.waitStepId, ...scope }, { orderBy: { enteredAt: 'desc' } }, scope)
    const disposition = classifySyntheticCallback({
      operationId: job.operationId,
      waitStepId: job.waitStepId,
      currentStepId: branch?.currentStepId ?? instance.currentStepId,
      status: branch?.status ?? instance.status,
      receipt: context[`${job.lane}Dispatch`],
      waitAttemptStatus: step?.status === 'ACTIVE' || step?.status === 'COMPLETED' ? step.status : null,
    })
    if (disposition === 'obsolete') {
      const consumedOperation = context[`${job.lane}OperationId`] === job.operationId
      if (consumedOperation && step?.status === 'COMPLETED' && (instance.status === 'RUNNING' || (instance.status === 'FORKED' && branch?.status === 'ACTIVE'))) continueExecution = true
      return 'obsolete'
    }
    if (disposition === 'retry') throw new Error('[internal] Synthetic workflow dispatch is not committed yet')
    if (job.lane === 'review' && !simulateReview) return 'awaiting_review'
    await sendSignal(transaction, signalContainer, {
      instanceId: instance.id,
      ...scope,
      userId: job.userId,
      signalName: `photographers.synthetic.${job.lane}.ready`,
      payload: { [`${job.lane}MaterialId`]: job.materialId, [`${job.lane}OperationId`]: job.operationId },
    })
    return 'delivered'
  })
  if (continueExecution) await executor.executeWorkflow(em.fork(), container, job.workflowInstanceId, { userId: job.userId })
  return result
}
