import { ApifyClient } from 'apify-client'
import { apifyCredentialsSchema } from '../credentials'

export type ApifyRunRecord = {
  id: string
  status: string
  defaultDatasetId?: string | null
  defaultKeyValueStoreId?: string | null
  defaultRequestQueueId?: string | null
  usageTotalUsd?: number
}

export type ApifyClientLike = {
  user(): { get(): Promise<unknown> }
  actor(id: string): {
    get(): Promise<unknown>
    start(input: Record<string, unknown>, options: Record<string, unknown>): Promise<ApifyRunRecord>
    builds(): { list(options?: Record<string, unknown>): Promise<{ items: Array<Record<string, unknown>> }> }
  }
  run(id: string): {
    get(options?: Record<string, unknown>): Promise<ApifyRunRecord | undefined>
    abort(options?: Record<string, unknown>): Promise<ApifyRunRecord>
  }
  dataset(id: string): {
    listItems(options?: Record<string, unknown>): Promise<{ items: Array<Record<string, unknown>> }>
    delete(): Promise<void>
  }
  keyValueStore(id: string): { delete(): Promise<void> }
  requestQueue(id: string): { delete(): Promise<void> }
}

export function createApifyClient(credentials: Record<string, unknown>): ApifyClientLike {
  const { apiToken } = apifyCredentialsSchema.parse(credentials)
  return new ApifyClient({ token: apiToken, maxRetries: 0 }) as unknown as ApifyClientLike
}
