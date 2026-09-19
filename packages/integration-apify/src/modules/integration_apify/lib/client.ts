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
  build(id: string): { get(): Promise<Record<string, unknown> | undefined> }
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

function createClient(credentials: Record<string, unknown>, maxRetries: number): ApifyClientLike {
  const { apiToken } = apifyCredentialsSchema.parse(credentials)
  return new ApifyClient({ token: apiToken, maxRetries }) as unknown as ApifyClientLike
}

export function createApifyMutationClient(credentials: Record<string, unknown>): ApifyClientLike {
  return createClient(credentials, 0)
}

export function createApifyReadClient(credentials: Record<string, unknown>): ApifyClientLike {
  return createClient(credentials, 2)
}

export const createApifyClient = createApifyReadClient
