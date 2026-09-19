import { randomUUID } from 'node:crypto'
import { TransactionContext } from '@mikro-orm/core'
import type { EntityManager } from '@mikro-orm/postgresql'
import type { AwilixContainer } from 'awilix'
import { z } from 'zod'
import { createModuleQueue } from '@open-mercato/queue'
import type { CommandRuntimeContext } from '@open-mercato/shared/lib/commands'
import { findOneWithDecryption, findWithDecryption } from '@open-mercato/shared/lib/encryption/find'
import type { RbacService } from '@open-mercato/core/modules/auth/services/rbacService'
import type { ActivityContext } from '@open-mercato/core/modules/workflows/lib/activity-executor'
import { WorkflowInstance, StepInstance } from '@open-mercato/core/modules/workflows/data/entities'
import { evaluationReviewJobSchema, evaluationScoreReceiptSchema, type EvaluationReviewJob } from '../data/evaluation-review-workflow-validators'
import { readPortfolioDiscoveryReferences } from '../data/portfolio-discovery-workflow-validators'
import { materialResponseSchema } from '../data/material-validators'
import { readEvaluationMaterial } from './material-store'
import { withDemoOperationLock } from './demo-operation-lock'

export const EVALUATION_REVIEW_QUEUE = 'photographers-evaluation-review'
export const EVALUATION_REVIEW_AGENT = 'photographers.evaluation_review'
export const EVALUATION_REVIEW_STEP = 'review'
export const EVALUATION_REVIEW_SIGNAL = 'photographers.evaluation.review.ready'
const emptyArguments = z.object({}).strict()
const dispatchReceipt = z.object({ result: z.object({ operationId: z.string().uuid() }) })

export function evaluationReviewContext(container: AwilixContainer, job: EvaluationReviewJob): CommandRuntimeContext {
  return { container, auth: { sub: job.userId, tenantId: job.tenantId, orgId: job.organizationId }, selectedOrganizationId: job.organizationId, organizationIds: [job.organizationId], organizationScope: null }
}
async function authorize(container: AwilixContainer, job: EvaluationReviewJob) {
  const features = ['photographers.evaluations.run', 'photographers.evaluations.view', 'agent_orchestrator.agents.run', 'agent_orchestrator.proposals.view', 'customers.people.view', 'customers.deals.view', 'customers.interactions.view']
  if (!await container.resolve<RbacService>('rbacService').userHasAllFeatures(job.userId, features, { tenantId: job.tenantId, organizationId: job.organizationId })) throw new Error('[internal] Evaluation review access denied')
}

export async function dispatchEvaluationReview(raw: unknown, context: ActivityContext, container: AwilixContainer) {
  emptyArguments.parse(raw)
  if (context.workflowInstance.workflowId !== 'photographers.hidden_potential' || context.branchInstanceId) throw new Error('[internal] Invalid evaluation review workflow')
  const receipt = evaluationScoreReceiptSchema.parse(context.workflowContext.scoreResult).result
  if (!receipt.reviewRequired) throw new Error('[internal] Evaluation review requires a flag')
  const job = evaluationReviewJobSchema.parse({ workflowInstanceId: context.workflowInstance.id, tenantId: context.workflowInstance.tenantId, organizationId: context.workflowInstance.organizationId, userId: context.userId, operationId: randomUUID(), scoreRef: receipt.scoreRef })
  await authorize(container, job)
  const manager = container.resolve<EntityManager>('em')
  const em = (TransactionContext.getEntityManager(manager.name) as EntityManager | undefined) ?? manager.fork()
  const scope = { tenantId: job.tenantId, organizationId: job.organizationId }
  const instance = await findOneWithDecryption(em, WorkflowInstance, { id: job.workflowInstanceId, workflowId: 'photographers.hidden_potential', ...scope }, {}, scope)
  if (!instance || instance.currentStepId !== 'disposition' || instance.status !== 'RUNNING' || instance.metadata?.initiatedBy !== job.userId) throw new Error('[internal] Evaluation review dispatch is not current')
  const persisted = evaluationScoreReceiptSchema.parse(instance.context.scoreResult).result
  if (persisted.scoreRef !== job.scoreRef || !persisted.reviewRequired) throw new Error('[internal] Evaluation review score mismatch')
  const queue = createModuleQueue<EvaluationReviewJob>(EVALUATION_REVIEW_QUEUE, { concurrency: 1 })
  try { await queue.enqueue(job, { delayMs: 500 }) } finally { await queue.close() }
  return { operationId: job.operationId }
}

export async function processEvaluationReviewJob(raw: unknown, container: AwilixContainer) {
  const job = evaluationReviewJobSchema.parse(raw)
  await authorize(container, job)
  return withDemoOperationLock(container, `evaluation-review:${job.workflowInstanceId}`, async () => {
    const scope = { tenantId: job.tenantId, organizationId: job.organizationId }
    const em = container.resolve<EntityManager>('em').fork()
    const instance = await findOneWithDecryption(em, WorkflowInstance, { id: job.workflowInstanceId, workflowId: 'photographers.hidden_potential', ...scope }, {}, scope)
    if (!instance || ['COMPLETED', 'CANCELLED', 'FAILED'].includes(instance.status)) return { status: 'obsolete' as const }
    if (instance.metadata?.initiatedBy !== job.userId) throw new Error('[internal] Evaluation review actor mismatch')
    const dispatch = dispatchReceipt.safeParse(instance.context.evaluationReviewDispatch)
    if (!dispatch.success) throw new Error('[internal] Evaluation review dispatch is not committed')
    if (dispatch.data.result.operationId !== job.operationId) return { status: 'obsolete' as const }
    if (instance.currentStepId !== EVALUATION_REVIEW_STEP || instance.status !== 'PAUSED') throw new Error('[internal] Evaluation review wait is not ready')
    const attempts = await findWithDecryption(em, StepInstance, { workflowInstanceId: instance.id, stepId: EVALUATION_REVIEW_STEP, branchInstanceId: null, ...scope }, { limit: 2 }, scope)
    if (attempts.length !== 1 || attempts[0].status !== 'ACTIVE') throw new Error('[internal] Evaluation review attempt is ambiguous')
    const receipt = evaluationScoreReceiptSchema.parse(instance.context.scoreResult).result
    if (receipt.scoreRef !== job.scoreRef || !receipt.reviewRequired) throw new Error('[internal] Evaluation review score mismatch')
    const references = readPortfolioDiscoveryReferences(instance.context)
    const ctx = evaluationReviewContext(container, job)
    const score = materialResponseSchema.parse(await readEvaluationMaterial(job.scoreRef, ctx))
    if (score.kind !== 'score' || score.data.flags.length === 0 || score.data.suggestedAction !== 'review' || score.data.factsRef !== receipt.factsRef || score.data.rulesVersion !== receipt.rulesVersion) throw new Error('[internal] Invalid flagged score')
    for (const key of ['registrationId', 'evaluationId', 'photographerId', 'personId', 'dealId'] as const) {
      if (score[key] !== references[key]) throw new Error('[internal] Evaluation review material ownership mismatch')
    }
    if (Date.parse(score.data.evaluatedAt) !== Date.parse(references.evaluatedAt)) throw new Error('[internal] Evaluation review date mismatch')
    const { publishEvaluationReview } = await import('./evaluation-review-publication')
    return publishEvaluationReview(job, attempts[0].id, { evaluationId: references.evaluationId, registrationId: references.registrationId, photographerId: references.photographerId, personId: references.personId, dealId: references.dealId, factsRef: receipt.factsRef, scoreRef: job.scoreRef }, container)
  })
}
