import { ACTOR_CATALOG } from '../lib/actor-catalog'
import { executeApifyActor } from '../lib/execute-actor'
import type { ApifyClientLike } from '../lib/client'

function createLimiter() {
  const counts = new Map<string, number>()
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
  }
}

function createContext(overrides: Record<string, unknown> = {}) {
  const credentialsResolve = jest.fn(async () => ({ apiToken: 'secret' }))
  const registrations: Record<string, unknown> = {
    agentRunSessionStore: { resolveActiveRunId: async () => 'agent-run-a' },
    rateLimiterService: createLimiter(),
    integrationStateService: { isEnabled: async () => true },
    integrationCredentialsService: { resolve: credentialsResolve },
    integrationLogService: { write: async () => undefined },
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
  }
}

function createClients(options: { startError?: Error; cleanupError?: Error } = {}) {
  const start = jest.fn(async () => {
    if (options.startError) throw options.startError
    return { id: 'actor-run-a', status: 'READY' }
  })
  const abort = jest.fn(async () => ({ id: 'actor-run-a', status: 'ABORTED' }))
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
  it('resolves tenant-wide credentials after guards and starts one exactly pinned run', async () => {
    const { ctx, credentialsResolve } = createContext()
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
  })

  it('fails before credentials or Apify when the AgentRun is missing', async () => {
    const { ctx, credentialsResolve } = createContext({
      agentRunSessionStore: { resolveActiveRunId: async () => null },
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

  it('never retries an ambiguous paid start', async () => {
    const { ctx } = createContext()
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
})
