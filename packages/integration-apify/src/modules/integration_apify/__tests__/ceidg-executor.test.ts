import { ceidgCompanyTool } from '../ai-tools'
import * as clientFactory from '../lib/client'
import type { ApifyClientLike } from '../lib/client'
import { resetTelemetryRuntime } from '@open-mercato/shared/lib/telemetry/runtime'

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


describe('CEIDG tool executor integration', () => {
  afterEach(() => { jest.restoreAllMocks(); resetTelemetryRuntime() })

  it('uses scoped credentials, pinned bounded input and cleanup through the real executor', async () => {
    const { ctx, credentialsResolve } = createContext()
    const clients = createClients()
    clients.readClient.dataset = () => ({
      listItems: async () => ({ items: [{ nip: '5260250274', companyName: 'Synthetic fixture' }] }),
      delete: async () => undefined,
    })
    jest.spyOn(clientFactory, 'createApifyMutationClient').mockReturnValue(clients.mutationClient)
    jest.spyOn(clientFactory, 'createApifyReadClient').mockReturnValue(clients.readClient)
    const result = await ceidgCompanyTool.handler({ nip: 'PL 526-025-02-74' }, ctx)
    expect(result).toMatchObject({ status: 'partial', platform: 'ceidg', data: { nip: '5260250274' } })
    expect(credentialsResolve).toHaveBeenCalledWith('integration_apify', {
      tenantId: 'tenant-a', organizationId: 'org-a', userId: null,
    })
    expect(clients.start).toHaveBeenCalledTimes(1)
    expect(clients.start).toHaveBeenCalledWith(
      { searchMode: 'nip', searchValues: ['5260250274'], maxResults: 1, sourceFilter: 'ALL', status: 'ALL' },
      { build: '3.0.7', maxItems: 1, maxTotalChargeUsd: 0.25, timeout: 120 },
    )
    expect(clients.deleteDataset).toHaveBeenCalledTimes(1)
  })

  it('refuses a mismatched agent run before credentials or egress', async () => {
    const { ctx, credentialsResolve } = createContext({ agentRunSessionStore: {
      resolveActiveRunContext: async () => ({ runId: 'foreign', tenantId: 'tenant-b', organizationId: 'org-a' }),
    } })
    expect(await ceidgCompanyTool.handler({ nip: '5260250274' }, ctx)).toMatchObject({
      status: 'error', diagnostics: [{ code: 'run_context_missing' }],
    })
    expect(credentialsResolve).not.toHaveBeenCalled()
  })
})
