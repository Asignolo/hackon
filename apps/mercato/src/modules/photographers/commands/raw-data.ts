import type { EntityManager } from '@mikro-orm/postgresql'
import { registerCommand, type CommandHandler } from '@open-mercato/shared/lib/commands'
import { emitCrudSideEffects } from '@open-mercato/shared/lib/commands/helpers'
import { CrudHttpError } from '@open-mercato/shared/lib/crud/errors'
import type { DataEngine } from '@open-mercato/shared/lib/data/engine'
import { findOneWithDecryption } from '@open-mercato/shared/lib/encryption/find'
import type { TenantDataEncryptionService } from '@open-mercato/shared/lib/encryption/tenantDataEncryptionService'
import { CustomerEntity } from '@open-mercato/core/modules/customers/data/entities'
import { PhotographerRawData } from '../data/entities'
import { rawDataCreateSchema } from '../data/validators'
import { requirePhotographerScope } from '../lib/scope'
import { resolveTranslations } from '@open-mercato/shared/lib/i18n/server'

export const rawDataEntityId = 'photographers:photographer_raw_data'

export const createRawDataCommand: CommandHandler<unknown, { id: string }> = {
  id: 'photographers.raw_data.create',
  isUndoable: false,
  async execute(input, ctx) {
    const parsed = rawDataCreateSchema.parse(input)
    const scope = await requirePhotographerScope(ctx)
    const { translate } = await resolveTranslations()
    const em = ctx.container.resolve<EntityManager>('em')
    if (parsed.customerEntityId) {
      const customer = await findOneWithDecryption(em, CustomerEntity, {
        id: parsed.customerEntityId,
        ...scope,
        deletedAt: null,
      }, {}, scope)
      if (!customer) throw new CrudHttpError(400, { error: translate('photographers.errors.customer_not_found') })
    }
    const encryption = ctx.container.resolve<TenantDataEncryptionService>('tenantEncryptionService')
    const source = {
      firstName: parsed.firstName,
      lastName: parsed.lastName,
      email: parsed.email,
      portfolioRaw: parsed.portfolioRaw,
    }
    const encrypted = await encryption.encryptEntityPayload(rawDataEntityId, source, scope.tenantId, scope.organizationId)
    const encryptedField = (field: keyof typeof source): string => {
      const value = encrypted[field]
      if (typeof value !== 'string' || value === source[field]) {
        throw new CrudHttpError(503, { error: translate('photographers.errors.encryption_unavailable') })
      }
      return value
    }
    const dataEngine = ctx.container.resolve<DataEngine>('dataEngine')
    const entity = await dataEngine.createOrmEntity({
      entity: PhotographerRawData,
      data: {
        ...scope,
        firstName: encryptedField('firstName'),
        lastName: encryptedField('lastName'),
        email: encryptedField('email'),
        portfolioRaw: encryptedField('portfolioRaw'),
        submittedAt: parsed.submittedAt ? new Date(parsed.submittedAt) : new Date(),
        customerEntityId: parsed.customerEntityId ?? null,
      },
    })
    await emitCrudSideEffects({
      dataEngine,
      action: 'created',
      entity,
      identifiers: { id: entity.id, ...scope },
      events: { module: 'photographers', entity: 'raw_data', persistent: true },
      indexer: { entityType: rawDataEntityId },
    })
    return { id: entity.id }
  },
  buildLog: async ({ result, ctx }) => {
    const { translate } = await resolveTranslations()
    return {
      actionLabel: translate('photographers.audit.raw_data.create'),
      resourceKind: rawDataEntityId,
      resourceId: result.id,
      payload: { __redoInput: {} },
      ...await requirePhotographerScope(ctx),
    }
  },
}

registerCommand(createRawDataCommand)
