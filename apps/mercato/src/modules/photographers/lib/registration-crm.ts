import { createHash } from 'node:crypto'
import { LockMode } from '@mikro-orm/core'
import type { EntityManager } from '@mikro-orm/postgresql'
import { z } from 'zod'
import type { CommandBus, CommandRuntimeContext } from '@open-mercato/shared/lib/commands'
import { emitCrudSideEffects } from '@open-mercato/shared/lib/commands/helpers'
import { CrudHttpError } from '@open-mercato/shared/lib/crud/errors'
import { enforceCommandOptimisticLock } from '@open-mercato/shared/lib/crud/optimistic-lock-command'
import { runRouteMutationGuards } from '@open-mercato/shared/lib/crud/route-mutation-guard'
import { findOneWithDecryption, findWithDecryption } from '@open-mercato/shared/lib/encryption/find'
import type { TenantDataEncryptionService } from '@open-mercato/shared/lib/encryption/tenantDataEncryptionService'
import type { DataEngine } from '@open-mercato/shared/lib/data/engine'
import { resolveTranslations } from '@open-mercato/shared/lib/i18n/server'
import type { RbacService } from '@open-mercato/core/modules/auth/services/rbacService'
import type { ModuleConfigService } from '@open-mercato/core/modules/configs/lib/module-config-service'
import { CustomerEntity, CustomerPersonProfile, CustomerDeal, CustomerDealPersonLink, CustomerPipeline, CustomerPipelineStage } from '@open-mercato/core/modules/customers/data/entities'
import { PhotographerRawData } from '../data/entities'
import { registrationCrmInputSchema, type RegistrationCrmResult } from '../data/registration-crm-validators'
import { requirePhotographerScope } from './scope'
import { rawDataEntityId } from './raw-data-create'

export const registrationCrmViewFeatures = ['photographers.view', 'customers.people.view', 'customers.deals.view', 'customers.pipelines.view']
export const registrationCrmWriteFeatures = [...registrationCrmViewFeatures, 'photographers.evaluations.run', 'customers.people.manage', 'customers.deals.manage']
type Scope = { tenantId: string; organizationId: string }
const installationSchema = z.object({ pipelineId: z.string().uuid(), stageIds: z.object({ new: z.string().uuid() }) })
const normalizedEmail = (value: string) => value.trim().toLowerCase()

export async function registrationCrmError(status: number, key: string): Promise<never> {
  const { translate } = await resolveTranslations()
  throw new CrudHttpError(status, { error: translate(`photographers.errors.${key}`) })
}

export async function authorizeRegistrationCrm(ctx: CommandRuntimeContext, write: boolean) {
  if (!ctx.auth?.sub) return registrationCrmError(401, 'unauthorized')
  const scope = await requirePhotographerScope(ctx)
  if (!await ctx.container.resolve<RbacService>('rbacService').userHasAllFeatures(ctx.auth.sub, write ? registrationCrmWriteFeatures : registrationCrmViewFeatures, scope)) return registrationCrmError(403, 'forbidden')
  return scope
}

async function withRegistrationLock<Result>(ctx: CommandRuntimeContext, scope: Scope, key: string, action: () => Promise<Result>): Promise<Result> {
  const manager = ctx.container.resolve<EntityManager>('em').fork()
  const digest = createHash('sha256').update(`${scope.tenantId}:${scope.organizationId}:${key}`).digest('hex')
  await manager.begin()
  try {
    await manager.getConnection().execute('select pg_advisory_xact_lock(hashtextextended(?, 0))', [`photographers:registration:${digest}`], 'all', manager.getTransactionContext())
    const result = await action()
    await manager.commit()
    return result
  } catch (error) {
    try { await manager.rollback() } finally { throw error }
  }
}

async function readInstallation(ctx: CommandRuntimeContext, scope: Scope) {
  const config = await ctx.container.resolve<ModuleConfigService>('moduleConfigService').getValue('photographers', `hidden_potential_installation_${scope.organizationId}`, { scope })
  const parsed = installationSchema.safeParse(config)
  if (!parsed.success) return registrationCrmError(503, 'registration_crm_unavailable')
  const em = ctx.container.resolve<EntityManager>('em').fork()
  const pipeline = await findOneWithDecryption(em, CustomerPipeline, { id: parsed.data.pipelineId, ...scope }, {}, scope)
  const stage = await findOneWithDecryption(em, CustomerPipelineStage, { id: parsed.data.stageIds.new, pipelineId: parsed.data.pipelineId, ...scope }, {}, scope)
  if (!pipeline || !stage) return registrationCrmError(503, 'registration_crm_unavailable')
  return parsed.data
}

async function readRegistration(em: EntityManager, registrationId: string, scope: Scope) {
  const registration = await findOneWithDecryption(em, PhotographerRawData, { id: registrationId, ...scope, deletedAt: null, isActive: true }, { refresh: true }, scope)
  if (!registration) return registrationCrmError(404, 'registration_not_found')
  return registration
}

async function readPerson(em: EntityManager, id: string, scope: Scope) {
  const person = await findOneWithDecryption(em, CustomerEntity, { id, ...scope, kind: 'person', deletedAt: null, isActive: true }, { refresh: true }, scope)
  const profiles = await findWithDecryption(em, CustomerPersonProfile, { entity: id, ...scope }, { limit: 2, refresh: true }, scope)
  if (!person || profiles.length !== 1) return registrationCrmError(409, 'registration_crm_conflict')
  return { person, profile: profiles[0] }
}

function sameIdentity(registration: PhotographerRawData, person: CustomerEntity, profile: CustomerPersonProfile) {
  return normalizedEmail(person.primaryEmail ?? '') === normalizedEmail(registration.email)
    && profile.firstName?.trim() === registration.firstName.trim()
    && profile.lastName?.trim() === registration.lastName.trim()
}

async function findMatchingPerson(em: EntityManager, registration: PhotographerRawData, scope: Scope) {
  const marked = await findWithDecryption(em, CustomerEntity, { source: `photographers:raw:${registration.id}`, ...scope }, { limit: 2, refresh: true }, scope)
  if (marked.length > 1) return registrationCrmError(409, 'registration_crm_conflict')
  if (marked.length) {
    const existing = await readPerson(em, marked[0].id, scope)
    if (!sameIdentity(registration, existing.person, existing.profile)) return registrationCrmError(409, 'registration_crm_conflict')
    return existing
  }
  let cursor: string | undefined
  let matchedId: string | undefined
  for (;;) {
    const page = await findWithDecryption(em, CustomerEntity, { ...scope, kind: 'person', deletedAt: null, ...(cursor ? { id: { $gt: cursor } } : {}) }, { limit: 100, orderBy: { id: 'asc' }, refresh: true }, scope)
    for (const person of page) {
      if (normalizedEmail(person.primaryEmail ?? '') !== normalizedEmail(registration.email)) continue
      if (matchedId) return registrationCrmError(409, 'registration_crm_conflict')
      matchedId = person.id
    }
    if (page.length < 100) break
    cursor = page[page.length - 1].id
    em.clear()
  }
  if (!matchedId) return null
  const existing = await readPerson(em, matchedId, scope)
  if (!sameIdentity(registration, existing.person, existing.profile)) return registrationCrmError(409, 'registration_crm_conflict')
  return existing
}

async function findDeal(em: EntityManager, photographerId: string, pipelineId: string, scope: Scope) {
  const marked = await findWithDecryption(em, CustomerDeal, { source: `photographers:hidden-potential:${photographerId}`, ...scope }, { limit: 2, refresh: true }, scope)
  const links = await findWithDecryption(em, CustomerDealPersonLink, { person: { id: photographerId, ...scope }, deal: { pipelineId, ...scope, deletedAt: null } }, { limit: 2, populate: ['deal'], refresh: true }, scope)
  const ids = new Set([...marked.map((deal) => deal.id), ...links.map((link) => link.deal.id)])
  if (ids.size > 1) return registrationCrmError(409, 'registration_crm_conflict')
  if (!ids.size) return null
  const id = [...ids][0]
  const deal = await findOneWithDecryption(em, CustomerDeal, { id, ...scope, pipelineId, deletedAt: null }, { refresh: true }, scope)
  if (!deal || !links.some((link) => link.deal.id === id)) return registrationCrmError(409, 'registration_crm_conflict')
  return deal
}

async function requireCrmEncryption(ctx: CommandRuntimeContext, scope: Scope) {
  const encryption = ctx.container.resolve<TenantDataEncryptionService>('tenantEncryptionService')
  if (!encryption.isEnabled()) return registrationCrmError(503, 'encryption_unavailable')
  for (const [entityId, fields] of Object.entries({
    'customers:customer_entity': ['displayName', 'primaryEmail'],
    'customers:customer_person_profile': ['firstName', 'lastName'],
    'customers:customer_deal': ['title'],
    'audit_logs:action_log': ['command_payload', 'snapshot_before', 'snapshot_after', 'changes_json', 'context_json'],
  })) {
    const payload = Object.fromEntries(fields.map((field) => [field, 'photographers-crm-encryption-probe']))
    const encrypted = await encryption.encryptEntityPayload(entityId, payload, scope.tenantId, scope.organizationId)
    if (fields.some((field) => typeof encrypted[field] !== 'string' || encrypted[field] === payload[field])) return registrationCrmError(503, 'encryption_unavailable')
  }
}

async function guardedWrite(ctx: CommandRuntimeContext, scope: Scope, resourceKind: string, resourceId: string | null, input: Record<string, unknown>, write: (payload: Record<string, unknown>) => Promise<void>) {
  const userFeatures = await ctx.container.resolve<RbacService>('rbacService').getGrantedFeatures(ctx.auth!.sub, scope)
  const guard = await runRouteMutationGuards({ container: ctx.container,
    req: ctx.request ?? new Request('http://localhost/internal/photographers/registration-crm', { method: 'POST' }),
    auth: { ...scope, userId: ctx.auth!.sub, userFeatures },
    input: { resourceKind, resourceId, operation: resourceId ? 'update' : 'create', mutationPayload: input },
  })
  if (!guard.ok) throw new CrudHttpError(guard.errorStatus, guard.errorBody)
  const payload = { ...input, ...guard.modifiedPayload }
  for (const key of Object.keys(payload)) {
    if (JSON.stringify(payload[key]) !== JSON.stringify(input[key])) return registrationCrmError(409, 'registration_crm_conflict')
  }
  await write(payload)
  await guard.runAfterSuccess()
}

function ready(registrationId: string, photographerId: string, personId: string, dealId: string): RegistrationCrmResult {
  return { registrationId, status: 'ready', photographerId, personId, dealId, links: { person: `/backend/customers/people/${photographerId}`, deal: `/backend/customers/deals/${dealId}` } }
}

export async function readRegistrationCrm(input: unknown, ctx: CommandRuntimeContext): Promise<RegistrationCrmResult> {
  const { registrationId } = registrationCrmInputSchema.parse(input)
  const scope = await authorizeRegistrationCrm(ctx, false)
  const em = ctx.container.resolve<EntityManager>('em').fork()
  const registration = await readRegistration(em, registrationId, scope)
  if (!registration.customerEntityId) return { registrationId, status: 'pending' }
  const { person, profile } = await readPerson(em, registration.customerEntityId, scope)
  const installation = await readInstallation(ctx, scope)
  const deal = await findDeal(em, person.id, installation.pipelineId, scope)
  return deal ? ready(registrationId, person.id, profile.id, deal.id) : { registrationId, status: 'pending' }
}

export async function prepareRegistrationCrm(input: unknown, ctx: CommandRuntimeContext): Promise<RegistrationCrmResult> {
  const { registrationId } = registrationCrmInputSchema.parse(input)
  const scope = await authorizeRegistrationCrm(ctx, true)
  return withRegistrationLock(ctx, scope, `raw:${registrationId}`, async () => {
    const em = ctx.container.resolve<EntityManager>('em').fork()
    const registration = await readRegistration(em, registrationId, scope)
    const installation = await readInstallation(ctx, scope)
    await requireCrmEncryption(ctx, scope)
    return withRegistrationLock(ctx, scope, `email:${normalizedEmail(registration.email)}`, async () => {
      let existing = registration.customerEntityId ? await readPerson(em, registration.customerEntityId, scope) : await findMatchingPerson(em, registration, scope)
      const commandBus = ctx.container.resolve<CommandBus>('commandBus')
      if (!existing) {
        const payload = { ...scope, firstName: registration.firstName, lastName: registration.lastName, displayName: `${registration.firstName.trim()} ${registration.lastName.trim()}`, primaryEmail: registration.email, source: `photographers:raw:${registrationId}` }
        await guardedWrite(ctx, scope, 'customers:customer_entity', null, payload, async (guarded) => { await commandBus.execute('customers.people.create', { input: guarded, ctx }) })
        existing = await findMatchingPerson(em, registration, scope)
        if (!existing) return registrationCrmError(409, 'registration_crm_conflict')
      }
      const { person, profile } = existing
      return withRegistrationLock(ctx, scope, `person:${person.id}`, async () => {
        if (!registration.customerEntityId) {
          await guardedWrite(ctx, scope, rawDataEntityId, registrationId, { customerEntityId: person.id }, async () => {
            const linked = await em.fork().transactional(async (transaction) => {
              const current = await findOneWithDecryption(transaction, PhotographerRawData, { id: registrationId, ...scope, deletedAt: null, isActive: true }, { lockMode: LockMode.PESSIMISTIC_WRITE }, scope)
              if (!current || (current.customerEntityId && current.customerEntityId !== person.id)) return registrationCrmError(409, 'registration_crm_conflict')
              enforceCommandOptimisticLock({ resourceKind: rawDataEntityId, resourceId: registrationId, current: current.updatedAt, expected: registration.updatedAt.toISOString() })
              current.customerEntityId = person.id
              await transaction.flush()
              return current
            })
            await emitCrudSideEffects({ dataEngine: ctx.container.resolve<DataEngine>('dataEngine'), action: 'updated', entity: linked, identifiers: { id: linked.id, ...scope }, actorUserId: ctx.auth!.sub,
              events: { module: 'photographers', entity: 'raw_data', persistent: true }, indexer: { entityType: rawDataEntityId } })
          })
        }
        let deal = await findDeal(em, person.id, installation.pipelineId, scope)
        if (!deal) {
          const { translate } = await resolveTranslations()
          const payload = { ...scope, title: `${translate('photographers.hiddenPotential.pipeline')} — ${person.displayName}`, source: `photographers:hidden-potential:${person.id}`, pipelineId: installation.pipelineId, pipelineStageId: installation.stageIds.new, personIds: [person.id], primaryPersonEntityId: person.id }
          await guardedWrite(ctx, scope, 'customers:customer_deal', null, payload, async (guarded) => { await commandBus.execute('customers.deals.create', { input: guarded, ctx }) })
          deal = await findDeal(em, person.id, installation.pipelineId, scope)
          if (!deal) return registrationCrmError(409, 'registration_crm_conflict')
        }
        return ready(registrationId, person.id, profile.id, deal.id)
      })
    })
  })
}
