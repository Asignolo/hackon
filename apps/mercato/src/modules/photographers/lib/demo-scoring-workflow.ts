import { z } from 'zod'
import { TransactionContext } from '@mikro-orm/core'
import type { EntityManager } from '@mikro-orm/postgresql'
import type { AwilixContainer } from 'awilix'
import type { CommandRuntimeContext } from '@open-mercato/shared/lib/commands'
import { findOneWithDecryption } from '@open-mercato/shared/lib/encryption/find'
import type { ActivityContext } from '@open-mercato/core/modules/workflows/lib/activity-executor'
import { WorkflowInstance } from '@open-mercato/core/modules/workflows/data/entities'
import type { RbacService } from '@open-mercato/core/modules/auth/services/rbacService'
import { DEMO_WORKFLOW_ID, preparedPhotographerDemoSchema } from '../data/demo-workflow-validators'
import { readApifyResearchResult } from './apify-research-material'
import { storeDemoO2Evaluation } from './demo-o2-evaluation'
import { DEMO_O1_SOURCE_ASSUMPTION } from './demo-o2-facts'
import { hiddenPotentialRulesSchema } from './rules-config'

export async function scoreDemoWorkflow(raw: unknown, context: ActivityContext, container: AwilixContainer) {
  const { apifyResearchRef } = z.object({ apifyResearchRef: z.string().uuid() }).strict().parse(raw)
  const userId = z.string().uuid().parse(context.userId)
  const scope = { tenantId: context.workflowInstance.tenantId, organizationId: context.workflowInstance.organizationId }
  if (context.workflowInstance.workflowId !== DEMO_WORKFLOW_ID || context.branchInstanceId) throw new Error('[internal] Invalid demo scoring workflow')
  if (!await container.resolve<RbacService>('rbacService').userHasAllFeatures(userId, ['photographers.evaluations.run', 'photographers.evaluations.view', 'photographers.evaluations.manage'], scope)) throw new Error('[internal] Demo scoring access denied')
  const manager = container.resolve<EntityManager>('em')
  const em = (TransactionContext.getEntityManager(manager.name) as EntityManager | undefined) ?? manager.fork()
  const instance = await findOneWithDecryption(em, WorkflowInstance, { id: context.workflowInstance.id, workflowId: DEMO_WORKFLOW_ID, ...scope }, {}, scope)
  if (!instance || instance.version !== 3 || instance.currentStepId !== 'normalize' || instance.context.apifyResearchRef !== apifyResearchRef) throw new Error('[internal] Demo scoring result binding mismatch')
  const prepared = preparedPhotographerDemoSchema.parse(instance.context.demo)
  if (prepared.userId !== userId) throw new Error('[internal] Demo scoring actor mismatch')
  const ctx: CommandRuntimeContext = { container, auth: { sub: userId, ...scope, orgId: scope.organizationId }, selectedOrganizationId: scope.organizationId, organizationIds: [scope.organizationId], organizationScope: null }
  const material = await readApifyResearchResult(apifyResearchRef, ctx)
  for (const field of ['evaluationId', 'registrationId', 'photographerId', 'personId', 'dealId'] as const) {
    if (material[field] !== prepared[field]) throw new Error('[internal] Demo O2 owner mismatch')
  }
  const o1 = z.object({ result: z.object({ runId: z.string().uuid(), tracesRef: z.string().uuid() }) }).parse(instance.context.o1Result).result
  if (material.data.stepId !== 'apify_o2' || material.data.runId !== instance.context.apifyRunId || material.data.workflowInstanceId !== instance.id || material.data.userId !== userId || material.data.o1RunId !== o1.runId || material.data.tracesRef !== o1.tracesRef || material.data.evaluatedAt !== prepared.evaluatedAt) throw new Error('[internal] Demo O2 provenance mismatch')
  const outcome = material.payload?.outcome
  if (material.data.state !== 'finished' || material.data.runStatus !== 'ok' || !outcome || ['error', 'invalid_input'].includes(outcome.data.status)) throw new Error('[internal] Demo O2 did not complete successfully')
  return storeDemoO2Evaluation({ mode: 'demo', sourceAssumption: DEMO_O1_SOURCE_ASSUMPTION,
    evaluationId: prepared.evaluationId, evaluatedAt: prepared.evaluatedAt, o2ResultRef: apifyResearchRef,
    owners: { registrationId: prepared.registrationId, photographerId: prepared.photographerId, personId: prepared.personId, dealId: prepared.dealId },
    rulesSnapshot: hiddenPotentialRulesSchema.parse(instance.context.demoRules),
  }, outcome, ctx)
}
