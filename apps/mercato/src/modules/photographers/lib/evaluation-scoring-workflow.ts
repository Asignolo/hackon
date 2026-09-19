import { z } from 'zod'
import type { AwilixContainer } from 'awilix'
import { TransactionContext } from '@mikro-orm/core'
import type { EntityManager } from '@mikro-orm/postgresql'
import type { CommandBus, CommandRuntimeContext } from '@open-mercato/shared/lib/commands'
import { findOneWithDecryption } from '@open-mercato/shared/lib/encryption/find'
import type { RbacService } from '@open-mercato/core/modules/auth/services/rbacService'
import type { ActivityContext } from '@open-mercato/core/modules/workflows/lib/activity-executor'
import { StepInstance, WorkflowInstance } from '@open-mercato/core/modules/workflows/data/entities'
import { materialResponseSchema } from '../data/material-validators'
import { readPortfolioDiscoveryReferences } from '../data/portfolio-discovery-workflow-validators'
import { calculateEvaluationScore } from './evaluation-scoring'
import { readEvaluationMaterial } from './material-store'
import { materialOperationId } from './material-codec'
import { hiddenPotentialRulesSchema } from './rules-config'

const argumentsSchema = z.object({ factsRef: z.string().uuid() }).strict()
const scoringContextSchema = z.object({ factsRef: z.string().uuid(), rulesVersion: z.string().min(1).max(100), rulesSnapshot: hiddenPotentialRulesSchema })

export async function scorePhotographerWorkflow(raw: unknown, context: ActivityContext, container: AwilixContainer) {
  const { factsRef } = argumentsSchema.parse(raw)
  const userId = z.string().uuid().parse(context.userId)
  const scope = { tenantId: context.workflowInstance.tenantId, organizationId: context.workflowInstance.organizationId }
  if (context.workflowInstance.workflowId !== 'photographers.hidden_potential' || context.branchInstanceId) throw new Error('[internal] Invalid scoring workflow binding')
  const features = ['photographers.evaluations.run', 'photographers.evaluations.view', 'photographers.evaluations.manage', 'customers.people.view', 'customers.deals.view', 'customers.interactions.view', 'customers.interactions.manage']
  if (!await container.resolve<RbacService>('rbacService').userHasAllFeatures(userId, features, scope)) throw new Error('[internal] Scoring access denied')
  const manager = container.resolve<EntityManager>('em')
  const em = (TransactionContext.getEntityManager(manager.name) as EntityManager | undefined) ?? manager.fork()
  const instance = await findOneWithDecryption(em, WorkflowInstance, { id: context.workflowInstance.id, workflowId: 'photographers.hidden_potential', ...scope }, {}, scope)
  if (!instance || instance.currentStepId !== 'score' || !['RUNNING', 'PAUSED'].includes(instance.status)) throw new Error('[internal] Scoring step is not current')
  const step = await findOneWithDecryption(em, StepInstance, { workflowInstanceId: instance.id, stepId: 'score', branchInstanceId: null, ...scope }, { orderBy: { createdAt: 'DESC' } }, scope)
  const attempts = await em.count(StepInstance, { workflowInstanceId: instance.id, stepId: 'score', branchInstanceId: null, ...scope })
  if (attempts !== 1) throw new Error('[internal] Scoring attempt is ambiguous')
  if (!step || !['ACTIVE', 'COMPLETED'].includes(step.status)) throw new Error('[internal] Scoring attempt is unavailable')
  const references = readPortfolioDiscoveryReferences(instance.context)
  const scoring = scoringContextSchema.parse(instance.context)
  if (factsRef !== scoring.factsRef) throw new Error('[internal] Scoring facts reference mismatch')
  const ctx: CommandRuntimeContext = {
    container, auth: { sub: userId, tenantId: scope.tenantId, orgId: scope.organizationId },
    selectedOrganizationId: scope.organizationId, organizationIds: [scope.organizationId], organizationScope: null,
  }
  const facts = materialResponseSchema.parse(await readEvaluationMaterial(factsRef, ctx))
  if (facts.kind !== 'facts') throw new Error('[internal] Scoring requires facts material')
  const traces = materialResponseSchema.parse(await readEvaluationMaterial(facts.data.tracesRef, ctx))
  if (traces.kind !== 'traces') throw new Error('[internal] Scoring requires traces material')
  for (const material of [facts, traces]) {
    if (material.evaluationId !== references.evaluationId || material.data.evaluationId !== references.evaluationId || Date.parse(material.data.evaluatedAt) !== Date.parse(references.evaluatedAt) || material.photographerId !== references.photographerId || material.personId !== references.personId || material.dealId !== references.dealId || material.registrationId !== references.registrationId) {
      throw new Error('[internal] Scoring material does not belong to this evaluation')
    }
  }
  const traceById = new Map(traces.data.traces.map((trace) => [trace.id, trace]))
  if (traceById.size !== traces.data.traces.length) throw new Error('[internal] Ambiguous scoring traces')
  for (const fact of facts.data.facts) {
    if (fact.state === 'unknown') continue
    const trace = traceById.get(fact.traceId)
    if (!trace || trace.status !== 'confirmed' || trace.rejectionRef || (fact.owner === 'registry' && trace.kind !== 'registry')) throw new Error('[internal] Scoring requires confirmed source traces')
  }
  const rules = scoring.rulesSnapshot
  if (rules.version !== scoring.rulesVersion) throw new Error('[internal] Scoring rules version is unavailable')
  const score = calculateEvaluationScore({ facts: facts.data, factsRef, rules })
  const stored = await container.resolve<CommandBus>('commandBus').execute<unknown, { id: string }>('photographers.evaluation.store_material', {
    input: {
      operationId: materialOperationId(references.evaluationId, `score:${factsRef}:${scoring.rulesVersion}`),
      snapshot: {
        registrationId: references.registrationId, photographerId: references.photographerId,
        personId: references.personId, dealId: references.dealId, material: { kind: 'score', data: score },
      },
    }, ctx,
  })
  return { scoreRef: z.string().uuid().parse(stored.result.id), factsRef, rulesVersion: score.rulesVersion }
}
