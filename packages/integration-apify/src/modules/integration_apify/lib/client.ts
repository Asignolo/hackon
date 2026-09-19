import { ApifyClient } from 'apify-client'
import { apifyCredentialsSchema } from '../credentials'

export const MAX_APIFY_READ_RESPONSE_BYTES = 256 * 1024

export function applyApifyReadResponseLimit<T extends { maxContentLength?: number }>(config: T): T {
  config.maxContentLength = MAX_APIFY_READ_RESPONSE_BYTES
  return config
}

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

function createClient(
  credentials: Record<string, unknown>,
  maxRetries: number,
  timeoutSecs: number,
  boundResponseSize = false,
): ApifyClientLike {
  const { apiToken } = apifyCredentialsSchema.parse(credentials)
  return new ApifyClient({
    token: apiToken,
    maxRetries,
    timeoutSecs,
    requestInterceptors: boundResponseSize ? [applyApifyReadResponseLimit] : [],
  }) as unknown as ApifyClientLike
}

export function createApifyMutationClient(
  credentials: Record<string, unknown>,
  timeoutSecs = 30,
): ApifyClientLike {
  return createClient(credentials, 0, timeoutSecs)
}

export function createApifyReadClient(
  credentials: Record<string, unknown>,
  timeoutSecs = 30,
): ApifyClientLike {
  return createClient(credentials, 2, timeoutSecs, true)
}

export function createApifyHealthClient(
  credentials: Record<string, unknown>,
): ApifyClientLike {
  return createClient(credentials, 1, 3, true)
}

export const createApifyClient = createApifyReadClient
