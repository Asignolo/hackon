import { createApifyHealthCheck } from '../lib/health'

const scope = { tenantId: 'tenant-a', organizationId: 'org-a', userId: null }

describe('Apify health check', () => {
  it('validates credentials through the authenticated user endpoint', async () => {
    const get = jest.fn(async () => ({ id: 'user' }))
    const health = createApifyHealthCheck(() => ({ user: () => ({ get }) }) as never)
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
    }) as never)
    const result = await health.check({ apiToken: 'secret-token' }, scope)
    expect(result).toMatchObject({
      status: 'unhealthy',
      details: { reason: 'invalid_credentials' },
    })
    expect(JSON.stringify(result)).not.toContain('secret-token')
  })
})
