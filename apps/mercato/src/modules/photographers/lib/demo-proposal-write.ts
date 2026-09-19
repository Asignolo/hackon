import { asValue } from 'awilix'
import { type EventSubscriber, type TransactionEventArgs } from '@mikro-orm/core'
import type { EntityManager } from '@mikro-orm/postgresql'
import type { CommandBus, CommandRuntimeContext } from '@open-mercato/shared/lib/commands'
import { CustomerDeal, CustomerInteraction } from '@open-mercato/core/modules/customers/data/entities'
import { reviewError } from './proposal-review-materials'

export type DemoWriteExpectation = { photographerId: string; dealId: string; personUpdatedAt: string; dealUpdatedAt: string }
export type DemoWriteVersions = { personUpdatedAt: string; dealUpdatedAt: string; interactionUpdatedAt: string | null }

export async function observeDemoCrmWrite(command: 'customers.deals.update' | 'customers.interactions.create', payload: Record<string, unknown>, ctx: CommandRuntimeContext, expected: DemoWriteExpectation): Promise<DemoWriteVersions> {
  const scope = { tenantId: ctx.auth!.tenantId!, organizationId: ctx.selectedOrganizationId! }
  const em = ctx.container.resolve<EntityManager>('em').fork({ cloneEventManager: true })
  const child = ctx.container.createScope()
  child.register({ em: asValue(em) })
  let transactionEm: TransactionEventArgs['em'] | null = null
  let started = false, locked = false, changed = false, committed = false
  let versions: DemoWriteVersions | null = null
  const subscriber: EventSubscriber = {
    afterTransactionStart(args) {
      if (started) return
      started = true
      transactionEm = args.em
    },
    async beforeFlush(args) {
      if (args.em !== transactionEm || locked) return
      const manager = args.em as EntityManager
      const transaction = manager.getTransactionContext()
      if (!transaction) return reviewError(409, 'material_conflict')
      const person = await manager.getConnection().execute<Array<{ updated_at: Date | string }>>('select updated_at from customer_entities where id = ? and tenant_id = ? and organization_id = ? and deleted_at is null for update', [expected.photographerId, scope.tenantId, scope.organizationId], 'all', transaction)
      const deal = await manager.getConnection().execute<Array<{ updated_at: Date | string }>>('select updated_at from customer_deals where id = ? and tenant_id = ? and organization_id = ? and deleted_at is null for update', [expected.dealId, scope.tenantId, scope.organizationId], 'all', transaction)
      if (person.length !== 1 || deal.length !== 1 || new Date(person[0].updated_at).toISOString() !== expected.personUpdatedAt || new Date(deal[0].updated_at).toISOString() !== expected.dealUpdatedAt) return reviewError(409, 'material_conflict')
      locked = true
    },
    afterFlush(args) {
      if (args.em !== transactionEm) return
      changed ||= args.uow.getChangeSets().some((change) => (command === 'customers.deals.update' && change.entity instanceof CustomerDeal && change.entity.id === expected.dealId) || (command === 'customers.interactions.create' && change.entity instanceof CustomerInteraction && change.entity.id === payload.id))
    },
    async beforeTransactionCommit(args) {
      if (args.em !== transactionEm || !changed) return
      const manager = args.em as EntityManager
      if (!args.transaction || !locked) return reviewError(409, 'material_conflict')
      const person = await manager.getConnection().execute<Array<{ updated_at: Date | string }>>('select updated_at from customer_entities where id = ? and tenant_id = ? and organization_id = ? and deleted_at is null', [expected.photographerId, scope.tenantId, scope.organizationId], 'all', args.transaction)
      const deal = await manager.getConnection().execute<Array<{ updated_at: Date | string }>>('select updated_at from customer_deals where id = ? and tenant_id = ? and organization_id = ? and deleted_at is null', [expected.dealId, scope.tenantId, scope.organizationId], 'all', args.transaction)
      const interaction = command === 'customers.interactions.create' ? await manager.getConnection().execute<Array<{ updated_at: Date | string }>>('select updated_at from customer_interactions where id = ? and tenant_id = ? and organization_id = ? and deleted_at is null', [payload.id, scope.tenantId, scope.organizationId], 'all', args.transaction) : []
      if (person.length !== 1 || deal.length !== 1 || (command === 'customers.interactions.create' && interaction.length !== 1)) return reviewError(409, 'material_conflict')
      versions = { personUpdatedAt: new Date(person[0].updated_at).toISOString(), dealUpdatedAt: new Date(deal[0].updated_at).toISOString(), interactionUpdatedAt: interaction[0] ? new Date(interaction[0].updated_at).toISOString() : null }
    },
    afterTransactionCommit(args) { if (args.em === transactionEm && versions) committed = true },
    afterTransactionRollback(args) { if (args.em === transactionEm) { committed = false; versions = null } },
  }
  em.getEventManager().registerSubscriber(subscriber)
  try {
    await ctx.container.resolve<CommandBus>('commandBus').execute(command, { input: payload, ctx: { ...ctx, container: child } })
    if (!started || !changed || !committed || !versions) return reviewError(409, 'material_conflict')
    return versions
  } finally { await child.dispose() }
}
