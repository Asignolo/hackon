import { createApifyHealthCheck } from '../lib/health'
import { ACTOR_CATALOG_ENTRIES } from '../lib/actor-catalog'

const scope = { tenantId: 'tenant-a', organizationId: 'org-a', userId: null }

describe('Apify health check', () => {
  it('validates credentials through the authenticated user endpoint', async () => {
    const get = jest.fn(async () => ({ id: 'user' }))
    const health = createApifyHealthCheck(() => ({
      user: () => ({ get }),
      actor: () => ({ get: async () => ({ id: 'actor' }) }),
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

  it('fails closed when a pinned input schema drifts', async () => {
    const health = createApifyHealthCheck(() => ({
      user: () => ({ get: async () => ({ id: 'user' }) }),
      actor: () => ({ get: async () => ({ id: 'actor' }) }),
      build: () => ({ get: async () => ({ inputSchemaHash: 'changed' }) }),
    }) as never)
    await expect(health.check({ apiToken: 'token' }, scope)).resolves.toMatchObject({
      status: 'unhealthy',
      details: { reason: 'schema_mismatch' },
    })
  })
})
