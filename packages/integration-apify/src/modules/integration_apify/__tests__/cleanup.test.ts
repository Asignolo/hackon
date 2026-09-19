import { cleanupApifyRunStorage } from '../lib/cleanup'

describe('Apify storage cleanup', () => {
  it('deletes only the concrete storage IDs attached to the run', async () => {
    const deleted: string[] = []
    const client = {
      dataset: (id: string) => ({ delete: async () => { deleted.push(`dataset:${id}`) } }),
      keyValueStore: (id: string) => ({ delete: async () => { deleted.push(`store:${id}`) } }),
      requestQueue: (id: string) => ({ delete: async () => { deleted.push(`queue:${id}`) } }),
    }
    await expect(cleanupApifyRunStorage(client as never, {
      defaultDatasetId: 'dataset-a',
      defaultKeyValueStoreId: 'store-a',
      defaultRequestQueueId: 'queue-a',
    })).resolves.toEqual({ attempted: 3, failed: 0 })
    expect(deleted).toEqual(['dataset:dataset-a', 'store:store-a', 'queue:queue-a'])
  })

  it('settles all cleanup operations and reports failures', async () => {
    const client = {
      dataset: () => ({ delete: async () => { throw new Error('failed') } }),
      keyValueStore: () => ({ delete: async () => undefined }),
      requestQueue: () => ({ delete: async () => undefined }),
    }
    await expect(cleanupApifyRunStorage(client as never, {
      defaultDatasetId: 'dataset-a',
      defaultKeyValueStoreId: 'store-a',
    })).resolves.toEqual({ attempted: 2, failed: 1 })
  })
})
