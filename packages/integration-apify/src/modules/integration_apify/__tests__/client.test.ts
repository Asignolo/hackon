import {
  applyApifyReadResponseLimit,
  createApifyHealthClient,
  createApifyReadClient,
  MAX_APIFY_READ_RESPONSE_BYTES,
} from '../lib/client'

describe('Apify client bounds', () => {
  it('caps read responses at the HTTP client boundary before JSON parsing', () => {
    const config = applyApifyReadResponseLimit({ maxContentLength: -1 })
    expect(config.maxContentLength).toBe(MAX_APIFY_READ_RESPONSE_BYTES)

    const client = createApifyReadClient({ apiToken: 'token' }) as unknown as {
      httpClient: { userProvidedRequestInterceptors: Array<(value: { maxContentLength?: number }) => unknown> }
    }
    expect(client.httpClient.userProvidedRequestInterceptors).toContain(applyApifyReadResponseLimit)
  })

  it('keeps the complete health retry budget below its ten-second deadline', () => {
    const client = createApifyHealthClient({ apiToken: 'token' }) as unknown as {
      httpClient: { maxRetries: number; timeoutMillis: number }
    }
    expect(client.httpClient.maxRetries).toBe(1)
    expect(client.httpClient.timeoutMillis).toBe(3_000)
    expect((client.httpClient.maxRetries + 1) * client.httpClient.timeoutMillis).toBeLessThan(10_000)
  })
})
