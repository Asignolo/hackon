import { reserveApifyQuota, resetApifyProcessQuotaForTests } from '../lib/quota'
import { readApifyConfig } from '../lib/config'

type Counter = { consumed: number; points: number }

function createLimiter(options: { disabled?: boolean; rejectPrefix?: string } = {}) {
  const counters = new Map<string, Counter>()
  const apply = async (key: string, points: number, config: { points: number; keyPrefix?: string }) => {
    if (options.disabled) {
      return { allowed: true, consumedPoints: 0, remainingPoints: config.points, msBeforeNext: 0 }
    }
    const compound = `${config.keyPrefix}:${key}`
    const previous = counters.get(compound)?.consumed ?? 0
    const consumed = previous + points
    counters.set(compound, { consumed, points: config.points })
    return {
      allowed: !options.rejectPrefix?.includes(config.keyPrefix ?? '') && consumed <= config.points,
      consumedPoints: consumed,
      remainingPoints: Math.max(0, config.points - consumed),
      msBeforeNext: 100,
    }
  }
  return {
    counters,
    consume: (key: string, config: { points: number; keyPrefix?: string }) => apply(key, 1, config),
    penalty: (key: string, points: number, config: { points: number; keyPrefix?: string }) => apply(key, points, config),
    reward: async (key: string, points: number, config: { points: number; keyPrefix?: string }) => {
      const compound = `${config.keyPrefix}:${key}`
      const current = counters.get(compound)
      if (current) current.consumed = Math.max(0, current.consumed - points)
      return { allowed: true, consumedPoints: current?.consumed ?? 0, remainingPoints: config.points, msBeforeNext: 0 }
    },
  }
}

function containerFor(limiter: ReturnType<typeof createLimiter>) {
  return {
    hasRegistration: (key: string) => key === 'rateLimiterService',
    resolve: () => limiter,
  } as never
}

describe('Apify quota reservation', () => {
  beforeEach(resetApifyProcessQuotaForTests)

  it('reserves calls, cost, and tenant concurrency before returning a lease', async () => {
    const limiter = createLimiter()
    const lease = await reserveApifyQuota({
      container: containerFor(limiter),
      agentRunId: 'run-a',
      tenantId: 'tenant-a',
      reservedMilliUsd: 250,
      config: readApifyConfig({}),
    })
    expect(limiter.counters.get('apify:run:calls:run-a')?.consumed).toBe(1)
    expect(limiter.counters.get('apify:run:budget:run-a')?.consumed).toBe(250)
    expect(limiter.counters.get('apify:tenant:concurrency:tenant-a')?.consumed).toBe(1)
    await lease.release()
    expect(limiter.counters.get('apify:tenant:concurrency:tenant-a')?.consumed).toBe(0)
    expect(limiter.counters.get('apify:run:budget:run-a')?.consumed).toBe(250)
  })

  it('fails closed when the shared limiter is disabled', async () => {
    await expect(reserveApifyQuota({
      container: containerFor(createLimiter({ disabled: true })),
      agentRunId: 'run-a',
      tenantId: 'tenant-a',
      reservedMilliUsd: 250,
      config: readApifyConfig({}),
    })).rejects.toMatchObject({ code: 'budget_exceeded' })
  })

  it('rolls back partial reservations when concurrency is rejected', async () => {
    const limiter = createLimiter({ rejectPrefix: 'apify:tenant:concurrency' })
    await expect(reserveApifyQuota({
      container: containerFor(limiter),
      agentRunId: 'run-a',
      tenantId: 'tenant-a',
      reservedMilliUsd: 250,
      config: readApifyConfig({}),
    })).rejects.toMatchObject({ code: 'concurrency_limited' })
    expect(limiter.counters.get('apify:run:budget:run-a')?.consumed).toBe(0)
  })
})
