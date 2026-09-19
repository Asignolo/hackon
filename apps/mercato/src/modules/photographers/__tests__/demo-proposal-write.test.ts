import { asValue, createContainer } from 'awilix'
import type { EventSubscriber, TransactionEventArgs, FlushEventArgs } from '@mikro-orm/core'
import type { CommandRuntimeContext } from '@open-mercato/shared/lib/commands'
import { CustomerDeal, CustomerInteraction } from '@open-mercato/core/modules/customers/data/entities'
import { observeDemoCrmWrite } from '../lib/demo-proposal-write'

jest.mock('../lib/proposal-review-materials', () => ({ reviewError: async (status: number) => { throw Object.assign(new Error('blocked'), { status }) } }))
jest.mock('@open-mercato/core/modules/customers/data/entities', () => ({ CustomerEntity: class CustomerEntity {}, CustomerDeal: class CustomerDeal {}, CustomerInteraction: class CustomerInteraction {} }))
const initial = '2026-09-19T12:00:00.000Z', written = '2026-09-19T12:01:00.000Z'
let subscriber: EventSubscriber | undefined
let personAt: string, dealAt: string
let scopeSeen: unknown[]
const execute = jest.fn()
const registerSubscriber = jest.fn((value: EventSubscriber) => { subscriber = value })
const query = jest.fn()
const transactionContext = {}
const em = { getTransactionContext: () => transactionContext, getConnection: () => ({ execute: query }), getEventManager: () => ({ registerSubscriber }), fork: jest.fn() }
const originalEm = { fork: jest.fn(() => em) }
const expected = { photographerId: 'person', dealId: 'deal', personUpdatedAt: initial, dealUpdatedAt: initial }
function context(): CommandRuntimeContext {
  const container = createContainer()
  container.register({ em: asValue(originalEm), commandBus: asValue({ execute }) })
  return { container, auth: { sub: 'user', tenantId: 'tenant', orgId: 'org' }, selectedOrganizationId: 'org', organizationIds: ['org'], organizationScope: null }
}
async function transaction(interaction = false, flush = true) {
  const args = { em, transaction: transactionContext } as unknown as TransactionEventArgs
  await subscriber!.afterTransactionStart!(args)
  await subscriber!.beforeFlush!({ em } as unknown as FlushEventArgs)
  if (flush) {
    const entity = Object.assign(interaction ? new CustomerInteraction() : new CustomerDeal(), { id: interaction ? 'interaction' : 'deal' })
    subscriber!.afterFlush!({ em, uow: { getChangeSets: () => [{ entity }] } } as unknown as FlushEventArgs)
  }
  if (interaction) personAt = written
  else dealAt = written
  await subscriber!.beforeTransactionCommit!(args)
  await subscriber!.afterTransactionCommit!(args)
}
beforeEach(() => {
  jest.clearAllMocks()
  personAt = initial; dealAt = initial; subscriber = undefined; scopeSeen = []
  em.fork.mockReturnValue(em)
  query.mockImplementation(async (sql: string, args: unknown[], _mode: string, transaction: unknown) => {
    scopeSeen.push(args)
    expect(transaction).toBe(transactionContext)
    return [{ updated_at: new Date(sql.includes('customer_entities') ? personAt : sql.includes('customer_deals') ? dealAt : written) }]
  })
})

test('captures exact deal write versions from cloned command EM and never registers globally', async () => {
  const ctx = context()
  execute.mockImplementation(async (_command, options) => {
    expect(options.ctx.container).not.toBe(ctx.container)
    expect(options.ctx.container.resolve('em').fork()).toBe(em)
    await transaction()
  })
  await expect(observeDemoCrmWrite('customers.deals.update', { id: 'deal' }, ctx, expected)).resolves.toEqual({ personUpdatedAt: initial, dealUpdatedAt: written, interactionUpdatedAt: null })
  expect(originalEm.fork).toHaveBeenCalledWith({ cloneEventManager: true })
  expect(ctx.container.resolve('em')).toBe(originalEm)
  expect(scopeSeen).toEqual(expect.arrayContaining([['person', 'tenant', 'org']]))
})

test('captures person projection written after interaction flush but before transaction commit', async () => {
  execute.mockImplementation(() => transaction(true))
  await expect(observeDemoCrmWrite('customers.interactions.create', { id: 'interaction' }, context(), expected)).resolves.toEqual({ personUpdatedAt: written, dealUpdatedAt: initial, interactionUpdatedAt: written })
})

test('concurrent change fails inside row-lock check before core mutation', async () => {
  personAt = written
  execute.mockImplementation(() => transaction())
  await expect(observeDemoCrmWrite('customers.deals.update', { id: 'deal' }, context(), expected)).rejects.toMatchObject({ status: 409 })
  expect(dealAt).toBe(initial)
})

test('missing target flush or transaction observer cannot produce a checkpoint', async () => {
  execute.mockImplementation(() => transaction(false, false))
  await expect(observeDemoCrmWrite('customers.deals.update', { id: 'deal' }, context(), expected)).rejects.toMatchObject({ status: 409 })
  execute.mockResolvedValue({})
  await expect(observeDemoCrmWrite('customers.deals.update', { id: 'deal' }, context(), expected)).rejects.toMatchObject({ status: 409 })
})
