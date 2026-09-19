import { AsyncLocalStorage } from 'node:async_hooks'
import { asValue, createContainer } from 'awilix'
import { withDemoOperationLock } from '../lib/demo-operation-lock'


function fixture() {
  const ambient = new AsyncLocalStorage<string>()
  const lifecycle: string[] = []
  const transaction = {}
  const lockEm = {
    begin: jest.fn(async () => { lifecycle.push('begin') }),
    commit: jest.fn(async () => { lifecycle.push('commit') }),
    rollback: jest.fn(async () => { lifecycle.push('rollback') }),
    transactional: jest.fn((action: () => Promise<unknown>) => ambient.run('lock-transaction', action)),
    getTransactionContext: () => transaction,
    getConnection: () => ({ execute: jest.fn(async (_sql: string, values: unknown[], _method: string, ctx: unknown) => {
      expect(values).toEqual(['photographers:demo:request'])
      expect(ctx).toBe(transaction)
      lifecycle.push('lock')
    }) }),
  }
  const container = createContainer()
  container.register({ em: asValue({ fork: () => lockEm }) })
  return { container, lockEm, lifecycle, ambient }
}

test('advisory lock remains held while independently committed commands are immediately readable', async () => {
  const { container, lockEm, lifecycle, ambient } = fixture()
  let committedRecord: string | null = null
  const result = await withDemoOperationLock(container, 'request', async () => {
    expect(ambient.getStore()).toBeUndefined()
    expect(lockEm.commit).not.toHaveBeenCalled()
    committedRecord = ambient.getStore() ? null : 'native-committed-record'
    lifecycle.push('native-command', 'fresh-read')
    return committedRecord
  })
  expect(result).toBe('native-committed-record')
  expect(lifecycle).toEqual(['begin', 'lock', 'native-command', 'fresh-read', 'commit'])
  expect(lockEm.transactional).not.toHaveBeenCalled()
  expect(lockEm.rollback).not.toHaveBeenCalled()
})

test('a failed command releases the advisory transaction and retains the original failure', async () => {
  const { container, lockEm, lifecycle } = fixture()
  const failure = new Error('native command failed')
  await expect(withDemoOperationLock(container, 'request', async () => { throw failure })).rejects.toBe(failure)
  expect(lifecycle).toEqual(['begin', 'lock', 'rollback'])
  expect(lockEm.commit).not.toHaveBeenCalled()
})
