import {
  aiTools,
  APIFY_CEIDG_TOOL_ID,
  APIFY_FACEBOOK_TOOL_ID,
  APIFY_INSTAGRAM_TOOL_ID,
  APIFY_MAPS_PLACE_TOOL_ID,
  APIFY_MAPS_REVIEWS_TOOL_ID,
  instagramProfileTool,
} from '../ai-tools'

describe('Apify AI tools', () => {
  it('exports five stable, read-only, default-off research tools', () => {
    expect(aiTools.map((tool) => tool.name)).toEqual([
      APIFY_INSTAGRAM_TOOL_ID,
      APIFY_FACEBOOK_TOOL_ID,
      APIFY_MAPS_PLACE_TOOL_ID,
      APIFY_MAPS_REVIEWS_TOOL_ID,
      APIFY_CEIDG_TOOL_ID,
    ])
    for (const tool of aiTools) {
      expect(tool.isMutation).toBe(false)
      expect(tool.requiredFeatures).toEqual(['integration_apify.research'])
      expect(tool.description).toMatch(/bounded|without reviewer identity/i)
    }
  })

  it('returns a safe diagnostic for a syntactically valid but unsupported target', async () => {
    const rejectedTarget = 'https://user:password@www.instagram.com/reel/123/?secret=private'
    const result = await instagramProfileTool.handler(
      { profileUrlOrUsername: rejectedTarget },
      {} as never,
    )
    expect(result).toMatchObject({
      ok: false,
      status: 'error',
      diagnostics: [{ code: 'invalid_target', retryable: false }],
      sourceUrl: null,
    })
    expect(JSON.stringify(result)).not.toContain('password')
    expect(JSON.stringify(result)).not.toContain('private')
  })
})
