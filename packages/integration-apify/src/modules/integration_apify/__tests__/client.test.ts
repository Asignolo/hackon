import {
  applyApifyReadResponseLimit,
  createApifyHealthClient,
  createApifyReadClient,
  MAX_APIFY_READ_RESPONSE_BYTES,
} from '../lib/client'

describe('Apify client bounds', () => {
  it('keeps the normal response limit for the lightweight health check', () => {
    const client = createApifyHealthClient({ apiToken: 'token' }) as unknown as {
      httpClient: { userProvidedRequestInterceptors: Array<(value: { maxContentLength?: number }) => unknown> }
    }
    const config = { maxContentLength: -1 }
    for (const interceptor of client.httpClient.userProvidedRequestInterceptors) interceptor(config)
    expect(config.maxContentLength).toBe(MAX_APIFY_READ_RESPONSE_BYTES)
    expect(applyApifyReadResponseLimit({ maxContentLength: -1 }).maxContentLength).toBe(256 * 1024)
  })

  it('caps read responses at the HTTP client boundary before JSON parsing', () => {
    const config = applyApifyReadResponseLimit({ maxContentLength: -1 })
    expect(config.maxContentLength).toBe(MAX_APIFY_READ_RESPONSE_BYTES)

    const client = createApifyReadClient({ apiToken: 'token' }) as unknown as {
      httpClient: { userProvidedRequestInterceptors: Array<(value: { maxContentLength?: number }) => unknown> }
    }
    expect(client.httpClient.userProvidedRequestInterceptors).toContain(applyApifyReadResponseLimit)
  })

  it('checks the token once without retries and with a three-second timeout', () => {
    const client = createApifyHealthClient({ apiToken: 'token' }) as unknown as {
      httpClient: { maxRetries: number; timeoutMillis: number }
    }
    expect(client.httpClient.maxRetries).toBe(0)
    expect(client.httpClient.timeoutMillis).toBe(3_000)
    expect((client.httpClient.maxRetries + 1) * client.httpClient.timeoutMillis).toBeLessThan(10_000)
  })
})
