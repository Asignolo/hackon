import type { AwilixContainer } from 'awilix'
import type { EntityManager } from '@mikro-orm/postgresql'

export async function withDemoOperationLock<Result>(container: AwilixContainer, key: string, action: () => Promise<Result>): Promise<Result> {
  const lockEm = container.resolve<EntityManager>('em').fork()
  await lockEm.begin()
  try {
    await lockEm.getConnection().execute('select pg_advisory_xact_lock(hashtextextended(?, 0))', [`photographers:demo:${key}`], 'all', lockEm.getTransactionContext())
    const result = await action()
    await lockEm.commit()
    return result
  } catch (error) {
    try { await lockEm.rollback() } finally { throw error }
  }
}
