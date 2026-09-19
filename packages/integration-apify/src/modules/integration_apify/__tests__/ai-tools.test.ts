import {
  aiTools,
  APIFY_FACEBOOK_TOOL_ID,
  APIFY_INSTAGRAM_TOOL_ID,
  APIFY_MAPS_PLACE_TOOL_ID,
  APIFY_MAPS_REVIEWS_TOOL_ID,
  instagramProfileTool,
} from '../ai-tools'

describe('Apify AI tools', () => {
  it('exports four stable, read-only, default-off research tools', () => {
    expect(aiTools.map((tool) => tool.name)).toEqual([
      APIFY_INSTAGRAM_TOOL_ID,
      APIFY_FACEBOOK_TOOL_ID,
      APIFY_MAPS_PLACE_TOOL_ID,
      APIFY_MAPS_REVIEWS_TOOL_ID,
    ])
    for (const tool of aiTools) {
      expect(tool.isMutation).toBe(false)
      expect(tool.requiredFeatures).toEqual(['integration_apify.research'])
      expect(tool.description).toMatch(/bounded|without reviewer identity/i)
    }
  })

  it('returns a safe diagnostic for a syntactically valid but unsupported target', async () => {
    const result = await instagramProfileTool.handler(
      { profileUrlOrUsername: 'https://www.instagram.com/reel/123/' },
      {} as never,
    )
    expect(result).toMatchObject({
      ok: false,
      status: 'error',
      diagnostics: [{ code: 'invalid_target', retryable: false }],
    })
  })
})
