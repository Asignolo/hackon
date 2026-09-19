import type { AwilixContainer } from 'awilix'
import { randomUUID } from 'node:crypto'
import type {
  RateLimitConfig,
  RateLimitLeaseConfig,
  RateLimitLeaseResult,
  RateLimitResult,
} from '@open-mercato/shared/lib/ratelimit/types'
import type { ApifyConfig } from './config'
import { createLogger } from '@open-mercato/shared/lib/logger'
import { getTelemetryRuntime } from '@open-mercato/shared/lib/telemetry/runtime'

type RateLimiterLike = {
  consume(key: string, config: RateLimitConfig): Promise<RateLimitResult>
  penalty(key: string, points: number, config: RateLimitConfig): Promise<RateLimitResult>
  reward(key: string, points: number, config: RateLimitConfig): Promise<RateLimitResult>
  acquireLease(key: string, holderId: string, config: RateLimitLeaseConfig): Promise<RateLimitLeaseResult>
  releaseLease(key: string, holderId: string, config: RateLimitLeaseConfig): Promise<void>
}

type AppliedReservation = {
  key: string
  points: number
  config: RateLimitConfig
}

export type ApifyQuotaFailureCode = 'budget_exceeded' | 'concurrency_limited'

export class ApifyQuotaError extends Error {
  readonly code: ApifyQuotaFailureCode

  constructor(code: ApifyQuotaFailureCode) {
    super(`[internal] Apify quota rejected: ${code}.`)
    this.name = 'ApifyQuotaError'
    this.code = code
  }
}

export type ApifyQuotaLease = {
  release(options?: { retainDistributed?: boolean }): Promise<void>
}

let processActiveRuns = 0
const logger = createLogger('integration_apify').child({ component: 'quota' })
const DEFAULT_LIMITER_OPERATION_TIMEOUT_MS = 5_000

class ApifyLimiterTimeoutError extends Error {
  constructor() {
    super('[internal] Apify quota limiter operation timed out.')
    this.name = 'ApifyLimiterTimeoutError'
  }
}

async function settleWithin<T>(
  operation: Promise<T>,
  timeoutMs: number,
  onLateResult?: (result: T) => Promise<void>,
): Promise<T> {
  let timedOut = false
  let timeout: NodeJS.Timeout | undefined
  const tracked = operation.then(async (result) => {
    if (timedOut && onLateResult) await onLateResult(result)
    return result
  })
  try {
    return await Promise.race([
      tracked,
      new Promise<T>((_resolve, reject) => {
        timeout = setTimeout(() => {
          timedOut = true
          reject(new ApifyLimiterTimeoutError())
        }, timeoutMs)
        timeout.unref?.()
      }),
    ])
  } finally {
    if (timeout) clearTimeout(timeout)
  }
}

function resolveLimiter(container: AwilixContainer): RateLimiterLike | null {
  try {
    if (typeof container.hasRegistration === 'function' && !container.hasRegistration('rateLimiterService')) {
      return null
    }
    return (container.resolve('rateLimiterService') as RateLimiterLike | undefined) ?? null
  } catch {
    return null
  }
}

function isRealAllowed(
  result: RateLimitResult,
  config: RateLimitConfig,
  kind: 'consume' | 'penalty',
): boolean {
  return !result.degraded
    && result.consumedPoints > 0
    && (result.allowed || (kind === 'penalty' && result.consumedPoints <= config.points))
}

async function rollback(limiter: RateLimiterLike, applied: AppliedReservation[]): Promise<void> {
  await Promise.allSettled(
    applied.map((entry) => limiter.reward(entry.key, entry.points, entry.config)),
  )
}

async function boundedRollback(
  limiter: RateLimiterLike,
  applied: AppliedReservation[],
  timeoutMs: number,
): Promise<void> {
  try {
    await settleWithin(rollback(limiter, applied), timeoutMs)
  } catch (error) {
    logger.error('Apify quota rollback did not complete within its deadline', { err: error })
    getTelemetryRuntime()?.reportError(new Error('[internal] Apify quota rollback timed out.'), {
      module: 'integration_apify',
      code: 'integration_apify.quota_rollback_failed',
    })
  }
}

export async function reserveApifyQuota(input: {
  container: AwilixContainer
  agentRunId: string
  tenantId: string
  reservedMilliUsd: number
  config: ApifyConfig
  operationTimeoutMs?: number
}): Promise<ApifyQuotaLease> {
  const limiter = resolveLimiter(input.container)
  if (!limiter) throw new ApifyQuotaError('budget_exceeded')
  if (processActiveRuns >= input.config.maxConcurrency) {
    throw new ApifyQuotaError('concurrency_limited')
  }
  processActiveRuns += 1
  let processSlotReleased = false
  const releaseProcessSlot = () => {
    if (processSlotReleased) return
    processSlotReleased = true
    processActiveRuns = Math.max(0, processActiveRuns - 1)
  }

  const hourSeconds = 60 * 60
  const runSeconds = 24 * hourSeconds
  const leaseSeconds = input.config.timeoutSeconds + 60
  const reservations: Array<{
    key: string
    points: number
    config: RateLimitConfig
    kind: 'consume' | 'penalty'
    rejection: ApifyQuotaFailureCode
  }> = [
    {
      key: input.agentRunId,
      points: 1,
      config: { points: input.config.maxCallsPerRun, duration: runSeconds, keyPrefix: 'apify:run:calls' },
      kind: 'consume',
      rejection: 'budget_exceeded',
    },
    {
      key: input.agentRunId,
      points: input.reservedMilliUsd,
      config: { points: input.config.runBudgetMilliUsd, duration: runSeconds, keyPrefix: 'apify:run:budget' },
      kind: 'penalty',
      rejection: 'budget_exceeded',
    },
    {
      key: input.tenantId,
      points: 1,
      config: { points: input.config.tenantCallsPerHour, duration: hourSeconds, keyPrefix: 'apify:tenant:calls' },
      kind: 'consume',
      rejection: 'budget_exceeded',
    },
    {
      key: input.tenantId,
      points: input.reservedMilliUsd,
      config: {
        points: input.config.tenantBudgetMilliUsdPerHour,
        duration: hourSeconds,
        keyPrefix: 'apify:tenant:budget',
      },
      kind: 'penalty',
      rejection: 'budget_exceeded',
    },
  ]

  const applied: AppliedReservation[] = []
  const operationTimeoutMs = input.operationTimeoutMs ?? DEFAULT_LIMITER_OPERATION_TIMEOUT_MS
  for (const reservation of reservations) {
    let result: RateLimitResult
    try {
      const operation = reservation.kind === 'consume'
        ? limiter.consume(reservation.key, reservation.config)
        : limiter.penalty(reservation.key, reservation.points, reservation.config)
      result = await settleWithin(operation, operationTimeoutMs, async (lateResult) => {
        if (!lateResult.degraded && lateResult.consumedPoints > 0) {
          await limiter.reward(reservation.key, reservation.points, reservation.config)
        }
      })
    } catch {
      releaseProcessSlot()
      await boundedRollback(limiter, applied, operationTimeoutMs)
      throw new ApifyQuotaError(reservation.rejection)
    }
    if (!isRealAllowed(result, reservation.config, reservation.kind)) {
      const rejectedReservation = !result.degraded && result.consumedPoints > 0
        ? [{ key: reservation.key, points: reservation.points, config: reservation.config }]
        : []
      releaseProcessSlot()
      await boundedRollback(limiter, [...applied, ...rejectedReservation], operationTimeoutMs)
      throw new ApifyQuotaError(reservation.rejection)
    }
    applied.push({ key: reservation.key, points: reservation.points, config: reservation.config })
  }

  const holderId = randomUUID()
  const concurrencyConfig: RateLimitLeaseConfig = {
    limit: input.config.maxConcurrencyPerTenant,
    ttlMs: leaseSeconds * 1000,
    keyPrefix: 'apify:tenant:concurrency',
  }
  let concurrencyLease: RateLimitLeaseResult
  try {
    concurrencyLease = await settleWithin(
      limiter.acquireLease(input.tenantId, holderId, concurrencyConfig),
      operationTimeoutMs,
      async (lateLease) => {
        if (lateLease.allowed) await limiter.releaseLease(input.tenantId, holderId, concurrencyConfig)
      },
    )
  } catch {
    concurrencyLease = { allowed: false, degraded: true }
  }
  if (!concurrencyLease.allowed || concurrencyLease.degraded) {
    releaseProcessSlot()
    await boundedRollback(limiter, applied, operationTimeoutMs)
    throw new ApifyQuotaError('concurrency_limited')
  }

  let released = false
  return {
    async release(options) {
      if (released) return
      released = true
      releaseProcessSlot()
      if (options?.retainDistributed) return
      await limiter.releaseLease(input.tenantId, holderId, concurrencyConfig)
    },
  }
}

export function resetApifyProcessQuotaForTests(): void {
  processActiveRuns = 0
}
