export type ApifyToolKey =
  | 'instagram_profile'
  | 'facebook_page'
  | 'google_maps_place'
  | 'google_maps_reviews'

export type ActorTarget =
  | { username: string }
  | { pageUrl: string }
  | { placeUrl?: string; placeId?: string; maxReviews?: number; sort?: 'most_relevant' | 'newest' }

export type ActorCatalogEntry = {
  toolKey: ApifyToolKey
  actorId: string
  build: string
  buildId: string
  inputSchemaHash: string
  fixtureVersion: string
  pricingModel: 'pay_per_event'
  minimumChargeUsd: number
  maxItems: number
  buildInput(target: ActorTarget): Record<string, unknown>
}

function mapsSource(target: Extract<ActorTarget, { placeUrl?: string }>): Record<string, unknown> {
  if (target.placeId) return { placeIds: [target.placeId] }
  if (target.placeUrl) return { startUrls: [{ url: target.placeUrl }] }
  throw new Error('[internal] Missing Google Maps target.')
}

export const ACTOR_CATALOG: Record<ApifyToolKey, ActorCatalogEntry> = {
  instagram_profile: {
    toolKey: 'instagram_profile',
    actorId: 'apify/instagram-profile-scraper',
    build: '0.0.607',
    buildId: 'S0bQkm7WqVMx5PX3H',
    inputSchemaHash: '6bd6085ea56471545ba9948d6d2d2cb0f3072c9cde36c7b8cc2d2d6d8374129a',
    fixtureVersion: '2026-09-19',
    pricingModel: 'pay_per_event',
    minimumChargeUsd: 0.0026,
    maxItems: 1,
    buildInput(target) {
      if (!('username' in target)) throw new Error('[internal] Invalid Instagram target.')
      return { usernames: [target.username], includeAboutSection: false }
    },
  },
  facebook_page: {
    toolKey: 'facebook_page',
    actorId: 'apify/facebook-pages-scraper',
    build: '0.0.511',
    buildId: 'wThP2Dukpf1Lub166',
    inputSchemaHash: 'cc61fb8b58cefd7f4a8366a4f0e330eca62daa740a8b269199f32aebc55e772c',
    fixtureVersion: '2026-09-19',
    pricingModel: 'pay_per_event',
    minimumChargeUsd: 0.012,
    maxItems: 1,
    buildInput(target) {
      if (!('pageUrl' in target)) throw new Error('[internal] Invalid Facebook target.')
      return { startUrls: [{ url: target.pageUrl }] }
    },
  },
  google_maps_place: {
    toolKey: 'google_maps_place',
    actorId: 'compass/crawler-google-places',
    build: '0.14.757',
    buildId: '4FztoiuFSanGKdK8O',
    inputSchemaHash: 'a2845edc308675c27c66e69a0bd996722abe96c10ed29d2dc56f2d9630d73c4a',
    fixtureVersion: '2026-09-19',
    pricingModel: 'pay_per_event',
    minimumChargeUsd: 0.5,
    maxItems: 1,
    buildInput(target) {
      if ('username' in target || 'pageUrl' in target) throw new Error('[internal] Invalid Maps target.')
      return {
        ...mapsSource(target),
        maxCrawledPlacesPerSearch: 1,
        maxReviews: 0,
        reviewsOrigin: 'google',
        scrapeReviewsPersonalData: false,
        maxImages: 0,
        scrapeImageAuthors: false,
        maxQuestions: 0,
        scrapePlaceDetailPage: false,
        scrapeTableReservationProvider: false,
        scrapeOrderOnline: false,
        includeWebResults: false,
        scrapeDirectories: false,
        scrapeContacts: false,
        scrapeSocialMediaProfiles: {
          facebooks: false,
          instagrams: false,
          youtubes: false,
          tiktoks: false,
          twitters: false,
        },
        maximumLeadsEnrichmentRecords: 0,
        verifyLeadsEnrichmentEmails: false,
        enableCompetitorAnalysis: false,
      }
    },
  },
  google_maps_reviews: {
    toolKey: 'google_maps_reviews',
    actorId: 'compass/google-maps-reviews-scraper',
    build: '0.0.523',
    buildId: 'evonAc5iNs0oBFn0M',
    inputSchemaHash: '1df05731141a17584c8c730ae6cfa37edae762ef4218457a863058aa0769837d',
    fixtureVersion: '2026-09-19',
    pricingModel: 'pay_per_event',
    minimumChargeUsd: 0.0006,
    maxItems: 25,
    buildInput(target) {
      if ('username' in target || 'pageUrl' in target) throw new Error('[internal] Invalid Maps target.')
      return {
        ...mapsSource(target),
        maxReviews: Math.min(25, Math.max(1, target.maxReviews ?? 10)),
        reviewsSort: target.sort === 'most_relevant' ? 'mostRelevant' : 'newest',
        reviewsOrigin: 'google',
        personalData: false,
        language: 'en',
        reviewsFilterString: '',
      }
    },
  },
}

export const ACTOR_CATALOG_ENTRIES = Object.values(ACTOR_CATALOG)
