import type { IntegrationScope } from '@open-mercato/shared/modules/integrations/types'
import { createHash } from 'node:crypto'
import { ACTOR_CATALOG_ENTRIES } from './actor-catalog'
import { createApifyClient, type ApifyClientLike } from './client'

export type ApifyHealthReason =
  | 'healthy'
  | 'invalid_credentials'
  | 'catalog_unavailable'
  | 'schema_mismatch'
  | 'upstream_unavailable'

type HealthResult = {
  status: 'healthy' | 'degraded' | 'unhealthy'
  message: string
  details: { reason: ApifyHealthReason }
}

function readStatusCode(error: unknown): number | null {
  if (!error || typeof error !== 'object') return null
  const value = (error as { statusCode?: unknown }).statusCode
  return typeof value === 'number' ? value : null
}

function stableJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(',')}]`
  if (value && typeof value === 'object') {
    return `{${Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, entry]) => `${JSON.stringify(key)}:${stableJson(entry)}`)
      .join(',')}}`
  }
  return JSON.stringify(value) ?? 'null'
}

function resolveSchemaHash(build: Record<string, unknown>): string | null {
  if (typeof build.inputSchemaHash === 'string') return build.inputSchemaHash
  const actorDefinition = build.actorDefinition
  if (!actorDefinition || typeof actorDefinition !== 'object') return null
  const input = (actorDefinition as Record<string, unknown>).input
  if (!input || typeof input !== 'object') return null
  const schema = (input as Record<string, unknown>).schema
  if (!schema || typeof schema !== 'object') return null
  return createHash('sha256').update(stableJson(schema)).digest('hex')
}

async function withDeadline<T>(operation: Promise<T>, timeoutMs: number): Promise<T> {
  let timeout: NodeJS.Timeout | undefined
  try {
    return await Promise.race([
      operation,
      new Promise<T>((_resolve, reject) => {
        timeout = setTimeout(() => reject(new Error('[internal] Apify health check timed out.')), timeoutMs)
      }),
    ])
  } finally {
    if (timeout) clearTimeout(timeout)
  }
}

async function validateCatalog(client: ApifyClientLike): Promise<ApifyHealthReason> {
  const entries = await Promise.all(ACTOR_CATALOG_ENTRIES.map(async (entry) => {
    const [actor, build] = await Promise.all([
      client.actor(entry.actorId).get(),
      client.build(entry.buildId).get(),
    ])
    if (!actor || !build) return 'catalog_unavailable' as const
    const buildNumber = build.buildNumber
    if (typeof buildNumber === 'string' && buildNumber !== entry.build) return 'catalog_unavailable' as const
    return resolveSchemaHash(build) === entry.inputSchemaHash ? 'healthy' as const : 'schema_mismatch' as const
  }))
  if (entries.includes('catalog_unavailable')) return 'catalog_unavailable'
  if (entries.includes('schema_mismatch')) return 'schema_mismatch'
  return 'healthy'
}

export function createApifyHealthCheck(
  createClient: (credentials: Record<string, unknown>) => ApifyClientLike = createApifyClient,
) {
  return {
    async check(credentials: Record<string, unknown> | null, _scope: IntegrationScope): Promise<HealthResult> {
      if (!credentials) {
        return {
          status: 'unhealthy',
          message: 'Apify credentials are not configured.',
          details: { reason: 'invalid_credentials' },
        }
      }
      try {
        const client = createClient(credentials)
        const [, catalogReason] = await withDeadline(Promise.all([
          client.user().get(),
          validateCatalog(client),
        ]), 10_000)
        if (catalogReason !== 'healthy') {
          return {
            status: 'unhealthy',
            message: catalogReason === 'schema_mismatch'
              ? 'An Apify actor input schema no longer matches the pinned contract.'
              : 'A pinned Apify actor build is unavailable.',
            details: { reason: catalogReason },
          }
        }
        return {
          status: 'healthy',
          message: 'Apify credentials and pinned actor builds are valid.',
          details: { reason: 'healthy' },
        }
      } catch (error) {
        const statusCode = readStatusCode(error)
        const reason: ApifyHealthReason = statusCode === 401 || statusCode === 403
          ? 'invalid_credentials'
          : 'upstream_unavailable'
        return {
          status: 'unhealthy',
          message: reason === 'invalid_credentials'
            ? 'Apify rejected the configured credentials.'
            : 'Apify health check is unavailable.',
          details: { reason },
        }
      }
    },
  }
}

export const apifyHealthCheck = createApifyHealthCheck()
