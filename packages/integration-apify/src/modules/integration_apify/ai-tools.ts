import { z } from 'zod'
import { defineAiTool } from '@open-mercato/ai-assistant/modules/ai_assistant/lib/ai-tool-definition'
import { APIFY_RESEARCH_FEATURE } from './acl'
import { ACTOR_CATALOG } from './lib/actor-catalog'
import { executeApifyActor } from './lib/execute-actor'
import { normalizeFacebookPage, type FacebookPageData } from './lib/normalizers/facebook-page'
import { normalizeGoogleMapsPlace, type GoogleMapsPlaceData } from './lib/normalizers/google-maps-place'
import { normalizeGoogleMapsReviews, type GoogleMapsReviewsData } from './lib/normalizers/google-maps-reviews'
import { normalizeInstagramProfile, type InstagramProfileData } from './lib/normalizers/instagram-profile'
import { normalizeCeidgCompany, type CeidgCompanyData } from './lib/normalizers/ceidg-company'
import { errorResult, type ApifyResearchResult } from './lib/result'
import { normalizeNipTarget, normalizeFacebookTarget, normalizeGoogleMapsTarget, normalizeInstagramTarget } from './lib/targets'

export const APIFY_CEIDG_TOOL_ID = 'integration_apify.scrape_ceidg_company'
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
): ApifyResearchResult<T> {
  return errorResult({
    platform,
    sourceUrl: null,
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
  description: 'Read one confirmed public Instagram business profile with bounded cost. Personal, unclassified, and private profiles are rejected.',
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
      return invalidTarget('instagram')
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
      return invalidTarget('facebook')
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
      return invalidTarget('google_maps')
    }
    return executeApifyActor({
      ctx,
      entry: ACTOR_CATALOG.google_maps_place,
      target: target.placeId ? { placeId: target.placeId } : { placeUrl: target.placeUrl },
      platform: 'google_maps',
      canonicalUrl: target.canonicalUrl,
      sourceUrl: target.canonicalUrl,
      normalize: (context) => normalizeGoogleMapsPlace({
        ...context,
        expectedPlaceId: target.placeId,
        expectedPlaceUrl: target.placeUrl,
      }),
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
      return invalidTarget('google_maps')
    }
    const maxReviews = Math.min(25, Math.max(1, input.maxReviews ?? 10))
    return executeApifyActor({
      ctx,
      entry: ACTOR_CATALOG.google_maps_reviews,
      target: {
        ...(target.placeId ? { placeId: target.placeId } : { placeUrl: target.placeUrl }),
        maxReviews,
        sort: input.sort,
      },
      platform: 'google_maps',
      canonicalUrl: target.canonicalUrl,
      sourceUrl: target.canonicalUrl,
      normalize: (context) => normalizeGoogleMapsReviews({
        ...context,
        maxReviews,
        expectedPlaceId: target.placeId,
        expectedPlaceUrl: target.placeUrl,
      }),
    })
  },
})

const ceidgInputSchema = z.object({ nip: z.string().trim().min(1).max(32) })

export const ceidgCompanyTool = defineAiTool<
  z.infer<typeof ceidgInputSchema>,
  ApifyResearchResult<CeidgCompanyData>
>({
  name: APIFY_CEIDG_TOOL_ID,
  displayName: 'Research company by NIP',
  description: 'Read one Polish company registry record by checksum-valid NIP with bounded cost. Requires an evidenced NIP; does not establish ownership.',
  inputSchema: ceidgInputSchema,
  requiredFeatures: [APIFY_RESEARCH_FEATURE],
  isMutation: false,
  tags: ['read', 'research', 'ceidg', 'apify'],
  async handler(rawInput, ctx) {
    const input = ceidgInputSchema.parse(rawInput)
    let target
    try {
      target = normalizeNipTarget(input.nip)
    } catch {
      return errorResult({ platform: 'ceidg', code: 'invalid_target', message: 'A valid Polish NIP is required.' })
    }
    return executeApifyActor({
      ctx,
      entry: ACTOR_CATALOG.ceidg_company,
      target,
      platform: 'ceidg',
      canonicalUrl: null,
      sourceUrl: null,
      normalize: (context) => normalizeCeidgCompany({ ...context, expectedNip: target.nip }),
    })
  },
})

export const aiTools = [
  instagramProfileTool,
  facebookPageTool,
  googleMapsPlaceTool,
  googleMapsReviewsTool,
  ceidgCompanyTool,
]

export default aiTools
