import type { EntityManager } from '@mikro-orm/postgresql'
import type { CommandRuntimeContext } from '@open-mercato/shared/lib/commands'
import { CrudHttpError } from '@open-mercato/shared/lib/crud/errors'
import { findOneWithDecryption, findWithDecryption } from '@open-mercato/shared/lib/encryption/find'
import { resolveTranslations } from '@open-mercato/shared/lib/i18n/server'
import type { RbacService } from '@open-mercato/core/modules/auth/services/rbacService'
import { CustomerEntity } from '@open-mercato/core/modules/customers/data/entities'
import { WorkflowInstance } from '@open-mercato/core/modules/workflows/data/entities'
import { PhotographerRawData, PhotographerEvaluationMaterial } from '../data/entities'
import { personAssessmentBindingSchema, personAssessmentPathSchema, type PersonAssessmentResponse } from '../data/person-assessment-validators'
import { assessmentViewFeatures } from './assessment-read'
import { requirePhotographerScope } from './scope'

function object(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {}
}

async function fail(status: number, key: string): Promise<never> {
  const { translate } = await resolveTranslations()
  throw new CrudHttpError(status, { error: translate(`photographers.errors.${key}`) })
}

export async function readPersonAssessment(raw: unknown, ctx: CommandRuntimeContext): Promise<PersonAssessmentResponse> {
  const { personId } = personAssessmentPathSchema.parse(raw)
  if (!ctx.auth?.sub) return fail(401, 'unauthorized')
  const scope = await requirePhotographerScope(ctx)
  if (!await ctx.container.resolve<RbacService>('rbacService').userHasAllFeatures(ctx.auth.sub, assessmentViewFeatures, scope)) return fail(403, 'forbidden')
  const em = ctx.container.resolve<EntityManager>('em').fork()
  const person = await findOneWithDecryption(em, CustomerEntity, { id: personId, kind: 'person', ...scope, deletedAt: null, isActive: true }, { fields: ['id'] }, scope)
  if (!person) return fail(404, 'person_not_found')
  const registrations = await findWithDecryption(em, PhotographerRawData, { customerEntityId: personId, ...scope, deletedAt: null, isActive: true }, { fields: ['id'] }, scope)
  if (!registrations.length) return { assessment: null }
  const registrationIds = registrations.map((registration) => registration.id)
  const registrationSet = new Set(registrationIds)
  const pageSize = 100
  for (let offset = 0; ; offset += pageSize) {
    const workflows = await findWithDecryption(em, WorkflowInstance, {
      ...scope,
      $or: [
        { context: { registrationId: { $in: registrationIds } } },
        { context: { demo: { registrationId: { $in: registrationIds } } } },
        { context: { o1Preparation: { result: { registrationId: { $in: registrationIds } } } } },
      ],
    }, { orderBy: { createdAt: 'desc', id: 'desc' }, limit: pageSize, offset, fields: ['id', 'context'] }, scope)
    for (const workflow of workflows) {
      const context = object(workflow.context)
      const bindings = [context, object(context.demo), object(object(context.o1Preparation).result)]
        .map((candidate) => personAssessmentBindingSchema.safeParse(candidate))
        .flatMap((parsed) => parsed.success ? [parsed.data] : [])
      const binding = bindings[0]
      if (binding && registrationSet.has(binding.registrationId) && bindings.every((candidate) => candidate.evaluationId === binding.evaluationId && candidate.registrationId === binding.registrationId)) {
        return { assessment: binding }
      }
    }
    if (workflows.length < pageSize) break
  }
  const materials = await findWithDecryption(em, PhotographerEvaluationMaterial, {
    ...scope, photographerId: personId, registrationId: { $in: registrationIds },
  }, { orderBy: { createdAt: 'desc', id: 'desc' }, limit: 1, fields: ['evaluationId', 'registrationId'] }, scope)
  const material = personAssessmentBindingSchema.safeParse(materials[0])
  return { assessment: material.success && registrationSet.has(material.data.registrationId) ? material.data : null }
}
