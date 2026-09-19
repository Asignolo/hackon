import type { IntegrationScope } from '@open-mercato/shared/modules/integrations/types'
import { createHash } from 'node:crypto'
import { ACTOR_CATALOG_ENTRIES } from './actor-catalog'
import { createApifyHealthClient, type ApifyClientLike } from './client'

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

export function resolveApifyInputSchemaHash(build: Record<string, unknown>): string | null {
  if (typeof build.inputSchemaHash === 'string') return build.inputSchemaHash
  const actorDefinition = build.actorDefinition
  if (!actorDefinition || typeof actorDefinition !== 'object') return null
  const input = (actorDefinition as Record<string, unknown>).input
  if (!input || typeof input !== 'object') return null
  return createHash('sha256').update(stableJson(input)).digest('hex')
}

export function resolveApifyPricingFingerprint(
  actor: Record<string, unknown>,
  now = Date.now(),
): string | null {
  if (typeof actor.pricingFingerprint === 'string') return actor.pricingFingerprint
  if (!Array.isArray(actor.pricingInfos)) return null
  const activePricing = actor.pricingInfos
    .filter((entry): entry is Record<string, unknown> => {
      if (!entry || typeof entry !== 'object') return false
      const startedAt = (entry as Record<string, unknown>).startedAt
      const startedAtMs = startedAt instanceof Date
        ? startedAt.getTime()
        : typeof startedAt === 'string' ? Date.parse(startedAt) : Number.NaN
      return Number.isFinite(startedAtMs) && startedAtMs <= now
    })
    .sort((left, right) => {
      const rightStartedAt = right.startedAt instanceof Date
        ? right.startedAt.getTime()
        : Date.parse(String(right.startedAt))
      const leftStartedAt = left.startedAt instanceof Date
        ? left.startedAt.getTime()
        : Date.parse(String(left.startedAt))
      return rightStartedAt - leftStartedAt
    })[0]
  if (!activePricing || typeof activePricing.pricingModel !== 'string') return null
  const pricingPerEvent = activePricing.pricingPerEvent
  const actorChargeEvents = pricingPerEvent && typeof pricingPerEvent === 'object'
    ? (pricingPerEvent as Record<string, unknown>).actorChargeEvents
    : null
  const events = actorChargeEvents && typeof actorChargeEvents === 'object'
    ? Object.entries(actorChargeEvents as Record<string, unknown>).map(([key, rawEvent]) => {
        const event = rawEvent && typeof rawEvent === 'object' ? rawEvent as Record<string, unknown> : {}
        const tiers = event.eventTieredPricingUsd
        return {
          key,
          eventPriceUsd: typeof event.eventPriceUsd === 'number' ? event.eventPriceUsd : null,
          tiers: tiers && typeof tiers === 'object'
            ? Object.entries(tiers as Record<string, unknown>).map(([tierKey, rawTier]) => {
                const tier = rawTier && typeof rawTier === 'object' ? rawTier as Record<string, unknown> : {}
                return {
                  key: tierKey,
                  price: typeof tier.tieredEventPriceUsd === 'number' ? tier.tieredEventPriceUsd : null,
                }
              }).sort((left, right) => left.key.localeCompare(right.key))
            : [],
        }
      }).sort((left, right) => left.key.localeCompare(right.key))
    : []
  return createHash('sha256').update(stableJson({
    pricingModel: activePricing.pricingModel,
    minimalMaxTotalChargeUsd: typeof activePricing.minimalMaxTotalChargeUsd === 'number'
      ? activePricing.minimalMaxTotalChargeUsd
      : null,
    pricePerUnitUsd: typeof activePricing.pricePerUnitUsd === 'number'
      ? activePricing.pricePerUnitUsd
      : null,
    events,
  })).digest('hex')
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
    const [rawActor, build] = await Promise.all([
      client.actor(entry.actorId).get(),
      client.build(entry.buildId).get(),
    ])
    if (!rawActor || typeof rawActor !== 'object' || !build) return 'catalog_unavailable' as const
    const actor = rawActor as Record<string, unknown>
    const buildNumber = build.buildNumber
    if (buildNumber !== entry.build) return 'catalog_unavailable' as const
    return resolveApifyInputSchemaHash(build) === entry.inputSchemaHash
      && resolveApifyPricingFingerprint(actor) === entry.pricingFingerprint
      ? 'healthy' as const
      : 'schema_mismatch' as const
  }))
  if (entries.includes('catalog_unavailable')) return 'catalog_unavailable'
  if (entries.includes('schema_mismatch')) return 'schema_mismatch'
  return 'healthy'
}

export function createApifyHealthCheck(
  createClient: (credentials: Record<string, unknown>) => ApifyClientLike = createApifyHealthClient,
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
              ? 'An Apify actor schema or pricing model no longer matches the pinned contract.'
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
