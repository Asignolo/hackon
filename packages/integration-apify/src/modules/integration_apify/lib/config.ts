import { z } from 'zod'

const numericToken = z.string().trim().min(1)

function readNumber(
  env: NodeJS.ProcessEnv,
  key: string,
  fallback: number,
  minimum: number,
  maximum: number,
): number {
  const raw = env[key]
  if (raw === undefined || raw.trim() === '') return fallback
  numericToken.parse(raw)
  const parsed = Number(raw)
  if (!Number.isFinite(parsed)) throw new Error(`[internal] ${key} must be numeric.`)
  return Math.min(maximum, Math.max(minimum, parsed))
}

function readInteger(
  env: NodeJS.ProcessEnv,
  key: string,
  fallback: number,
  minimum: number,
  maximum: number,
): number {
  const parsed = readNumber(env, key, fallback, minimum, maximum)
  if (!Number.isInteger(parsed)) throw new Error(`[internal] ${key} must be an integer.`)
  return parsed
}

export type ApifyConfig = {
  maxChargeUsd: number
  timeoutSeconds: number
  maxItems: number
  maxConcurrency: number
  maxConcurrencyPerTenant: number
  maxCallsPerRun: number
  runBudgetMilliUsd: number
  tenantCallsPerHour: number
  tenantBudgetMilliUsdPerHour: number
}

export function readApifyConfig(env: NodeJS.ProcessEnv = process.env): ApifyConfig {
  const maxConcurrency = readInteger(env, 'OM_INTEGRATION_APIFY_MAX_CONCURRENCY', 4, 1, 8)
  return {
    maxChargeUsd: readNumber(env, 'OM_INTEGRATION_APIFY_MAX_CHARGE_USD', 0.25, 0.01, 0.5),
    timeoutSeconds: readInteger(env, 'OM_INTEGRATION_APIFY_TIMEOUT_SECONDS', 120, 30, 180),
    maxItems: readInteger(env, 'OM_INTEGRATION_APIFY_MAX_ITEMS', 25, 1, 25),
    maxConcurrency,
    maxConcurrencyPerTenant: Math.min(
      maxConcurrency,
      readInteger(env, 'OM_INTEGRATION_APIFY_MAX_CONCURRENCY_PER_TENANT', 2, 1, 4),
    ),
    maxCallsPerRun: readInteger(env, 'OM_INTEGRATION_APIFY_MAX_CALLS_PER_RUN', 4, 1, 8),
    runBudgetMilliUsd: Math.round(
      readNumber(env, 'OM_INTEGRATION_APIFY_RUN_BUDGET_USD', 0.5, 0.01, 1) * 1000,
    ),
    tenantCallsPerHour: readInteger(env, 'OM_INTEGRATION_APIFY_TENANT_CALLS_PER_HOUR', 30, 1, 120),
    tenantBudgetMilliUsdPerHour: Math.round(
      readNumber(env, 'OM_INTEGRATION_APIFY_TENANT_BUDGET_USD_PER_HOUR', 5, 0.01, 20) * 1000,
    ),
  }
}
