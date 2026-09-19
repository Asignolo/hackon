import {
  createApifyHealthCheck,
  resolveApifyInputSchemaHash,
  resolveApifyPricingFingerprint,
} from '../lib/health'
import { ACTOR_CATALOG_ENTRIES } from '../lib/actor-catalog'

const scope = { tenantId: 'tenant-a', organizationId: 'org-a', userId: null }

describe('Apify health check', () => {
  it('hashes the input schema shape returned by the Apify build API', () => {
    expect(resolveApifyInputSchemaHash({
      actorDefinition: {
        input: {
          schemaVersion: 1,
          title: 'Input schema',
          type: 'object',
          properties: { startUrls: { type: 'array' } },
        },
      },
    })).toBe('9b42f6742f951270bf59e37712277be8e22e2459530e98bee4770068aa65c267')
  })

  it('fingerprints the active pricing model and every event-pricing tier', () => {
    expect(resolveApifyPricingFingerprint({
      pricingInfos: [{
        pricingModel: 'PAY_PER_EVENT',
        startedAt: new Date('2026-01-01T00:00:00.000Z'),
        minimalMaxTotalChargeUsd: 0.5,
        pricingPerEvent: {
          actorChargeEvents: {
            result: {
              eventTieredPricingUsd: {
                FREE: { tieredEventPriceUsd: 0.004 },
                BUSINESS: { tieredEventPriceUsd: 0.003 },
              },
            },
            start: { eventPriceUsd: 0.001 },
          },
        },
      }],
    }, Date.parse('2026-09-19T00:00:00.000Z'))).toBe(
      '56526d3e1921d59a0c5428b6d961a7d5386f95c9cba7a1fdac98d626a0b39703',
    )
  })

  it('detects a price change outside the Free tier', () => {
    const pricing = (businessPrice: number) => ({
      pricingInfos: [{
        pricingModel: 'PAY_PER_EVENT',
        startedAt: new Date('2026-01-01T00:00:00.000Z'),
        minimalMaxTotalChargeUsd: 0.5,
        pricingPerEvent: {
          actorChargeEvents: {
            result: {
              eventTieredPricingUsd: {
                FREE: { tieredEventPriceUsd: 0.004 },
                BUSINESS: { tieredEventPriceUsd: businessPrice },
              },
            },
          },
        },
      }],
    })
    const now = Date.parse('2026-09-19T00:00:00.000Z')
    expect(resolveApifyPricingFingerprint(pricing(0.003), now))
      .not.toBe(resolveApifyPricingFingerprint(pricing(0.002), now))
  })

  it('validates credentials through the authenticated user endpoint', async () => {
    const get = jest.fn(async () => ({ id: 'user' }))
    const health = createApifyHealthCheck(() => ({
      user: () => ({ get }),
      actor: (actorId: string) => ({
        get: async () => {
          const entry = ACTOR_CATALOG_ENTRIES.find((candidate) => candidate.actorId === actorId)
          return entry ? { pricingFingerprint: entry.pricingFingerprint } : undefined
        },
      }),
      build: (buildId: string) => ({
        get: async () => {
          const entry = ACTOR_CATALOG_ENTRIES.find((candidate) => candidate.buildId === buildId)
          return entry ? { buildNumber: entry.build, inputSchemaHash: entry.inputSchemaHash } : undefined
        },
      }),
    }) as never)
    await expect(health.check({ apiToken: 'token' }, scope)).resolves.toMatchObject({
      status: 'healthy',
      details: { reason: 'healthy' },
    })
    expect(get).toHaveBeenCalledTimes(1)
  })

  it('maps authentication failures without exposing upstream details', async () => {
    const health = createApifyHealthCheck(() => ({
      user: () => ({
        get: async () => {
          throw Object.assign(new Error('token=secret-token'), { statusCode: 401 })
        },
      }),
      actor: () => ({ get: async () => ({ id: 'actor' }) }),
      build: () => ({ get: async () => ({}) }),
    }) as never)
    const result = await health.check({ apiToken: 'secret-token' }, scope)
    expect(result).toMatchObject({
      status: 'unhealthy',
      details: { reason: 'invalid_credentials' },
    })
    expect(JSON.stringify(result)).not.toContain('secret-token')
  })

  it('bounds a health probe at ten seconds', async () => {
    jest.useFakeTimers()
    try {
      const health = createApifyHealthCheck(() => ({
        user: () => ({ get: () => new Promise<never>(() => undefined) }),
        actor: () => ({
          get: () => new Promise<never>(() => undefined),
          builds: () => ({ list: async () => ({ items: [] }) }),
          start: async () => ({ id: 'run', status: 'READY' }),
        }),
        build: () => ({ get: () => new Promise<never>(() => undefined) }),
      }) as never)
      const pending = health.check({ apiToken: 'token' }, scope)
      await jest.advanceTimersByTimeAsync(10_000)
      await expect(pending).resolves.toMatchObject({
        status: 'unhealthy',
        details: { reason: 'upstream_unavailable' },
      })
    } finally {
      jest.useRealTimers()
    }
  })

  it('fails closed when a pinned input schema drifts', async () => {
    const health = createApifyHealthCheck(() => ({
      user: () => ({ get: async () => ({ id: 'user' }) }),
      actor: () => ({ get: async () => ({ id: 'actor' }) }),
      build: (buildId: string) => ({
        get: async () => {
          const entry = ACTOR_CATALOG_ENTRIES.find((candidate) => candidate.buildId === buildId)
          return entry ? { buildNumber: entry.build, inputSchemaHash: 'changed' } : undefined
        },
      }),
    }) as never)
    await expect(health.check({ apiToken: 'token' }, scope)).resolves.toMatchObject({
      status: 'unhealthy',
      details: { reason: 'schema_mismatch' },
    })
  })

  it('fails closed when the pinned build number is missing', async () => {
    const health = createApifyHealthCheck(() => ({
      user: () => ({ get: async () => ({ id: 'user' }) }),
      actor: (actorId: string) => ({
        get: async () => {
          const entry = ACTOR_CATALOG_ENTRIES.find((candidate) => candidate.actorId === actorId)
          return entry ? { pricingFingerprint: entry.pricingFingerprint } : undefined
        },
      }),
      build: (buildId: string) => ({
        get: async () => {
          const entry = ACTOR_CATALOG_ENTRIES.find((candidate) => candidate.buildId === buildId)
          return entry ? { inputSchemaHash: entry.inputSchemaHash } : undefined
        },
      }),
    }) as never)
    await expect(health.check({ apiToken: 'token' }, scope)).resolves.toMatchObject({
      status: 'unhealthy',
      details: { reason: 'catalog_unavailable' },
    })
  })

  it('fails closed when an Actor pricing model drifts', async () => {
    const health = createApifyHealthCheck(() => ({
      user: () => ({ get: async () => ({ id: 'user' }) }),
      actor: () => ({ get: async () => ({ pricingFingerprint: 'changed' }) }),
      build: (buildId: string) => ({
        get: async () => {
          const entry = ACTOR_CATALOG_ENTRIES.find((candidate) => candidate.buildId === buildId)
          return entry ? { buildNumber: entry.build, inputSchemaHash: entry.inputSchemaHash } : undefined
        },
      }),
    }) as never)
    await expect(health.check({ apiToken: 'token' }, scope)).resolves.toMatchObject({
      status: 'unhealthy',
      details: { reason: 'schema_mismatch' },
    })
  })
})
