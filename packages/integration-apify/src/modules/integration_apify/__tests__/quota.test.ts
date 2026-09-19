import { reserveApifyQuota, resetApifyProcessQuotaForTests } from '../lib/quota'
import { readApifyConfig } from '../lib/config'
import { RateLimiterService } from '@open-mercato/shared/lib/ratelimit/service'

type Counter = { consumed: number; points: number }

function createLimiter(options: { disabled?: boolean; rejectPrefix?: string; rejectLease?: boolean } = {}) {
  const counters = new Map<string, Counter>()
  const leases = new Map<string, Set<string>>()
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
    leases,
    consume: (key: string, config: { points: number; keyPrefix?: string }) => apply(key, 1, config),
    penalty: (key: string, points: number, config: { points: number; keyPrefix?: string }) => apply(key, points, config),
    reward: async (key: string, points: number, config: { points: number; keyPrefix?: string }) => {
      const compound = `${config.keyPrefix}:${key}`
      const current = counters.get(compound)
      if (current) current.consumed = Math.max(0, current.consumed - points)
      return { allowed: true, consumedPoints: current?.consumed ?? 0, remainingPoints: config.points, msBeforeNext: 0 }
    },
    acquireLease: async (key: string, holderId: string, config: { limit: number; keyPrefix?: string }) => {
      if (options.disabled) return { allowed: false, degraded: true }
      const compound = `${config.keyPrefix}:${key}`
      const holders = leases.get(compound) ?? new Set<string>()
      if (options.rejectLease || holders.size >= config.limit) return { allowed: false }
      holders.add(holderId)
      leases.set(compound, holders)
      return { allowed: true }
    },
    releaseLease: async (key: string, holderId: string, config: { keyPrefix?: string }) => {
      leases.get(`${config.keyPrefix}:${key}`)?.delete(holderId)
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
    expect(limiter.leases.get('apify:tenant:concurrency:tenant-a')?.size).toBe(1)
    await lease.release()
    expect(limiter.leases.get('apify:tenant:concurrency:tenant-a')?.size).toBe(0)
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
    const limiter = createLimiter({ rejectLease: true })
    await expect(reserveApifyQuota({
      container: containerFor(limiter),
      agentRunId: 'run-a',
      tenantId: 'tenant-a',
      reservedMilliUsd: 250,
      config: readApifyConfig({}),
    })).rejects.toMatchObject({ code: 'concurrency_limited' })
    expect(limiter.counters.get('apify:run:budget:run-a')?.consumed).toBe(0)
  })

  it('compensates rejected real-limiter reservations so later eligible work remains possible', async () => {
    const limiter = new RateLimiterService({
      enabled: true,
      strategy: 'memory',
      keyPrefix: 'apify-test',
      trustProxyDepth: 0,
    })
    const container = {
      hasRegistration: (key: string) => key === 'rateLimiterService',
      resolve: () => limiter,
    } as never
    const config = {
      ...readApifyConfig({}),
      maxConcurrency: 8,
      maxConcurrencyPerTenant: 1,
      runBudgetMilliUsd: 300,
    }
    const first = await reserveApifyQuota({
      container,
      agentRunId: 'run-a',
      tenantId: 'tenant-a',
      reservedMilliUsd: 250,
      config,
    })
    await expect(reserveApifyQuota({
      container,
      agentRunId: 'run-a',
      tenantId: 'tenant-a',
      reservedMilliUsd: 250,
      config,
    })).rejects.toMatchObject({ code: 'budget_exceeded' })
    await first.release()
    const cheaper = await reserveApifyQuota({
      container,
      agentRunId: 'run-a',
      tenantId: 'tenant-a',
      reservedMilliUsd: 50,
      config,
    })
    await cheaper.release()
    await limiter.destroy()
  })

  it('releases the process slot when a shared limiter operation hangs', async () => {
    const hangingLimiter = {
      ...createLimiter(),
      consume: () => new Promise<never>(() => undefined),
    }
    await expect(reserveApifyQuota({
      container: containerFor(hangingLimiter as never),
      agentRunId: 'run-hung',
      tenantId: 'tenant-a',
      reservedMilliUsd: 250,
      config: { ...readApifyConfig({}), maxConcurrency: 1 },
      operationTimeoutMs: 10,
    })).rejects.toMatchObject({ code: 'budget_exceeded' })

    const healthyLimiter = createLimiter()
    const lease = await reserveApifyQuota({
      container: containerFor(healthyLimiter),
      agentRunId: 'run-next',
      tenantId: 'tenant-a',
      reservedMilliUsd: 250,
      config: { ...readApifyConfig({}), maxConcurrency: 1 },
    })
    await lease.release()
  })

  it.each([
    ['allowed consume', 'consume', true],
    ['rejected consume', 'consume', false],
    ['rejected penalty', 'penalty', false],
  ] as const)('compensates a late %s result after the quota deadline', async (_label, delayedKind, allowed) => {
    let resolveOperation!: (result: {
      allowed: boolean
      consumedPoints: number
      remainingPoints: number
      msBeforeNext: number
    }) => void
    const delayed = new Promise<{
      allowed: boolean
      consumedPoints: number
      remainingPoints: number
      msBeforeNext: number
    }>((resolve) => { resolveOperation = resolve })
    const baseLimiter = createLimiter()
    const reward = jest.fn(baseLimiter.reward)
    const limiter = {
      ...baseLimiter,
      reward,
      consume: delayedKind === 'consume' ? () => delayed : baseLimiter.consume,
      penalty: delayedKind === 'penalty' ? () => delayed : baseLimiter.penalty,
    }
    const pending = reserveApifyQuota({
      container: containerFor(limiter as never),
      agentRunId: 'run-late',
      tenantId: 'tenant-a',
      reservedMilliUsd: 250,
      config: readApifyConfig({}),
      operationTimeoutMs: 10,
    })
    await expect(pending).rejects.toMatchObject({ code: 'budget_exceeded' })
    resolveOperation({
      allowed,
      consumedPoints: allowed ? 1 : 2,
      remainingPoints: 0,
      msBeforeNext: 100,
    })
    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(reward).toHaveBeenCalledWith(
      'run-late',
      delayedKind === 'consume' ? 1 : 250,
      expect.objectContaining({
        keyPrefix: delayedKind === 'consume' ? 'apify:run:calls' : 'apify:run:budget',
      }),
    )
  })

  it('retains the distributed lease until TTL when the upstream run is still nonterminal', async () => {
    const limiter = createLimiter()
    const config = { ...readApifyConfig({}), maxConcurrency: 1, maxConcurrencyPerTenant: 1 }
    const lease = await reserveApifyQuota({
      container: containerFor(limiter),
      agentRunId: 'run-a',
      tenantId: 'tenant-a',
      reservedMilliUsd: 250,
      config,
    })
    await lease.release({ retainDistributed: true })
    expect(limiter.leases.get('apify:tenant:concurrency:tenant-a')?.size).toBe(1)
    await expect(reserveApifyQuota({
      container: containerFor(limiter),
      agentRunId: 'run-b',
      tenantId: 'tenant-a',
      reservedMilliUsd: 250,
      config,
    })).rejects.toMatchObject({ code: 'concurrency_limited' })
  })
})
