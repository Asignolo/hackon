import { withDemoOperationLock } from './demo-operation-lock'
import { z } from 'zod'
import type { EntityManager } from '@mikro-orm/postgresql'
import type { CommandBus, CommandRuntimeContext } from '@open-mercato/shared/lib/commands'
import { CrudHttpError } from '@open-mercato/shared/lib/crud/errors'
import { runRouteMutationGuards } from '@open-mercato/shared/lib/crud/route-mutation-guard'
import { findOneWithDecryption, findWithDecryption } from '@open-mercato/shared/lib/encryption/find'
import type { TenantDataEncryptionService } from '@open-mercato/shared/lib/encryption/tenantDataEncryptionService'
import { resolveTranslations } from '@open-mercato/shared/lib/i18n/server'
import type { RbacService } from '@open-mercato/core/modules/auth/services/rbacService'
import type { ModuleConfigService } from '@open-mercato/core/modules/configs/lib/module-config-service'
import { CustomerEntity, CustomerPersonProfile, CustomerDeal, CustomerDealPersonLink } from '@open-mercato/core/modules/customers/data/entities'
import { PhotographerRawData } from '../data/entities'
import { preparedPhotographerDemoSchema, type PreparedPhotographerDemo } from '../data/demo-workflow-validators'
import { createRawDataRecord, rawDataEntityId } from './raw-data-create'
import { requirePhotographerScope } from './scope'
import { requireDemoInstallation } from './demo-installation'
import { materialOperationId } from './material-codec'
import { assertPhotographerDemoAvailable } from './demo-workflow-runtime'

export const demoPreparationInputSchema = z.object({ requestId: z.string().uuid().transform((value) => value.toLowerCase()) }).strict()
export const DEMO_PREPARATION_FEATURES = [
  'photographers.view', 'photographers.create', 'photographers.evaluations.run', 'photographers.evaluations.manage',
  'customers.people.view', 'customers.people.manage', 'customers.deals.view', 'customers.deals.manage',
  'customers.pipelines.view', 'configs.manage',
] as const
const receiptSchema = z.object({
  schemaVersion: z.literal(1), registrationId: z.string().uuid(), userId: z.string().uuid(),
  phase: z.enum(['registration_pending', 'person_pending', 'deal_pending', 'ready']), pipelineId: z.string().uuid().optional(),
  photographerId: z.string().uuid().optional(), personId: z.string().uuid().optional(), dealId: z.string().uuid().optional(),
}).strict()
export { preparedPhotographerDemoSchema, type PreparedPhotographerDemo } from '../data/demo-workflow-validators'

export async function demoPreparationError(status: number, key = 'demo_conflict'): Promise<never> {
  const { translate } = await resolveTranslations()
  throw new CrudHttpError(status, { error: translate(`photographers.errors.${key}`) })
}

export async function authorizeDemoPreparation(ctx: CommandRuntimeContext) {
  if (!ctx.auth?.sub) return demoPreparationError(401, 'unauthorized')
  const scope = await requirePhotographerScope(ctx)
  const rbac = ctx.container.resolve<RbacService>('rbacService')
  if (!await rbac.userHasAllFeatures(ctx.auth.sub, [...DEMO_PREPARATION_FEATURES], scope)) return demoPreparationError(403, 'forbidden')
  return { ...scope, userId: ctx.auth.sub }
}

export async function guardDemoMutation(ctx: CommandRuntimeContext, resourceKind: string, resourceId: string | null, payload: Record<string, unknown>) {
  const scope = await authorizeDemoPreparation(ctx)
  const rbac = ctx.container.resolve<RbacService>('rbacService')
  const userFeatures = await rbac.getGrantedFeatures(scope.userId, scope)
  const guarded = await runRouteMutationGuards({
    container: ctx.container,
    req: ctx.request ?? new Request('http://localhost/internal/photographers/demo', { method: resourceId ? 'PATCH' : 'POST' }),
    auth: { ...scope, userFeatures },
    input: { resourceKind, resourceId, operation: resourceId ? 'update' : 'create', mutationPayload: payload },
  })
  if (!guarded.ok) throw new CrudHttpError(guarded.errorStatus, guarded.errorBody)
  if (guarded.modifiedPayload && JSON.stringify(guarded.modifiedPayload) !== JSON.stringify(payload)) return demoPreparationError(409)
  return guarded
}

async function requireDemoEncryption(ctx: CommandRuntimeContext, scope: { tenantId: string; organizationId: string }) {
  const probes: Record<string, string[]> = {
    [rawDataEntityId]: ['firstName', 'lastName', 'email', 'portfolioRaw'],
    'customers:customer_entity': ['displayName', 'primaryEmail'],
    'customers:customer_person_profile': ['firstName', 'lastName'],
    'customers:customer_deal': ['title'],
    'photographers:photographer_evaluation_material': ['body'],
    'audit_logs:action_log': ['command_payload', 'snapshot_before', 'snapshot_after', 'changes_json', 'context_json'],
  }
  try {
    const encryption = ctx.container.resolve<TenantDataEncryptionService>('tenantEncryptionService')
    if (!encryption.isEnabled()) return demoPreparationError(503, 'encryption_unavailable')
    for (const [entityId, fields] of Object.entries(probes)) {
      const payload = Object.fromEntries(fields.map((field) => [field, 'photographers-demo-encryption-probe']))
      const sealed = await encryption.encryptEntityPayload(entityId, payload, scope.tenantId, scope.organizationId)
      if (fields.some((field) => typeof sealed[field] !== 'string' || sealed[field] === payload[field])) return demoPreparationError(503, 'encryption_unavailable')
    }
  } catch { return demoPreparationError(503, 'encryption_unavailable') }
}

function isDemoPersonIdentity(person: CustomerEntity, profile: CustomerPersonProfile, registration: PhotographerRawData): boolean {
  return person.isActive !== false
    && person.primaryEmail === registration.email
    && profile.firstName === registration.firstName
    && profile.lastName === registration.lastName
}

export async function preparePhotographerDemo(requestId: string, ctx: CommandRuntimeContext): Promise<PreparedPhotographerDemo> {
  requestId = demoPreparationInputSchema.parse({ requestId }).requestId
  const { userId, ...scope } = await authorizeDemoPreparation(ctx)
  await assertPhotographerDemoAvailable(ctx)
  await requireDemoEncryption(ctx, scope)
  const service = ctx.container.resolve<ModuleConfigService>('moduleConfigService')
  const commandBus = ctx.container.resolve<CommandBus>('commandBus')
  const scopedId = materialOperationId(requestId, `${scope.tenantId}:${scope.organizationId}:demo`)
  const registrationId = materialOperationId(scopedId, 'registration')
  const evaluationId = materialOperationId(scopedId, 'evaluation')
  const key = `demo_preparation_${scope.organizationId}_${requestId}`
  return withDemoOperationLock(ctx.container, `${scope.tenantId}:${scope.organizationId}:${requestId}`, async () => {
    await service.invalidate('photographers', key, scope)
    const previous = await service.getValue('photographers', key, { scope })
    let receipt = previous ? receiptSchema.parse(previous) : receiptSchema.parse({ schemaVersion: 1, registrationId, userId, phase: 'registration_pending' })
    if (receipt.registrationId !== registrationId || receipt.userId !== userId) return demoPreparationError(409)
    const saveReceipt = async (patch: Partial<z.infer<typeof receiptSchema>>) => {
      receipt = receiptSchema.parse({ ...receipt, ...patch })
      if (!await service.setValue('photographers', key, receipt, scope)) return demoPreparationError(503, 'demo_unavailable')
    }
    const installation = await requireDemoInstallation(ctx)
    if (receipt.pipelineId && receipt.pipelineId !== installation.pipelineId) return demoPreparationError(409)
    await saveReceipt({ pipelineId: installation.pipelineId })
    const readEm = ctx.container.resolve<EntityManager>('em').fork()
    let registration = await findOneWithDecryption(readEm, PhotographerRawData, { id: registrationId, ...scope }, {}, scope)
    const email = `demo-${registrationId}@photographer.invalid`
    if (!registration) {
      if (previous) return demoPreparationError(409)
      const { translate } = await resolveTranslations()
      const payload = { firstName: 'Demo', lastName: translate('photographers.demo.personLastName'), email, portfolioRaw: `https://photographer.invalid/demo/${registrationId}` }
      const guarded = await guardDemoMutation(ctx, rawDataEntityId, null, payload)
      await createRawDataRecord(payload, ctx, registrationId)
      await guarded.runAfterSuccess()
      registration = await findOneWithDecryption(readEm, PhotographerRawData, { id: registrationId, ...scope }, { refresh: true }, scope)
    }
    if (!registration || registration.deletedAt || !registration.isActive || registration.email !== email || registration.firstName !== 'Demo' || registration.portfolioRaw !== `https://photographer.invalid/demo/${registrationId}`) return demoPreparationError(409)
    const personMarker = `photographers:raw:${registrationId}`
    const people = await findWithDecryption(readEm, CustomerEntity, { source: personMarker, ...scope }, { limit: 2 }, scope)
    if (people.length > 1 || people.some((person) => person.deletedAt || person.kind !== 'person')) return demoPreparationError(409)
    let person = people[0]
    if (registration.customerEntityId && person?.id !== registration.customerEntityId) return demoPreparationError(409)
    if (receipt.photographerId && person?.id !== receipt.photographerId) return demoPreparationError(409)
    if (!person) {
      if (receipt.phase !== 'registration_pending') return demoPreparationError(409)
      await saveReceipt({ phase: 'person_pending' })
      const payload = { ...scope, firstName: registration.firstName, lastName: registration.lastName, displayName: `${registration.firstName} ${registration.lastName}`, primaryEmail: registration.email, source: personMarker }
      const guarded = await guardDemoMutation(ctx, 'customers:customer_entity', null, payload)
      await commandBus.execute('customers.people.create', { input: payload, ctx })
      await guarded.runAfterSuccess()
      const created = await findWithDecryption(readEm, CustomerEntity, { source: personMarker, ...scope }, { limit: 2, refresh: true }, scope)
      if (created.length !== 1 || created[0].deletedAt || created[0].kind !== 'person') return demoPreparationError(409)
      person = created[0]
    }
    const profiles = await findWithDecryption(readEm, CustomerPersonProfile, { entity: person.id, ...scope }, { limit: 2 }, scope)
    if (profiles.length !== 1 || (receipt.personId && receipt.personId !== profiles[0].id)) return demoPreparationError(409)
    if (!isDemoPersonIdentity(person, profiles[0], registration)) return demoPreparationError(409)
    const personId = profiles[0].id
    await saveReceipt({ photographerId: person.id, personId })
    if (!registration.customerEntityId) {
      await commandBus.execute('photographers.demo.link_registration', { input: { requestId, registrationId, customerEntityId: person.id, expectedUpdatedAt: registration.updatedAt.toISOString() }, ctx })
    }
    const dealMarker = `photographers:hidden-potential:${person.id}`
    const deals = await findWithDecryption(readEm, CustomerDeal, { source: dealMarker, ...scope }, { limit: 2 }, scope)
    if (deals.length > 1 || deals.some((deal) => deal.deletedAt || deal.pipelineId !== installation.pipelineId)) return demoPreparationError(409)
    let deal = deals[0]
    if (receipt.dealId && deal?.id !== receipt.dealId) return demoPreparationError(409)
    if (!deal) {
      if (receipt.phase === 'deal_pending' || receipt.phase === 'ready') return demoPreparationError(409)
      await saveReceipt({ phase: 'deal_pending' })
      const { translate } = await resolveTranslations()
      const payload = { ...scope, title: translate('photographers.demo.dealTitle'), source: dealMarker, pipelineId: installation.pipelineId, pipelineStageId: installation.stageIds.new, personIds: [person.id], primaryPersonEntityId: person.id }
      const guarded = await guardDemoMutation(ctx, 'customers:customer_deal', null, payload)
      await commandBus.execute('customers.deals.create', { input: payload, ctx })
      await guarded.runAfterSuccess()
      const created = await findWithDecryption(readEm, CustomerDeal, { source: dealMarker, ...scope }, { limit: 2, refresh: true }, scope)
      if (created.length !== 1 || created[0].deletedAt || created[0].pipelineId !== installation.pipelineId) return demoPreparationError(409)
      deal = created[0]
    }
    const link = await findOneWithDecryption(readEm, CustomerDealPersonLink, { deal: { id: deal.id, ...scope }, person: { id: person.id, ...scope } }, {}, scope)
    if (!link) return demoPreparationError(409)
    await saveReceipt({ phase: 'ready', dealId: deal.id })
    return preparedPhotographerDemoSchema.parse({ requestId, registrationId, photographerId: person.id, personId, dealId: deal.id, evaluationId, evaluatedAt: registration.submittedAt.toISOString(), userId, source: 'demo_fixture' })
  }).finally(() => service.invalidate('photographers', key, scope))
}

export async function assertPreparedPhotographerDemo(raw: unknown, scope: { tenantId: string; organizationId: string }, container: CommandRuntimeContext['container']): Promise<void> {
  const prepared = preparedPhotographerDemoSchema.parse(raw)
  if (prepared.source === 'registration') {
    const ctx: CommandRuntimeContext = { container, auth: { sub: prepared.userId, tenantId: scope.tenantId, orgId: scope.organizationId }, selectedOrganizationId: scope.organizationId, organizationIds: [scope.organizationId], organizationScope: null }
    const { readRegistrationCrm } = await import('./registration-crm')
    const crm = await readRegistrationCrm({ registrationId: prepared.registrationId }, ctx)
    const registration = await findOneWithDecryption(container.resolve<EntityManager>('em').fork(), PhotographerRawData, { id: prepared.registrationId, customerEntityId: prepared.photographerId, isActive: true, deletedAt: null, ...scope }, {}, scope)
    const evaluationId = materialOperationId(prepared.requestId, `${scope.tenantId}:${scope.organizationId}:${prepared.registrationId}:evaluation`)
    if (!registration || crm.status !== 'ready' || crm.photographerId !== prepared.photographerId || crm.personId !== prepared.personId || crm.dealId !== prepared.dealId || prepared.evaluationId !== evaluationId || prepared.evaluatedAt !== registration.submittedAt.toISOString()) return demoPreparationError(409)
    return
  }
  const scopedId = materialOperationId(prepared.requestId, `${scope.tenantId}:${scope.organizationId}:demo`)
  if (prepared.registrationId !== materialOperationId(scopedId, 'registration') || prepared.evaluationId !== materialOperationId(scopedId, 'evaluation')) return demoPreparationError(409)
  const service = container.resolve<ModuleConfigService>('moduleConfigService')
  const receipt = receiptSchema.safeParse(await service.getValue('photographers', `demo_preparation_${scope.organizationId}_${prepared.requestId}`, { scope }))
  if (!receipt.success || receipt.data.phase !== 'ready' || receipt.data.registrationId !== prepared.registrationId || receipt.data.userId !== prepared.userId || receipt.data.photographerId !== prepared.photographerId || receipt.data.personId !== prepared.personId || receipt.data.dealId !== prepared.dealId) return demoPreparationError(409)
  const em = container.resolve<EntityManager>('em').fork()
  const registration = await findOneWithDecryption(em, PhotographerRawData, { id: prepared.registrationId, ...scope, deletedAt: null }, {}, scope)
  if (!registration || !registration.isActive || registration.customerEntityId !== prepared.photographerId || registration.firstName !== 'Demo' || registration.email !== `demo-${prepared.registrationId}@photographer.invalid` || registration.submittedAt.toISOString() !== prepared.evaluatedAt || registration.portfolioRaw !== `https://photographer.invalid/demo/${prepared.registrationId}`) return demoPreparationError(409)
  const people = await findWithDecryption(em, CustomerEntity, { source: `photographers:raw:${prepared.registrationId}`, ...scope }, { limit: 2 }, scope)
  const profiles = await findWithDecryption(em, CustomerPersonProfile, { entity: prepared.photographerId, ...scope }, { limit: 2 }, scope)
  const deals = await findWithDecryption(em, CustomerDeal, { source: `photographers:hidden-potential:${prepared.photographerId}`, ...scope }, { limit: 2 }, scope)
  if (people.length !== 1 || people[0].id !== prepared.photographerId || people[0].deletedAt || people[0].kind !== 'person' || profiles.length !== 1 || profiles[0].id !== prepared.personId || deals.length !== 1 || deals[0].id !== prepared.dealId || deals[0].deletedAt || deals[0].pipelineId !== receipt.data.pipelineId) return demoPreparationError(409)
  if (!isDemoPersonIdentity(people[0], profiles[0], registration)) return demoPreparationError(409)
  const link = await findOneWithDecryption(em, CustomerDealPersonLink, { deal: { id: prepared.dealId, ...scope }, person: { id: prepared.photographerId, ...scope } }, {}, scope)
  if (!link) return demoPreparationError(409)
}

export async function prepareRegistrationDemo(requestId: string, registrationId: string, ctx: CommandRuntimeContext): Promise<PreparedPhotographerDemo> {
  const { userId, ...scope } = await authorizeDemoPreparation(ctx)
  const { readRegistrationCrm } = await import('./registration-crm')
  await ctx.container.resolve<CommandBus>('commandBus').execute('photographers.registration.prepare_crm', { input: { registrationId }, ctx })
  const crm = await readRegistrationCrm({ registrationId }, ctx)
  const registration = await findOneWithDecryption(ctx.container.resolve<EntityManager>('em').fork(), PhotographerRawData, { id: registrationId, isActive: true, deletedAt: null, ...scope }, {}, scope)
  if (!registration || crm.status !== 'ready') return demoPreparationError(409)
  return preparedPhotographerDemoSchema.parse({ requestId, registrationId, photographerId: crm.photographerId, personId: crm.personId, dealId: crm.dealId,
    evaluationId: materialOperationId(requestId, `${scope.tenantId}:${scope.organizationId}:${registrationId}:evaluation`), evaluatedAt: registration.submittedAt.toISOString(), userId, source: 'registration' })
}
