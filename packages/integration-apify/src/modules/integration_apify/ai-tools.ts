import { z } from 'zod'
import { defineAiTool } from '@open-mercato/ai-assistant/modules/ai_assistant/lib/ai-tool-definition'
import { APIFY_RESEARCH_FEATURE } from './acl'
import { ACTOR_CATALOG } from './lib/actor-catalog'
import { executeApifyActor } from './lib/execute-actor'
import { normalizeFacebookPage, type FacebookPageData } from './lib/normalizers/facebook-page'
import { normalizeGoogleMapsPlace, type GoogleMapsPlaceData } from './lib/normalizers/google-maps-place'
import { normalizeGoogleMapsReviews, type GoogleMapsReviewsData } from './lib/normalizers/google-maps-reviews'
import { normalizeInstagramProfile, type InstagramProfileData } from './lib/normalizers/instagram-profile'
import { errorResult, type ApifyResearchResult } from './lib/result'
import { normalizeFacebookTarget, normalizeGoogleMapsTarget, normalizeInstagramTarget } from './lib/targets'

export const APIFY_INSTAGRAM_TOOL_ID = 'integration_apify.scrape_instagram_profile'
export const APIFY_FACEBOOK_TOOL_ID = 'integration_apify.scrape_facebook_page'
export const APIFY_MAPS_PLACE_TOOL_ID = 'integration_apify.scrape_google_maps_place'
export const APIFY_MAPS_REVIEWS_TOOL_ID = 'integration_apify.scrape_google_maps_reviews'

const instagramInputSchema = z.object({
  profileUrlOrUsername: z.string().trim().min(1).max(2_048),
})

const facebookInputSchema = z.object({
  pageUrl: z.string().trim().min(1).max(2_048),
})

const mapsPlaceInputSchema = z.object({
  placeUrl: z.string().trim().min(1).max(2_048).optional(),
  placeId: z.string().trim().min(1).max(200).optional(),
})

const mapsReviewsInputSchema = mapsPlaceInputSchema.extend({
  maxReviews: z.number().int().optional(),
  sort: z.enum(['most_relevant', 'newest']).optional(),
})

function invalidTarget<T>(
  platform: ApifyResearchResult<T>['platform'],
  sourceUrl: string | null,
): ApifyResearchResult<T> {
  return errorResult({
    platform,
    sourceUrl,
    code: 'invalid_target',
    message: 'The target is not a supported public profile, Page, or place.',
  })
}

export const instagramProfileTool = defineAiTool<
  z.infer<typeof instagramInputSchema>,
  ApifyResearchResult<InstagramProfileData>
>({
  name: APIFY_INSTAGRAM_TOOL_ID,
  displayName: 'Research Instagram profile',
  description: 'Read one public Instagram business or creator profile with bounded cost. Personal and private profiles are rejected.',
  inputSchema: instagramInputSchema,
  requiredFeatures: [APIFY_RESEARCH_FEATURE],
  isMutation: false,
  tags: ['read', 'research', 'instagram', 'apify'],
  async handler(rawInput, ctx) {
    const input = instagramInputSchema.parse(rawInput)
    let target
    try {
      target = normalizeInstagramTarget(input.profileUrlOrUsername)
    } catch {
      return invalidTarget('instagram', input.profileUrlOrUsername)
    }
    return executeApifyActor({
      ctx,
      entry: ACTOR_CATALOG.instagram_profile,
      target: { username: target.username },
      platform: 'instagram',
      canonicalUrl: target.canonicalUrl,
      sourceUrl: target.canonicalUrl,
      normalize: ({ items, actorRunId, sourceUrl }) => normalizeInstagramProfile({
        items,
        actorRunId,
        sourceUrl,
        expectedUsername: target.username,
      }),
    })
  },
})

export const facebookPageTool = defineAiTool<
  z.infer<typeof facebookInputSchema>,
  ApifyResearchResult<FacebookPageData>
>({
  name: APIFY_FACEBOOK_TOOL_ID,
  displayName: 'Research Facebook Page',
  description: 'Read one public Facebook business Page with bounded cost. Profiles, groups, posts, and events are rejected.',
  inputSchema: facebookInputSchema,
  requiredFeatures: [APIFY_RESEARCH_FEATURE],
  isMutation: false,
  tags: ['read', 'research', 'facebook', 'apify'],
  async handler(rawInput, ctx) {
    const input = facebookInputSchema.parse(rawInput)
    let target
    try {
      target = normalizeFacebookTarget(input.pageUrl)
    } catch {
      return invalidTarget('facebook', input.pageUrl)
    }
    return executeApifyActor({
      ctx,
      entry: ACTOR_CATALOG.facebook_page,
      target: { pageUrl: target.pageUrl },
      platform: 'facebook',
      canonicalUrl: target.canonicalUrl,
      sourceUrl: target.canonicalUrl,
      normalize: normalizeFacebookPage,
    })
  },
})

export const googleMapsPlaceTool = defineAiTool<
  z.infer<typeof mapsPlaceInputSchema>,
  ApifyResearchResult<GoogleMapsPlaceData>
>({
  name: APIFY_MAPS_PLACE_TOOL_ID,
  displayName: 'Research Google Maps place',
  description: 'Read one concrete public Google Maps place by URL or Place ID with bounded cost. Text and area searches are rejected.',
  inputSchema: mapsPlaceInputSchema,
  requiredFeatures: [APIFY_RESEARCH_FEATURE],
  isMutation: false,
  tags: ['read', 'research', 'google_maps', 'apify'],
  async handler(rawInput, ctx) {
    const input = mapsPlaceInputSchema.parse(rawInput)
    let target
    try {
      target = normalizeGoogleMapsTarget(input)
    } catch {
      return invalidTarget('google_maps', input.placeUrl ?? null)
    }
    return executeApifyActor({
      ctx,
      entry: ACTOR_CATALOG.google_maps_place,
      target: target.placeId ? { placeId: target.placeId } : { placeUrl: target.placeUrl },
      platform: 'google_maps',
      canonicalUrl: target.canonicalUrl,
      sourceUrl: target.canonicalUrl,
      normalize: normalizeGoogleMapsPlace,
    })
  },
})

export const googleMapsReviewsTool = defineAiTool<
  z.infer<typeof mapsReviewsInputSchema>,
  ApifyResearchResult<GoogleMapsReviewsData>
>({
  name: APIFY_MAPS_REVIEWS_TOOL_ID,
  displayName: 'Research Google Maps reviews',
  description: 'Read a bounded sample of public Google Maps reviews without reviewer identity or personal-data enrichment.',
  inputSchema: mapsReviewsInputSchema,
  requiredFeatures: [APIFY_RESEARCH_FEATURE],
  isMutation: false,
  tags: ['read', 'research', 'google_maps', 'reviews', 'apify'],
  async handler(rawInput, ctx) {
    const input = mapsReviewsInputSchema.parse(rawInput)
    let target
    try {
      target = normalizeGoogleMapsTarget(input)
    } catch {
      return invalidTarget('google_maps', input.placeUrl ?? null)
    }
    return executeApifyActor({
      ctx,
      entry: ACTOR_CATALOG.google_maps_reviews,
      target: {
        ...(target.placeId ? { placeId: target.placeId } : { placeUrl: target.placeUrl }),
        maxReviews: input.maxReviews,
        sort: input.sort,
      },
      platform: 'google_maps',
      canonicalUrl: target.canonicalUrl,
      sourceUrl: target.canonicalUrl,
      normalize: normalizeGoogleMapsReviews,
    })
  },
})

export const aiTools = [
  instagramProfileTool,
  facebookPageTool,
  googleMapsPlaceTool,
  googleMapsReviewsTool,
]

export default aiTools
