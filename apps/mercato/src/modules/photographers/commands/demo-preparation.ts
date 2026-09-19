import { z } from 'zod'
import { LockMode } from '@mikro-orm/core'
import type { EntityManager } from '@mikro-orm/postgresql'
import { registerCommand, type CommandHandler } from '@open-mercato/shared/lib/commands'
import { emitCrudSideEffects } from '@open-mercato/shared/lib/commands/helpers'
import { enforceCommandOptimisticLock } from '@open-mercato/shared/lib/crud/optimistic-lock-command'
import { OPTIMISTIC_LOCK_HEADER_NAME } from '@open-mercato/shared/lib/crud/optimistic-lock-headers'
import { findOneWithDecryption } from '@open-mercato/shared/lib/encryption/find'
import type { DataEngine } from '@open-mercato/shared/lib/data/engine'
import { resolveTranslations } from '@open-mercato/shared/lib/i18n/server'
import type { ModuleConfigService } from '@open-mercato/core/modules/configs/lib/module-config-service'
import { CustomerEntity } from '@open-mercato/core/modules/customers/data/entities'
import { PhotographerRawData } from '../data/entities'
import { authorizeDemoPreparation, demoPreparationError, demoPreparationInputSchema, guardDemoMutation, preparePhotographerDemo, type PreparedPhotographerDemo } from '../lib/demo-preparation'
import { materialOperationId } from '../lib/material-codec'
import { requirePhotographerScope } from '../lib/scope'
import { rawDataEntityId } from '../lib/raw-data-create'

const linkInputSchema = demoPreparationInputSchema.extend({
  registrationId: z.string().uuid(), customerEntityId: z.string().uuid(), expectedUpdatedAt: z.string().datetime(),
}).strict()

export const linkDemoRegistrationCommand: CommandHandler<unknown, { id: string }> = {
  id: 'photographers.demo.link_registration',
  isUndoable: false,
  async execute(raw, ctx) {
    const input = linkInputSchema.parse(raw)
    const { userId, ...scope } = await authorizeDemoPreparation(ctx)
    const scopedId = materialOperationId(input.requestId, `${scope.tenantId}:${scope.organizationId}:demo`)
    if (input.registrationId !== materialOperationId(scopedId, 'registration')) return demoPreparationError(409)
    const service = ctx.container.resolve<ModuleConfigService>('moduleConfigService')
    const receipt = z.object({ registrationId: z.string(), userId: z.string(), photographerId: z.string() }).safeParse(await service.getValue('photographers', `demo_preparation_${scope.organizationId}_${input.requestId}`, { scope }))
    if (!receipt.success || receipt.data.registrationId !== input.registrationId || receipt.data.userId !== userId || receipt.data.photographerId !== input.customerEntityId) return demoPreparationError(409)
    const em = ctx.container.resolve<EntityManager>('em').fork({ keepTransactionContext: true })
    const headers = new Headers(ctx.request?.headers)
    headers.set(OPTIMISTIC_LOCK_HEADER_NAME, input.expectedUpdatedAt)
    const request = new Request(ctx.request?.url ?? 'http://localhost/internal/photographers/demo', { method: 'PATCH', headers })
    const guarded = await guardDemoMutation({ ...ctx, request }, rawDataEntityId, input.registrationId, { customerEntityId: input.customerEntityId })
    const entity = await em.transactional(async (transaction) => {
      const registration = await findOneWithDecryption(transaction, PhotographerRawData, { id: input.registrationId, ...scope, deletedAt: null }, { lockMode: LockMode.PESSIMISTIC_WRITE }, scope)
      const customer = await findOneWithDecryption(transaction, CustomerEntity, { id: input.customerEntityId, ...scope, kind: 'person', source: `photographers:raw:${input.registrationId}`, deletedAt: null }, {}, scope)
      if (!registration || !customer || !registration.isActive) return demoPreparationError(409)
      enforceCommandOptimisticLock({ resourceKind: rawDataEntityId, resourceId: registration.id, current: registration.updatedAt, expected: input.expectedUpdatedAt, request })
      if (registration.customerEntityId && registration.customerEntityId !== customer.id) return demoPreparationError(409)
      registration.customerEntityId = customer.id
      await transaction.flush()
      return registration
    })
    await emitCrudSideEffects({ dataEngine: ctx.container.resolve<DataEngine>('dataEngine'), action: 'updated', entity,
      identifiers: { id: entity.id, ...scope }, actorUserId: userId,
      events: { module: 'photographers', entity: 'raw_data', persistent: true }, indexer: { entityType: rawDataEntityId } })
    await guarded.runAfterSuccess()
    return { id: entity.id }
  },
  async buildLog({ result, ctx }) {
    const { translate } = await resolveTranslations()
    return { actionLabel: translate('photographers.audit.demo.raw_link'), resourceKind: rawDataEntityId, resourceId: result.id, payload: { __redoInput: {} }, ...await requirePhotographerScope(ctx) }
  },
}

export const prepareDemoCommand: CommandHandler<unknown, PreparedPhotographerDemo> = {
  id: 'photographers.demo.prepare', isUndoable: false,
  execute: (input, ctx) => preparePhotographerDemo(demoPreparationInputSchema.parse(input).requestId, ctx),
  async buildLog({ result, ctx }) {
    const { translate } = await resolveTranslations()
    return { actionLabel: translate('photographers.audit.demo.prepare'), resourceKind: rawDataEntityId, resourceId: result.registrationId,
      payload: { requestId: result.requestId, __redoInput: {} }, ...await requirePhotographerScope(ctx) }
  },
}

registerCommand(linkDemoRegistrationCommand)
registerCommand(prepareDemoCommand)
