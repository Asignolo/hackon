import type { IntegrationScope } from '@open-mercato/shared/modules/integrations/types'
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
        await createClient(credentials).user().get()
        return {
          status: 'healthy',
          message: 'Apify credentials are valid.',
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
