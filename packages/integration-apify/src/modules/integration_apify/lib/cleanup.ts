import type { ApifyClientLike, ApifyRunRecord } from './client'

export type ApifyCleanupResult = {
  attempted: number
  failed: number
}

export async function cleanupApifyRunStorage(
  client: ApifyClientLike,
  run: Pick<ApifyRunRecord, 'defaultDatasetId' | 'defaultKeyValueStoreId' | 'defaultRequestQueueId'>,
): Promise<ApifyCleanupResult> {
  const operations: Array<Promise<void>> = []
  if (run.defaultDatasetId) operations.push(client.dataset(run.defaultDatasetId).delete())
  if (run.defaultKeyValueStoreId) operations.push(client.keyValueStore(run.defaultKeyValueStoreId).delete())
  if (run.defaultRequestQueueId) operations.push(client.requestQueue(run.defaultRequestQueueId).delete())
  const settled = await Promise.allSettled(operations)
  return {
    attempted: settled.length,
    failed: settled.filter((entry) => entry.status === 'rejected').length,
  }
}
