import type { AwilixContainer } from 'awilix'
import type { RateLimitConfig, RateLimitResult } from '@open-mercato/shared/lib/ratelimit/types'
import type { ApifyConfig } from './config'

type RateLimiterLike = {
  consume(key: string, config: RateLimitConfig): Promise<RateLimitResult>
  penalty(key: string, points: number, config: RateLimitConfig): Promise<RateLimitResult>
  reward(key: string, points: number, config: RateLimitConfig): Promise<RateLimitResult>
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
  release(): Promise<void>
}

let processActiveRuns = 0

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

export async function reserveApifyQuota(input: {
  container: AwilixContainer
  agentRunId: string
  tenantId: string
  reservedMilliUsd: number
  config: ApifyConfig
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
  const leaseSeconds = input.config.timeoutSeconds + 30
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
    {
      key: input.tenantId,
      points: 1,
      config: {
        points: input.config.maxConcurrencyPerTenant,
        duration: leaseSeconds,
        keyPrefix: 'apify:tenant:concurrency',
      },
      kind: 'consume',
      rejection: 'concurrency_limited',
    },
  ]

  const applied: AppliedReservation[] = []
  for (const reservation of reservations) {
    let result: RateLimitResult
    try {
      result = reservation.kind === 'consume'
        ? await limiter.consume(reservation.key, reservation.config)
        : await limiter.penalty(reservation.key, reservation.points, reservation.config)
    } catch {
      await rollback(limiter, applied)
      releaseProcessSlot()
      throw new ApifyQuotaError(reservation.rejection)
    }
    if (!isRealAllowed(result, reservation.config, reservation.kind)) {
      await rollback(limiter, applied)
      releaseProcessSlot()
      throw new ApifyQuotaError(reservation.rejection)
    }
    applied.push({ key: reservation.key, points: reservation.points, config: reservation.config })
  }

  let released = false
  const concurrencyReservation = applied.at(-1)
  return {
    async release() {
      if (released) return
      released = true
      releaseProcessSlot()
      if (concurrencyReservation) {
        await limiter.reward(
          concurrencyReservation.key,
          concurrencyReservation.points,
          concurrencyReservation.config,
        ).catch(() => undefined)
      }
    },
  }
}

export function resetApifyProcessQuotaForTests(): void {
  processActiveRuns = 0
}
