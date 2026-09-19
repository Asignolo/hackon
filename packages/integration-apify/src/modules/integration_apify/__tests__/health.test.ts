import {
  createApifyHealthCheck,
  resolveApifyInputSchemaHash,
  resolveApifyPricingFingerprint,
} from '../lib/health'

const scope = { tenantId: 'tenant-a', organizationId: 'org-a', userId: null }

jest.mock('@open-mercato/shared/lib/i18n/server', () => ({
  resolveTranslations: async () => ({ translate: (_key: string, fallback: string) => fallback }),
}))

describe('Apify health check', () => {
  it('checks only the authenticated user and never fetches or starts actors', async () => {
    const get = jest.fn(async () => ({ id: 'user' }))
    const actor = jest.fn(() => { throw new Error('Actor access is forbidden in a health check') })
    const build = jest.fn(() => { throw new Error('Build access is forbidden in a health check') })
    const health = createApifyHealthCheck(() => ({ user: () => ({ get }), actor, build }))
    await expect(health.check({ apiToken: 'token' }, scope)).resolves.toMatchObject({
      status: 'healthy',
      message: 'Apify connection and API token are valid.',
      details: { reason: 'healthy' },
    })
    expect(get).toHaveBeenCalledTimes(1)
    expect(actor).not.toHaveBeenCalled()
    expect(build).not.toHaveBeenCalled()
  })

  it.each([null, {}, { apiToken: '  ' }])('rejects missing credentials without network access: %p', async (credentials) => {
    const createClient = jest.fn()
    const health = createApifyHealthCheck(createClient)
    await expect(health.check(credentials, scope)).resolves.toMatchObject({
      status: 'unhealthy', details: { reason: 'invalid_credentials' },
    })
    expect(createClient).not.toHaveBeenCalled()
  })

  it.each([401, 403, 429, 500])('sanitizes upstream failures with HTTP status %s', async (statusCode) => {
    const health = createApifyHealthCheck(() => ({
      user: () => ({ get: async () => {
        throw Object.assign(new Error('token=secret-token'), { statusCode })
      } }),
    }))
    const result = await health.check({ apiToken: 'secret-token' }, scope)
    expect(result).toMatchObject({
      status: 'unhealthy',
      details: { reason: statusCode === 401 || statusCode === 403 ? 'invalid_credentials' : 'upstream_unavailable' },
    })
    expect(JSON.stringify(result)).not.toContain('secret-token')
  })

  it.each([undefined, {}, { id: '' }])('does not report healthy for a missing user response: %p', async (user) => {
    const health = createApifyHealthCheck(() => ({ user: () => ({ get: async () => user }) }))
    await expect(health.check({ apiToken: 'token' }, scope)).resolves.toMatchObject({
      status: 'unhealthy', details: { reason: 'upstream_unavailable' },
    })
  })

  it('bounds a stalled health probe at ten seconds', async () => {
    jest.useFakeTimers()
    try {
      const health = createApifyHealthCheck(() => ({
        user: () => ({ get: () => new Promise<never>(() => undefined) }),
      }))
      const pending = health.check({ apiToken: 'token' }, scope)
      await jest.advanceTimersByTimeAsync(10_000)
      await expect(pending).resolves.toMatchObject({
        status: 'unhealthy', details: { reason: 'upstream_unavailable' },
      })
    } finally {
      jest.useRealTimers()
    }
  })

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

})
