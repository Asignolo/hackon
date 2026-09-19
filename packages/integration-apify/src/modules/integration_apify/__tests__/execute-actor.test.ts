import { ACTOR_CATALOG } from '../lib/actor-catalog'
import { executeApifyActor } from '../lib/execute-actor'
import type { ApifyClientLike } from '../lib/client'
import {
  registerTelemetryRuntime,
  resetTelemetryRuntime,
  type TelemetryRuntime,
} from '@open-mercato/shared/lib/telemetry/runtime'

function createLimiter() {
  const counts = new Map<string, number>()
  const leases = new Map<string, Set<string>>()
  const apply = async (key: string, points: number, config: { points: number; keyPrefix?: string }) => {
    const compound = `${config.keyPrefix}:${key}`
    const consumedPoints = (counts.get(compound) ?? 0) + points
    counts.set(compound, consumedPoints)
    return {
      allowed: consumedPoints <= config.points,
      consumedPoints,
      remainingPoints: Math.max(0, config.points - consumedPoints),
      msBeforeNext: 0,
    }
  }
  return {
    consume: (key: string, config: { points: number; keyPrefix?: string }) => apply(key, 1, config),
    penalty: (key: string, points: number, config: { points: number; keyPrefix?: string }) => apply(key, points, config),
    reward: async (key: string, points: number, config: { points: number; keyPrefix?: string }) => {
      const compound = `${config.keyPrefix}:${key}`
      const consumedPoints = Math.max(0, (counts.get(compound) ?? 0) - points)
      counts.set(compound, consumedPoints)
      return { allowed: true, consumedPoints, remainingPoints: config.points, msBeforeNext: 0 }
    },
    acquireLease: async (key: string, holderId: string, config: { limit: number; keyPrefix?: string }) => {
      const compound = `${config.keyPrefix}:${key}`
      const holders = leases.get(compound) ?? new Set<string>()
      if (holders.size >= config.limit) return { allowed: false }
      holders.add(holderId)
      leases.set(compound, holders)
      return { allowed: true }
    },
    releaseLease: async (key: string, holderId: string, config: { keyPrefix?: string }) => {
      leases.get(`${config.keyPrefix}:${key}`)?.delete(holderId)
    },
  }
}

function createContext(overrides: Record<string, unknown> = {}) {
  const credentialsResolve = jest.fn(async () => ({ apiToken: 'secret' }))
  const integrationLogWrite = jest.fn(async () => undefined)
  const registrations: Record<string, unknown> = {
    agentRunSessionStore: {
      resolveActiveRunContext: async () => ({
        runId: 'agent-run-a',
        tenantId: 'tenant-a',
        organizationId: 'org-a',
      }),
    },
    rateLimiterService: createLimiter(),
    integrationStateService: {
      resolveState: async () => ({
        isEnabled: true,
        lastHealthStatus: 'healthy',
        lastHealthCheckedAt: new Date(),
      }),
    },
    integrationCredentialsService: { resolve: credentialsResolve },
    integrationLogService: { write: integrationLogWrite },
    ...overrides,
  }
  return {
    ctx: {
      tenantId: 'tenant-a',
      organizationId: 'org-a',
      userId: 'user-a',
      sessionId: 'session-a',
      userFeatures: ['integration_apify.research'],
      isSuperAdmin: false,
      container: {
        hasRegistration: (key: string) => key in registrations,
        resolve: (key: string) => registrations[key],
      },
    } as never,
    credentialsResolve,
    integrationLogWrite,
  }
}

function createClients(options: { startError?: Error; cleanupError?: Error } = {}) {
  const start = jest.fn(async () => {
    if (options.startError) throw options.startError
    return { id: 'actor-run-a', status: 'READY' }
  })
  const abort = jest.fn(async () => ({
    id: 'actor-run-a',
    status: 'ABORTED',
    defaultDatasetId: 'dataset-a',
    defaultKeyValueStoreId: 'store-a',
    defaultRequestQueueId: 'queue-a',
  }))
  const deleteDataset = jest.fn(async () => {
    if (options.cleanupError) throw options.cleanupError
  })
  const mutationClient = {
    actor: () => ({ start }),
    run: () => ({ abort }),
    dataset: () => ({ delete: deleteDataset }),
    keyValueStore: () => ({ delete: async () => undefined }),
    requestQueue: () => ({ delete: async () => undefined }),
  } as unknown as ApifyClientLike
  const readClient = {
    run: () => ({
      get: async () => ({
        id: 'actor-run-a',
        status: 'SUCCEEDED',
        usageTotalUsd: 0.004,
        defaultDatasetId: 'dataset-a',
        defaultKeyValueStoreId: 'store-a',
        defaultRequestQueueId: 'queue-a',
      }),
    }),
    dataset: () => ({ listItems: async () => ({ items: [{ username: 'openmercato' }] }) }),
  } as unknown as ApifyClientLike
  return { mutationClient, readClient, start, abort, deleteDataset }
}

describe('executeApifyActor', () => {
  afterEach(resetTelemetryRuntime)

  it('resolves tenant-wide credentials after guards and starts one exactly pinned run', async () => {
    const { ctx, credentialsResolve, integrationLogWrite } = createContext()
    const clients = createClients()
    const result = await executeApifyActor({
      ctx,
      entry: ACTOR_CATALOG.instagram_profile,
      target: { username: 'openmercato' },
      platform: 'instagram',
      canonicalUrl: 'https://www.instagram.com/openmercato/',
      dependencies: {
        createMutationClient: () => clients.mutationClient,
        createReadClient: () => clients.readClient,
      },
      normalize: ({ actorRunId, sourceUrl }) => ({
        ok: true,
        status: 'complete',
        platform: 'instagram',
        canonicalUrl: sourceUrl,
        sourceUrl,
        observedAt: '2026-09-19T00:00:00.000Z',
        actorRunId,
        data: { username: 'openmercato' },
        unavailableFields: [],
        diagnostics: [],
      }),
    })
    expect(result).toMatchObject({ ok: true, actorRunId: 'actor-run-a' })
    expect(credentialsResolve).toHaveBeenCalledWith('integration_apify', {
      tenantId: 'tenant-a',
      organizationId: 'org-a',
      userId: null,
    })
    expect(clients.start).toHaveBeenCalledTimes(1)
    expect(clients.start).toHaveBeenCalledWith(
      { usernames: ['openmercato'], includeAboutSection: false },
      { build: '0.0.607', maxItems: 1, maxTotalChargeUsd: 0.25, timeout: 120 },
    )
    expect(clients.deleteDataset).toHaveBeenCalledTimes(1)
    expect(integrationLogWrite).toHaveBeenCalledWith(
      expect.objectContaining({
        code: 'integration_apify.call_completed',
        payload: expect.objectContaining({
          toolId: 'integration_apify.scrape_instagram_profile',
          callCount: 1,
          pricingModel: 'pay_per_event',
          reservedCostMilliUsd: 250,
          actualCostMilliUsd: 4,
          upstreamItemCount: 1,
          normalizedItemCount: 1,
        }),
      }),
      { tenantId: 'tenant-a', organizationId: 'org-a' },
    )
  })

  it('fails closed when an older AgentRun store override lacks scoped context resolution', async () => {
    const { ctx, credentialsResolve } = createContext({
      agentRunSessionStore: { resolveActiveRunId: async () => 'agent-run-a' },
    })
    const clients = createClients()
    const result = await executeApifyActor({
      ctx,
      entry: ACTOR_CATALOG.instagram_profile,
      target: { username: 'openmercato' },
      platform: 'instagram',
      dependencies: {
        createMutationClient: () => clients.mutationClient,
        createReadClient: () => clients.readClient,
      },
      normalize: () => { throw new Error('not reached') },
    })
    expect(result).toMatchObject({ ok: false, diagnostics: [{ code: 'run_context_missing' }] })
    expect(credentialsResolve).not.toHaveBeenCalled()
    expect(clients.start).not.toHaveBeenCalled()
  })

  it('fails before credentials or Apify when the AgentRun is missing', async () => {
    const { ctx, credentialsResolve } = createContext({
      agentRunSessionStore: { resolveActiveRunContext: async () => null },
    })
    const clients = createClients()
    const result = await executeApifyActor({
      ctx,
      entry: ACTOR_CATALOG.instagram_profile,
      target: { username: 'openmercato' },
      platform: 'instagram',
      dependencies: {
        createMutationClient: () => clients.mutationClient,
        createReadClient: () => clients.readClient,
      },
      normalize: () => { throw new Error('not reached') },
    })
    expect(result).toMatchObject({ ok: false, diagnostics: [{ code: 'run_context_missing' }] })
    expect(credentialsResolve).not.toHaveBeenCalled()
    expect(clients.start).not.toHaveBeenCalled()
  })

  it('rejects a session scope mismatch before quota, credentials, or Apify access', async () => {
    const consume = jest.fn()
    const { ctx, credentialsResolve } = createContext({
      agentRunSessionStore: {
        resolveActiveRunContext: async () => ({
          runId: 'agent-run-a',
          tenantId: 'tenant-b',
          organizationId: 'org-b',
        }),
      },
      rateLimiterService: { consume },
    })
    const clients = createClients()
    const result = await executeApifyActor({
      ctx,
      entry: ACTOR_CATALOG.instagram_profile,
      target: { username: 'openmercato' },
      platform: 'instagram',
      dependencies: {
        createMutationClient: () => clients.mutationClient,
        createReadClient: () => clients.readClient,
      },
      normalize: () => { throw new Error('not reached') },
    })
    expect(result).toMatchObject({ ok: false, diagnostics: [{ code: 'run_context_missing' }] })
    expect(consume).not.toHaveBeenCalled()
    expect(credentialsResolve).not.toHaveBeenCalled()
    expect(clients.start).not.toHaveBeenCalled()
  })

  it('rejects stale or unhealthy catalog verification before quota, credentials, or Apify access', async () => {
    const consume = jest.fn()
    const { ctx, credentialsResolve } = createContext({
      integrationStateService: {
        resolveState: async () => ({
          isEnabled: true,
          lastHealthStatus: 'unhealthy',
          lastHealthCheckedAt: new Date(),
        }),
      },
      rateLimiterService: { consume },
    })
    const clients = createClients()
    const result = await executeApifyActor({
      ctx,
      entry: ACTOR_CATALOG.instagram_profile,
      target: { username: 'openmercato' },
      platform: 'instagram',
      dependencies: {
        createMutationClient: () => clients.mutationClient,
        createReadClient: () => clients.readClient,
      },
      normalize: () => { throw new Error('not reached') },
    })
    expect(result).toMatchObject({ ok: false, diagnostics: [{ code: 'upstream_unavailable' }] })
    expect(consume).not.toHaveBeenCalled()
    expect(credentialsResolve).not.toHaveBeenCalled()
    expect(clients.start).not.toHaveBeenCalled()
  })

  it('never crosses tenant or organization credential scope', async () => {
    const credentialsResolve = jest.fn(async () => ({ apiToken: 'secret' }))
    const { ctx } = createContext({
      integrationCredentialsService: { resolve: credentialsResolve },
      agentRunSessionStore: {
        resolveActiveRunContext: async () => ({
          runId: 'agent-run-a',
          tenantId: 'tenant-b',
          organizationId: 'org-b',
        }),
      },
    })
    ctx.tenantId = 'tenant-b'
    ctx.organizationId = 'org-b'
    const clients = createClients()
    await executeApifyActor({
      ctx,
      entry: ACTOR_CATALOG.instagram_profile,
      target: { username: 'openmercato' },
      platform: 'instagram',
      dependencies: {
        createMutationClient: () => clients.mutationClient,
        createReadClient: () => clients.readClient,
      },
      normalize: ({ actorRunId }) => ({
        ok: true,
        status: 'complete',
        platform: 'instagram',
        canonicalUrl: null,
        sourceUrl: null,
        observedAt: '2026-09-19T00:00:00.000Z',
        actorRunId,
        data: { username: 'openmercato' },
        unavailableFields: [],
        diagnostics: [],
      }),
    })
    expect(credentialsResolve).toHaveBeenCalledTimes(1)
    expect(credentialsResolve).toHaveBeenCalledWith('integration_apify', {
      tenantId: 'tenant-b',
      organizationId: 'org-b',
      userId: null,
    })
  })

  it('never retries an ambiguous paid start', async () => {
    const reportError = jest.fn()
    registerTelemetryRuntime({
      canUseGlobalTracePropagation: () => false,
      captureTraceContext: () => ({}),
      continueTrace: (_carrier, _name, fn) => fn(),
      recordHttpDuration: () => undefined,
      reportError,
      shutdown: async () => undefined,
    } satisfies TelemetryRuntime)
    const limiter = createLimiter()
    const releaseLease = jest.fn(limiter.releaseLease)
    const { ctx } = createContext({ rateLimiterService: { ...limiter, releaseLease } })
    const clients = createClients({ startError: new Error('network timeout token=secret') })
    const result = await executeApifyActor({
      ctx,
      entry: ACTOR_CATALOG.instagram_profile,
      target: { username: 'openmercato' },
      platform: 'instagram',
      dependencies: {
        createMutationClient: () => clients.mutationClient,
        createReadClient: () => clients.readClient,
      },
      normalize: () => { throw new Error('not reached') },
    })
    expect(result).toMatchObject({ ok: false, diagnostics: [{ code: 'upstream_unavailable' }] })
    expect(JSON.stringify(result)).not.toContain('secret')
    expect(clients.start).toHaveBeenCalledTimes(1)
    expect(releaseLease).not.toHaveBeenCalled()
    expect(JSON.stringify(reportError.mock.calls)).not.toContain('secret')
    expect(reportError).toHaveBeenCalledWith(
      expect.objectContaining({ message: '[internal] Apify research failed with upstream_unavailable.' }),
      expect.objectContaining({ code: 'integration_apify.upstream_unavailable' }),
    )
  })

  it('does not dispatch a paid start after credential resolution consumes the deadline', async () => {
    let clock = 0
    const credentialsResolve = jest.fn(async () => {
      clock = 30_000
      return { apiToken: 'secret' }
    })
    const { ctx } = createContext({
      integrationStateService: {
        resolveState: async () => ({
          isEnabled: true,
          lastHealthStatus: 'healthy',
          lastHealthCheckedAt: new Date(0),
        }),
      },
      integrationCredentialsService: { resolve: credentialsResolve },
    })
    const clients = createClients()
    const result = await executeApifyActor({
      ctx,
      entry: ACTOR_CATALOG.instagram_profile,
      target: { username: 'openmercato' },
      platform: 'instagram',
      dependencies: {
        now: () => clock,
        env: { OM_INTEGRATION_APIFY_TIMEOUT_SECONDS: '30' },
        createMutationClient: () => clients.mutationClient,
        createReadClient: () => clients.readClient,
      },
      normalize: () => { throw new Error('not reached') },
    })
    expect(result).toMatchObject({ ok: false, diagnostics: [{ code: 'timeout' }] })
    expect(credentialsResolve).toHaveBeenCalledTimes(1)
    expect(clients.start).not.toHaveBeenCalled()
  })

  it('polls a run longer than the HTTP timeout in bounded long-poll intervals', async () => {
    const { ctx } = createContext()
    const clients = createClients()
    const get = jest.fn()
      .mockResolvedValueOnce({ id: 'actor-run-a', status: 'RUNNING' })
      .mockResolvedValueOnce({
        id: 'actor-run-a',
        status: 'SUCCEEDED',
        usageTotalUsd: 0.004,
        defaultDatasetId: 'dataset-a',
        defaultKeyValueStoreId: 'store-a',
        defaultRequestQueueId: 'queue-a',
      })
    clients.readClient.run = () => ({ get, abort: async () => ({ id: 'actor-run-a', status: 'ABORTED' }) })
    const result = await executeApifyActor({
      ctx,
      entry: ACTOR_CATALOG.instagram_profile,
      target: { username: 'openmercato' },
      platform: 'instagram',
      dependencies: {
        createMutationClient: () => clients.mutationClient,
        createReadClient: () => clients.readClient,
      },
      normalize: ({ actorRunId, sourceUrl }) => ({
        ok: true,
        status: 'complete',
        platform: 'instagram',
        canonicalUrl: sourceUrl,
        sourceUrl,
        observedAt: '2026-09-19T00:00:00.000Z',
        actorRunId,
        data: { username: 'openmercato' },
        unavailableFields: [],
        diagnostics: [],
      }),
    })
    expect(result.ok).toBe(true)
    expect(get).toHaveBeenCalledTimes(2)
    expect(get).toHaveBeenNthCalledWith(1, { waitForFinish: 8 })
    expect(get).toHaveBeenNthCalledWith(2, { waitForFinish: 8 })
  })

  it('fails closed when a catalog minimum exceeds the configured charge cap', async () => {
    const { ctx, credentialsResolve } = createContext()
    const clients = createClients()
    const result = await executeApifyActor({
      ctx,
      entry: ACTOR_CATALOG.google_maps_place,
      target: { placeId: 'ChIJ12345678901234567890123' },
      platform: 'google_maps',
      dependencies: {
        createMutationClient: () => clients.mutationClient,
        createReadClient: () => clients.readClient,
      },
      normalize: () => { throw new Error('not reached') },
    })
    expect(result).toMatchObject({ ok: false, diagnostics: [{ code: 'budget_exceeded' }] })
    expect(credentialsResolve).not.toHaveBeenCalled()
    expect(clients.start).not.toHaveBeenCalled()
  })

  it('aborts a known run before releasing its lease when polling is rate-limited', async () => {
    const order: string[] = []
    const limiter = createLimiter()
    const releaseLease = jest.fn(async () => { order.push('release') })
    const { ctx } = createContext({ rateLimiterService: { ...limiter, releaseLease } })
    const clients = createClients()
    const abort = jest.fn(async () => {
      order.push('abort')
      return { id: 'actor-run-a', status: 'ABORTED' }
    })
    clients.mutationClient.run = () => ({ abort, get: async () => undefined })
    clients.readClient.run = () => ({
      get: async () => { throw Object.assign(new Error('rate limited'), { statusCode: 429 }) },
      abort: async () => ({ id: 'actor-run-a', status: 'ABORTED' }),
    })
    const result = await executeApifyActor({
      ctx,
      entry: ACTOR_CATALOG.instagram_profile,
      target: { username: 'openmercato' },
      platform: 'instagram',
      dependencies: {
        createMutationClient: () => clients.mutationClient,
        createReadClient: () => clients.readClient,
      },
      normalize: () => { throw new Error('not reached') },
    })
    expect(result).toMatchObject({ ok: false, diagnostics: [{ code: 'upstream_rate_limited' }] })
    expect(abort).toHaveBeenCalledTimes(1)
    expect(order).toEqual(['abort', 'release'])
  })

  it('marks integration health unhealthy after Apify rejects credentials', async () => {
    const upsert = jest.fn(async () => undefined)
    const { ctx } = createContext({
      integrationStateService: {
        resolveState: async () => ({
          isEnabled: true,
          lastHealthStatus: 'healthy',
          lastHealthCheckedAt: new Date(),
        }),
        upsert,
      },
    })
    const clients = createClients()
    clients.readClient.run = () => ({
      get: async () => { throw Object.assign(new Error('unauthorized'), { statusCode: 401 }) },
      abort: async () => ({ id: 'actor-run-a', status: 'ABORTED' }),
    })
    const result = await executeApifyActor({
      ctx,
      entry: ACTOR_CATALOG.instagram_profile,
      target: { username: 'openmercato' },
      platform: 'instagram',
      dependencies: {
        createMutationClient: () => clients.mutationClient,
        createReadClient: () => clients.readClient,
      },
      normalize: () => { throw new Error('not reached') },
    })
    expect(result).toMatchObject({ ok: false, diagnostics: [{ code: 'upstream_unauthorized' }] })
    expect(upsert).toHaveBeenCalledWith('integration_apify', {
      lastHealthStatus: 'unhealthy',
      lastHealthCheckedAt: expect.any(Date),
      reauthRequired: true,
    }, { tenantId: 'tenant-a', organizationId: 'org-a', userId: null })
  })

  it('keeps the original failure and adds cleanup diagnostics after a failed post-start cleanup', async () => {
    const { ctx } = createContext()
    const clients = createClients({ cleanupError: new Error('cleanup failed') })
    clients.readClient.run = () => ({
      get: async () => { throw Object.assign(new Error('upstream unavailable'), { statusCode: 503 }) },
      abort: async () => ({ id: 'actor-run-a', status: 'ABORTED' }),
    })
    const result = await executeApifyActor({
      ctx,
      entry: ACTOR_CATALOG.instagram_profile,
      target: { username: 'openmercato' },
      platform: 'instagram',
      dependencies: {
        createMutationClient: () => clients.mutationClient,
        createReadClient: () => clients.readClient,
      },
      normalize: () => { throw new Error('not reached') },
    })
    expect(result).toMatchObject({ ok: false, status: 'error' })
    expect(result.diagnostics.map((entry) => entry.code)).toEqual(['upstream_unavailable', 'cleanup_failed'])
    expect(clients.abort).toHaveBeenCalledTimes(1)
  })

  it('preserves a successful business result when storage cleanup fails', async () => {
    const { ctx } = createContext()
    const clients = createClients({ cleanupError: new Error('cleanup failed') })
    const result = await executeApifyActor({
      ctx,
      entry: ACTOR_CATALOG.instagram_profile,
      target: { username: 'openmercato' },
      platform: 'instagram',
      dependencies: {
        createMutationClient: () => clients.mutationClient,
        createReadClient: () => clients.readClient,
      },
      normalize: ({ actorRunId }) => ({
        ok: true,
        status: 'complete',
        platform: 'instagram',
        canonicalUrl: null,
        sourceUrl: null,
        observedAt: '2026-09-19T00:00:00.000Z',
        actorRunId,
        data: { username: 'openmercato' },
        unavailableFields: [],
        diagnostics: [],
      }),
    })
    expect(result).toMatchObject({ ok: true, status: 'partial' })
    expect(result.diagnostics).toContainEqual(expect.objectContaining({ code: 'cleanup_failed' }))
  })

  it('re-enforces the result ceiling after adding a cleanup diagnostic', async () => {
    const { ctx } = createContext()
    const clients = createClients({ cleanupError: new Error('cleanup failed') })
    const result = await executeApifyActor({
      ctx,
      entry: ACTOR_CATALOG.instagram_profile,
      target: { username: 'openmercato' },
      platform: 'instagram',
      dependencies: {
        createMutationClient: () => clients.mutationClient,
        createReadClient: () => clients.readClient,
      },
      normalize: ({ actorRunId }) => {
        const normalized = {
          ok: true,
          status: 'complete' as const,
          platform: 'instagram' as const,
          canonicalUrl: null,
          sourceUrl: null,
          observedAt: '2026-09-19T00:00:00.000Z',
          actorRunId,
          data: { payload: '' },
          unavailableFields: [],
          diagnostics: [],
        }
        const overheadBytes = Buffer.byteLength(JSON.stringify(normalized), 'utf8')
        normalized.data.payload = 'x'.repeat((64 * 1024) - overheadBytes - 1)
        return normalized
      },
    })
    expect(Buffer.byteLength(JSON.stringify(result), 'utf8')).toBeLessThanOrEqual(64 * 1024)
    expect(result.diagnostics.map((entry) => entry.code)).toEqual(['cleanup_failed', 'output_truncated'])
  })

  it('bounds a hanging paid start by the configured deadline', async () => {
    jest.useFakeTimers({ now: new Date('2026-09-19T00:00:00.000Z') })
    try {
      const { ctx } = createContext()
      const clients = createClients()
      clients.mutationClient.actor = () => ({
        get: async () => ({}),
        builds: () => ({ list: async () => ({ items: [] }) }),
        start: () => new Promise<never>(() => undefined),
      })
      const pending = executeApifyActor({
        ctx,
        entry: ACTOR_CATALOG.instagram_profile,
        target: { username: 'openmercato' },
        platform: 'instagram',
        dependencies: {
          env: { OM_INTEGRATION_APIFY_TIMEOUT_SECONDS: '30' },
          createMutationClient: () => clients.mutationClient,
          createReadClient: () => clients.readClient,
        },
        normalize: () => { throw new Error('not reached') },
      })
      await jest.advanceTimersByTimeAsync(30_000)
      await expect(pending).resolves.toMatchObject({ ok: false, diagnostics: [{ code: 'timeout' }] })
    } finally {
      jest.useRealTimers()
    }
  })

  it('bounds a hanging poll and aborts the known run once', async () => {
    jest.useFakeTimers({ now: new Date('2026-09-19T00:00:00.000Z') })
    try {
      const { ctx } = createContext()
      const clients = createClients()
      clients.readClient.run = () => ({
        get: () => new Promise<never>(() => undefined),
        abort: async () => ({ id: 'actor-run-a', status: 'ABORTED' }),
      })
      const pending = executeApifyActor({
        ctx,
        entry: ACTOR_CATALOG.instagram_profile,
        target: { username: 'openmercato' },
        platform: 'instagram',
        dependencies: {
          env: { OM_INTEGRATION_APIFY_TIMEOUT_SECONDS: '30' },
          createMutationClient: () => clients.mutationClient,
          createReadClient: () => clients.readClient,
        },
        normalize: () => { throw new Error('not reached') },
      })
      await jest.advanceTimersByTimeAsync(30_000)
      await expect(pending).resolves.toMatchObject({ ok: false, diagnostics: [{ code: 'timeout' }] })
      expect(clients.abort).toHaveBeenCalledTimes(1)
    } finally {
      jest.useRealTimers()
    }
  })

  it('bounds a hanging dataset read by the configured deadline', async () => {
    jest.useFakeTimers({ now: new Date('2026-09-19T00:00:00.000Z') })
    try {
      const { ctx } = createContext()
      const clients = createClients()
      clients.readClient.dataset = () => ({
        listItems: () => new Promise<never>(() => undefined),
        delete: async () => undefined,
      })
      const pending = executeApifyActor({
        ctx,
        entry: ACTOR_CATALOG.instagram_profile,
        target: { username: 'openmercato' },
        platform: 'instagram',
        dependencies: {
          env: { OM_INTEGRATION_APIFY_TIMEOUT_SECONDS: '30' },
          createMutationClient: () => clients.mutationClient,
          createReadClient: () => clients.readClient,
        },
        normalize: () => { throw new Error('not reached') },
      })
      await jest.advanceTimersByTimeAsync(30_000)
      await expect(pending).resolves.toMatchObject({ ok: false, diagnostics: [{ code: 'timeout' }] })
    } finally {
      jest.useRealTimers()
    }
  })

  it('bounds hanging cleanup without discarding a successful result', async () => {
    jest.useFakeTimers({ now: new Date('2026-09-19T00:00:00.000Z') })
    try {
      const { ctx } = createContext()
      const clients = createClients()
      clients.mutationClient.dataset = () => ({
        listItems: async () => ({ items: [] }),
        delete: () => new Promise<never>(() => undefined),
      })
      const pending = executeApifyActor({
        ctx,
        entry: ACTOR_CATALOG.instagram_profile,
        target: { username: 'openmercato' },
        platform: 'instagram',
        dependencies: {
          env: { OM_INTEGRATION_APIFY_TIMEOUT_SECONDS: '30' },
          createMutationClient: () => clients.mutationClient,
          createReadClient: () => clients.readClient,
        },
        normalize: ({ actorRunId }) => ({
          ok: true,
          status: 'complete',
          platform: 'instagram',
          canonicalUrl: null,
          sourceUrl: null,
          observedAt: '2026-09-19T00:00:00.000Z',
          actorRunId,
          data: { username: 'openmercato' },
          unavailableFields: [],
          diagnostics: [],
        }),
      })
      await jest.advanceTimersByTimeAsync(30_000)
      const result = await pending
      expect(result).toMatchObject({ ok: true, status: 'partial' })
      expect(result.diagnostics).toContainEqual(expect.objectContaining({ code: 'cleanup_failed' }))
    } finally {
      jest.useRealTimers()
    }
  })
})
