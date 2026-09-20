import type { EntityManager } from '@mikro-orm/postgresql'
import type { CommandRuntimeContext } from '@open-mercato/shared/lib/commands'
import { CrudHttpError, isCrudHttpError } from '@open-mercato/shared/lib/crud/errors'
import { findOneWithDecryption, findWithDecryption } from '@open-mercato/shared/lib/encryption/find'
import { resolveTranslations } from '@open-mercato/shared/lib/i18n/server'
import type { RbacService } from '@open-mercato/core/modules/auth/services/rbacService'
import { WorkflowInstance, StepInstance } from '@open-mercato/core/modules/workflows/data/entities'
import { PhotographerRawData, PhotographerEvaluationMaterial } from '../data/entities'
import { assessmentInputSchema, assessmentResponseSchema, type AssessmentResponse } from '../data/assessment-validators'
import { materialResponseSchema } from '../data/material-validators'
import { readApifyResearchResult } from './apify-research-material'
import { readEvaluationMaterial } from './material-store'
import { readRegistrationCrm } from './registration-crm'
import { requirePhotographerScope } from './scope'
import { PORTFOLIO_DISCOVERY_WORKFLOW_ID } from './portfolio-discovery-contract'

export const assessmentViewFeatures = ['photographers.view', 'photographers.evaluations.view', 'customers.people.view', 'customers.deals.view', 'customers.pipelines.view', 'customers.interactions.view', 'workflows.instances.view']
const kinds = ['traces', 'facts', 'score', 'summary'] as const
async function fail(status: number, key: string): Promise<never> {
  const { translate } = await resolveTranslations()
  throw new CrudHttpError(status, { error: translate(`photographers.errors.${key}`) })
}
function object(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {}
}
export function assessmentWorkflowSource(context: Record<string, unknown>, workflowId: string): AssessmentResponse['source'] {
  if (context.source === 'demo_fixture' || object(context.demo).source === 'demo_fixture') return 'demo_fixture'
  return [PORTFOLIO_DISCOVERY_WORKFLOW_ID, 'photographers.demo-evaluation'].includes(workflowId) ? 'real' : 'unknown'
}
export async function readAssessment(raw: unknown, ctx: CommandRuntimeContext): Promise<AssessmentResponse> {
  const { evaluationId, registrationId } = assessmentInputSchema.parse(raw)
  if (!ctx.auth?.sub) return fail(401, 'unauthorized')
  const scope = await requirePhotographerScope(ctx)
  if (!await ctx.container.resolve<RbacService>('rbacService').userHasAllFeatures(ctx.auth.sub, assessmentViewFeatures, scope)) return fail(403, 'forbidden')
  const em = ctx.container.resolve<EntityManager>('em').fork()
  const registration = await findOneWithDecryption(em, PhotographerRawData, { id: registrationId, ...scope, deletedAt: null, isActive: true }, {}, scope)
  if (!registration) return fail(404, 'registration_not_found')
  let owners: AssessmentResponse['owners'] = null
  try {
    const crm = await readRegistrationCrm({ registrationId }, ctx)
    if (crm.status === 'ready' && crm.photographerId && crm.personId && crm.dealId && crm.links) owners = { photographerId: crm.photographerId, personId: crm.personId, dealId: crm.dealId, links: crm.links }
  } catch (caught) {
    if (!isCrudHttpError(caught) || ![404, 409, 503].includes(caught.status)) throw caught
  }
  const workflows = await findWithDecryption(em, WorkflowInstance, {
    ...scope,
    $or: [
      { context: { evaluationId, registrationId } },
      { context: { demo: { evaluationId, registrationId } } },
      { context: { o1Preparation: { result: { evaluationId, registrationId } } } },
    ],
  }, { orderBy: { createdAt: 'desc', id: 'desc' }, limit: 2 }, scope)
  const workflow = workflows.length === 1 ? workflows[0] : null
  const source = workflows.some((entry) => assessmentWorkflowSource(entry.context, entry.workflowId) === 'demo_fixture')
    ? 'demo_fixture' : workflow ? assessmentWorkflowSource(workflow.context, workflow.workflowId) : 'unknown'
  const initialStatus = source === 'demo_fixture' ? 'excluded' as const : 'missing' as const
  const empty = () => ({ status: initialStatus, id: null, data: null })
  const result: AssessmentResponse = {
    evaluationId,
    registration: { id: registration.id, firstName: registration.firstName, lastName: registration.lastName, email: registration.email, portfolioRaw: registration.portfolioRaw, submittedAt: registration.submittedAt.toISOString(), updatedAt: registration.updatedAt.toISOString() },
    owners, source,
    process: { workflowInstanceId: workflow?.id ?? null, status: 'pending', currentStepId: workflow?.currentStepId ?? null, errorCode: null },
    stages: [], materials: { traces: empty(), facts: empty(), score: empty(), summary: empty() },
    research: { status: 'unavailable', reason: 'not_saved' },
  }
  if (workflows.length > 1) result.process = { ...result.process, status: 'unknown', errorCode: 'ambiguous_workflow' }
  if (workflow) {
    result.process.status = ['FAILED', 'CANCELLED'].includes(workflow.status) ? 'failed'
      : workflow.status === 'COMPLETED' ? 'completed' : 'running'
    if (result.process.status === 'failed') result.process.errorCode = 'stage_failed'
  }
  if (source === 'demo_fixture') return assessmentResponseSchema.parse(result)
  const finalRefs = object(object(workflow?.context.demoScore).result)
  for (const kind of kinds) {
    const finalRef = finalRefs[`${kind}Ref`]
    const rows = await findWithDecryption(em, PhotographerEvaluationMaterial, { evaluationId, registrationId, kind, ...scope, ...(typeof finalRef === 'string' ? { id: finalRef } : {}) }, { orderBy: { createdAt: 'desc', id: 'desc' }, limit: 1, fields: ['id', 'kind'] }, scope)
    if (!rows.length) continue
    const id = rows[0].id
    try {
      const material = materialResponseSchema.parse(await readEvaluationMaterial(id, ctx))
      if (material.kind !== kind || material.evaluationId !== evaluationId || material.registrationId !== registrationId || !owners || material.photographerId !== owners.photographerId || material.personId !== owners.personId || material.dealId !== owners.dealId) {
        result.materials[kind] = { status: 'invalid', id, data: null }
        continue
      }
      if (material.kind === 'traces') result.materials.traces = { status: 'available', id, data: material.data }
      if (material.kind === 'facts') result.materials.facts = { status: 'available', id, data: material.data }
      if (material.kind === 'score') result.materials.score = { status: 'available', id, data: material.data }
      if (material.kind === 'summary') result.materials.summary = { status: 'available', id, data: material.data }
    } catch (caught) {
      if (isCrudHttpError(caught) && [401, 403].includes(caught.status)) throw caught
      if (!isCrudHttpError(caught) && !(caught instanceof Error && caught.name === 'ZodError')) throw caught
      result.materials[kind] = { status: isCrudHttpError(caught) && caught.status === 503 ? 'unavailable' : 'invalid', id, data: null }
    }
  }
  if (result.materials.facts.data && (result.materials.traces.status !== 'available' || result.materials.facts.data.tracesRef !== result.materials.traces.id)) {
    result.materials.facts = { status: 'invalid', id: result.materials.facts.id, data: null }
  }
  if (result.materials.score.data && (result.materials.facts.status !== 'available' || result.materials.score.data.factsRef !== result.materials.facts.id)) {
    result.materials.score = { status: 'invalid', id: result.materials.score.id, data: null }
  }
  const o1Ref = object(object(workflow?.context.o1Result).result).tracesRef
  if (typeof o1Ref === 'string') {
    result.o1 = { status: 'invalid', id: o1Ref, data: null }
    try {
      const material = materialResponseSchema.parse(await readEvaluationMaterial(o1Ref, ctx))
      if (material.kind === 'traces' && material.evaluationId === evaluationId && material.registrationId === registrationId
        && owners && material.photographerId === owners.photographerId && material.personId === owners.personId && material.dealId === owners.dealId) {
        result.o1 = { status: 'available', id: o1Ref, data: material.data }
      }
    } catch (caught) {
      if (isCrudHttpError(caught) && [401, 403].includes(caught.status)) throw caught
      if (!isCrudHttpError(caught) && !(caught instanceof Error && caught.name === 'ZodError')) throw caught
    }
  }
  const researchRows = await findWithDecryption(em, PhotographerEvaluationMaterial, { evaluationId, registrationId, kind: 'apify_research', ...scope, ...(typeof workflow?.context.apifyResearchRef === 'string' ? { id: workflow.context.apifyResearchRef } : {}) }, { orderBy: { createdAt: 'desc', id: 'desc' }, limit: 1, fields: ['id'] }, scope)
  if (researchRows.length) {
    try {
      const research = await readApifyResearchResult(researchRows[0].id, ctx)
      if (!owners || research.evaluationId !== evaluationId || research.registrationId !== registrationId
        || research.photographerId !== owners.photographerId || research.personId !== owners.personId || research.dealId !== owners.dealId
        || !workflow || research.data.workflowInstanceId !== workflow.id) {
        result.research = { status: 'unavailable', reason: 'binding_mismatch' }
      } else {
        const outcome = research.payload?.outcome?.data
        result.research = {
          status: research.data.state === 'claimed' ? 'waiting' : research.data.runStatus !== 'ok' || !outcome || ['error', 'invalid_input'].includes(outcome.status) ? 'failed' : outcome.status === 'complete' ? 'completed' : 'partial',
          summary: outcome?.summary ?? null,
          sources: outcome ? [
            ...outcome.results.map((entry) => ({ url: entry.url, status: entry.status === 'complete' ? 'ok' as const : entry.status === 'no_data' ? 'empty' as const : entry.status, summary: entry.error })),
            ...outcome.skipped.filter((entry) => entry.url !== null).map((entry) => ({ url: entry.url!, status: 'unavailable' as const, summary: entry.reason })),
          ] : [],
        }
      }
    } catch (caught) {
      if (isCrudHttpError(caught) && [401, 403].includes(caught.status)) throw caught
      result.research = { status: 'unavailable', reason: 'invalid_material' }
    }
  }
  result.stages = result.materials.summary.data?.steps.map(({ stepId, status }) => ({ stepId, status })) ?? []
  if (workflow) {
    const steps = await findWithDecryption(em, StepInstance, { workflowInstanceId: workflow.id, ...scope }, { orderBy: { createdAt: 'desc', id: 'desc' }, limit: 100, fields: ['id', 'stepId', 'status'] }, scope)
    const actualStages: AssessmentResponse['stages'] = []
    const seen = new Set<string>()
    for (const step of steps) {
      if (seen.has(step.stepId)) continue
      seen.add(step.stepId)
      actualStages.push({ stepId: step.stepId, status: step.status === 'COMPLETED' ? 'done' : step.status === 'CANCELLED' ? 'rejected' : ['FAILED', 'SKIPPED'].includes(step.status) ? 'unavailable' : 'waiting' })
    }
    if (actualStages.length) result.stages = actualStages.reverse()
  }
  if (['pending', 'running'].includes(result.process.status) && kinds.some((kind) => result.materials[kind].status === 'available')) result.process.status = 'partial'
  return assessmentResponseSchema.parse(result)
}
