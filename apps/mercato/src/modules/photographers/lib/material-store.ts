import { z } from 'zod'
import type { EntityManager } from '@mikro-orm/postgresql'
import type { CommandRuntimeContext } from '@open-mercato/shared/lib/commands'
import { CrudHttpError } from '@open-mercato/shared/lib/crud/errors'
import { findOneWithDecryption } from '@open-mercato/shared/lib/encryption/find'
import type { TenantDataEncryptionService } from '@open-mercato/shared/lib/encryption/tenantDataEncryptionService'
import type { RbacService } from '@open-mercato/core/modules/auth/services/rbacService'
import { CustomerEntity, CustomerPersonProfile, CustomerDeal, CustomerDealPersonLink } from '@open-mercato/core/modules/customers/data/entities'
import { resolveTranslations } from '@open-mercato/shared/lib/i18n/server'
import { PhotographerRawData, PhotographerEvaluationMaterial } from '../data/entities'
import { storeMaterialSchema, storedMaterialSchema, type MaterialOwners } from '../data/material-validators'
export { storeMaterialSchema } from '../data/material-validators'
import { decodeMaterialSnapshot, encodeMaterialSnapshot, materialOperationId } from './material-codec'
import { requirePhotographerScope } from './scope'

const uuid = z.string().uuid()
type Scope = { tenantId: string; organizationId: string }
const materialEntityId = 'photographers:photographer_evaluation_material'
const auditFields = ['command_payload', 'snapshot_before', 'snapshot_after', 'changes_json', 'context_json']

async function error(status: number, key: string): Promise<never> {
  const { translate } = await resolveTranslations()
  throw new CrudHttpError(status, { error: translate(`photographers.errors.${key}`) })
}

async function authorize(ctx: CommandRuntimeContext, write: boolean) {
  if (!ctx.auth?.sub) return error(401, 'unauthorized')
  const scope = await requirePhotographerScope(ctx)
  const features = ['photographers.evaluations.view', 'customers.people.view', 'customers.deals.view', 'customers.interactions.view']
  if (write) features.push('photographers.evaluations.manage', 'customers.interactions.manage')
  const rbac = ctx.container.resolve<RbacService>('rbacService')
  if (!await rbac.userHasAllFeatures(ctx.auth.sub, features, scope)) return error(403, 'forbidden')
  return scope
}

async function requireOwners(em: EntityManager, owners: MaterialOwners, scope: Scope) {
  const [entity, person] = await Promise.all([
    findOneWithDecryption(em, CustomerEntity, { id: owners.photographerId, kind: 'person', ...scope, deletedAt: null }, {}, scope),
    findOneWithDecryption(em, CustomerPersonProfile, { id: owners.personId, entity: owners.photographerId, ...scope }, {}, scope),
  ])
  if (!entity || !person) return error(404, 'material_not_found')
  if (owners.registrationId) {
    const registration = await findOneWithDecryption(em, PhotographerRawData, { id: owners.registrationId, customerEntityId: owners.photographerId, ...scope, deletedAt: null }, {}, scope)
    if (!registration) return error(404, 'material_not_found')
  }
  if (owners.dealId) {
    const deal = await findOneWithDecryption(em, CustomerDeal, { id: owners.dealId, ...scope, deletedAt: null }, {}, scope)
    const link = await findOneWithDecryption(em, CustomerDealPersonLink, { deal: { id: owners.dealId, ...scope }, person: { id: owners.photographerId, ...scope } }, {}, scope)
    if (!deal || !link) return error(404, 'material_not_found')
  }
}

async function resolveEncryption(ctx: CommandRuntimeContext) {
  let encryption: TenantDataEncryptionService
  try { encryption = ctx.container.resolve<TenantDataEncryptionService>('tenantEncryptionService') } catch { return error(503, 'encryption_unavailable') }
  if (!encryption || !encryption.isEnabled()) return error(503, 'encryption_unavailable')
  return encryption
}

async function requireEncryption(ctx: CommandRuntimeContext, scope: Scope) {
  const encryption = await resolveEncryption(ctx)
  const probe = Object.fromEntries(auditFields.map((field) => [field, 'photographers-encryption-check']))
  const encrypted = await sealPayload(encryption, 'audit_logs:action_log', probe, scope)
  if (auditFields.some((field) => typeof encrypted[field] !== 'string' || encrypted[field] === probe[field])) return error(503, 'encryption_unavailable')
  return encryption
}

async function sealPayload(encryption: TenantDataEncryptionService, entityId: string, payload: Record<string, string>, scope: Scope) {
  try { return await encryption.encryptEntityPayload(entityId, payload, scope.tenantId, scope.organizationId) } catch { return error(503, 'encryption_unavailable') }
}

function evaluationIdOf(snapshot: z.infer<typeof storedMaterialSchema>) {
  return snapshot.material.kind === 'eligibility' ? snapshot.material.data.requestId : snapshot.material.data.evaluationId
}

async function validateStoredSnapshot(row: PhotographerEvaluationMaterial, scope: Scope) {
  let snapshot: z.infer<typeof storedMaterialSchema>
  try { snapshot = storedMaterialSchema.parse(decodeMaterialSnapshot(row)) } catch { return error(409, 'material_corrupt') }
  const expectedId = materialOperationId(materialOperationId(row.operationId, `${scope.tenantId}:${scope.organizationId}`), 'manifest')
  if (row.id !== expectedId || row.schemaVersion !== 1 || row.kind !== snapshot.material.kind || row.evaluationId !== evaluationIdOf(snapshot) || row.photographerId !== snapshot.photographerId || row.personId !== snapshot.personId || (row.dealId ?? null) !== (snapshot.dealId ?? null) || (row.registrationId ?? null) !== (snapshot.registrationId ?? null)) return error(409, 'material_corrupt')
  return snapshot
}

export async function storeEvaluationMaterial(raw: unknown, ctx: CommandRuntimeContext): Promise<{ id: string }> {
  const input = storeMaterialSchema.parse(raw)
  const scope = await authorize(ctx, true)
  const em = ctx.container.resolve<EntityManager>('em').fork()
  const snapshot = input.snapshot
  if ((snapshot.material.kind === 'eligibility' || snapshot.material.kind === 'waiver') && snapshot.material.data.confirmedBy !== ctx.auth?.sub) return error(403, 'forbidden')
  await requireOwners(em, snapshot, scope)
  const encryption = await requireEncryption(ctx, scope)
  const encoded = encodeMaterialSnapshot(snapshot)
  const scopedOperationId = materialOperationId(input.operationId, `${scope.tenantId}:${scope.organizationId}`)
  const id = materialOperationId(scopedOperationId, 'manifest')
  const sealed = await sealPayload(encryption, materialEntityId, { body: encoded.body }, scope)
  if (typeof sealed.body !== 'string' || sealed.body === encoded.body) return error(503, 'encryption_unavailable')
  const ciphertext = sealed.body
  return em.transactional(async (transaction) => {
    await transaction.getConnection().execute('select pg_advisory_xact_lock(hashtextextended(?, 0))', [`photographers:material:${scope.tenantId}:${scope.organizationId}:${input.operationId}`], 'all', transaction.getTransactionContext())
    const existing = await findOneWithDecryption(transaction, PhotographerEvaluationMaterial, { operationId: input.operationId, ...scope }, {}, scope)
    if (existing) {
      await validateStoredSnapshot(existing, scope)
      if (existing.id !== id || existing.body !== encoded.body) return error(409, 'material_conflict')
      return { id }
    }
    const record = transaction.create(PhotographerEvaluationMaterial, {
      id,
      ...scope,
      operationId: input.operationId,
      evaluationId: evaluationIdOf(snapshot),
      photographerId: snapshot.photographerId,
      personId: snapshot.personId,
      registrationId: snapshot.registrationId ?? null,
      dealId: snapshot.dealId ?? null,
      kind: snapshot.material.kind,
      schemaVersion: 1,
      byteLength: encoded.byteLength,
      checksum: encoded.checksum,
      body: ciphertext,
    })
    await transaction.persist(record).flush()
    return { id }
  })
}

export async function readEvaluationMaterial(id: string, ctx: CommandRuntimeContext) {
  uuid.parse(id)
  const scope = await authorize(ctx, false)
  const encryption = await resolveEncryption(ctx)
  let encryptedFields: string[]
  try { encryptedFields = await encryption.getEncryptedFieldNames(materialEntityId, scope.tenantId, scope.organizationId) } catch { return error(503, 'encryption_unavailable') }
  if (!encryptedFields.includes('body')) return error(503, 'encryption_unavailable')
  const em = ctx.container.resolve<EntityManager>('em').fork()
  const row = await findOneWithDecryption(em, PhotographerEvaluationMaterial, { id, ...scope }, {}, scope)
  if (!row || typeof row.body !== 'string') return error(404, 'material_not_found')
  const decoded = await validateStoredSnapshot(row, scope)
  await requireOwners(em, decoded, scope)
  return { id, evaluationId: row.evaluationId, schemaVersion: 1, updatedAt: row.updatedAt.toISOString(), photographerId: decoded.photographerId, personId: decoded.personId, registrationId: decoded.registrationId, dealId: decoded.dealId, ...decoded.material }
}
