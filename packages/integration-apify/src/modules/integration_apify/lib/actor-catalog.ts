export type ApifyToolKey =
  | 'ceidg_company'
  | 'instagram_profile'
  | 'facebook_page'
  | 'google_maps_place'
  | 'google_maps_reviews'

export type ActorTarget =
  | { nip: string }
  | { username: string }
  | { pageUrl: string }
  | { placeUrl?: string; placeId?: string; maxReviews?: number; sort?: 'most_relevant' | 'newest' }

export type ActorCatalogEntry = {
  toolKey: ApifyToolKey
  actorId: string
  build: string
  buildId: string
  inputSchemaHash: string
  pricingFingerprint: string
  fixtureVersion: string
  pricingModel: 'pay_per_event'
  minimumChargeUsd: number
  maxItems: number
  datasetFields: string[]
  buildInput(target: ActorTarget): Record<string, unknown>
}

function mapsSource(target: Extract<ActorTarget, { placeUrl?: string }>): Record<string, unknown> {
  if (target.placeId) return { placeIds: [target.placeId] }
  if (target.placeUrl) return { startUrls: [{ url: target.placeUrl }] }
  throw new Error('[internal] Missing Google Maps target.')
}

export const ACTOR_CATALOG: Record<ApifyToolKey, ActorCatalogEntry> = {
  ceidg_company: {
    toolKey: 'ceidg_company',
    actorId: 'trev0n/ceidg-scraper',
    build: '3.0.7',
    buildId: 'anZ212YOOAAhYczdq',
    inputSchemaHash: 'a36d90fb42361204842146e7625d4756a4666723755bc13ccdacbdf0b6490a6c',
    pricingFingerprint: '5a5cfe20fd73cb3fedea6dedd4607c4203bd9e20c6b53470c493be5edc44f959',
    fixtureVersion: '2026-09-20',
    pricingModel: 'pay_per_event',
    minimumChargeUsd: 0.00305,
    maxItems: 1,
    datasetFields: ['companyName', 'nip', 'regon', 'krs', 'source', 'status', 'registerDate'],
    buildInput(target) {
      if (!('nip' in target)) throw new Error('[internal] Invalid CEIDG target.')
      return { searchMode: 'nip', searchValues: [target.nip], maxResults: 1, sourceFilter: 'ALL', status: 'ALL' }
    },
  },
  instagram_profile: {
    toolKey: 'instagram_profile',
    actorId: 'apify/instagram-profile-scraper',
    build: '0.0.607',
    buildId: 'S0bQkm7WqVMx5PX3H',
    inputSchemaHash: '6bd6085ea56471545ba9948d6d2d2cb0f3072c9cde36c7b8cc2d2d6d8374129a',
    pricingFingerprint: '55204d11016da9ad6ec0950dbae71f596c8416fd17f280b60fd44a8ae4292829',
    fixtureVersion: '2026-09-19',
    pricingModel: 'pay_per_event',
    minimumChargeUsd: 0.0026,
    maxItems: 1,
    datasetFields: [
      'username', 'fullName', 'displayName', 'biography', 'followersCount', 'followsCount', 'followingCount',
      'postsCount', 'verified', 'isVerified', 'private', 'isPrivate', 'isBusinessAccount',
      'businessCategoryName', 'businessCategory', 'externalUrl', 'external_url', 'error',
    ],
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
    pricingFingerprint: 'f3b81112c32e33aed05cad74584d2f31680ac5621a892dc80f79aa43969e12a3',
    fixtureVersion: '2026-09-19',
    pricingModel: 'pay_per_event',
    minimumChargeUsd: 0.012,
    maxItems: 1,
    datasetFields: [
      'facebookUrl', 'pageUrl', 'title', 'name', 'pageName', 'pageId', 'personalProfile', 'categories',
      'categoryName', 'category', 'intro', 'about', 'description', 'followers', 'followersCount', 'likes',
      'likesCount', 'ratingOverall', 'rating', 'overallRating', 'ratingCount', 'ratingsCount', 'website',
      'websites', 'email', 'businessEmail', 'phone', 'businessPhone', 'address', 'verified', 'isVerified',
    ],
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
    pricingFingerprint: '222548b1538488502de8ea7facfbc98fe08db1ac55033f4fb6881d001933db23',
    fixtureVersion: '2026-09-19',
    pricingModel: 'pay_per_event',
    minimumChargeUsd: 0.5,
    maxItems: 1,
    datasetFields: [
      'searchString', 'placeId', 'title', 'name', 'categoryName', 'primaryCategory', 'categories', 'address',
      'phone', 'website', 'totalScore', 'rating', 'reviewsCount', 'price', 'priceLevel', 'temporarilyClosed',
      'permanentlyClosed', 'location', 'url', 'placeUrl',
    ],
    buildInput(target) {
      if ('username' in target || 'pageUrl' in target || 'nip' in target) throw new Error('[internal] Invalid Maps target.')
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
    pricingFingerprint: 'cced939894855b2c09a7c50b6d2c69fb88db103192763eaab1c30ca29bd1519f',
    fixtureVersion: '2026-09-19',
    pricingModel: 'pay_per_event',
    minimumChargeUsd: 0.0006,
    maxItems: 25,
    datasetFields: [
      'searchString', 'placeId', 'title', 'placeName', 'totalScore', 'rating', 'reviewsCount', 'reviews',
      'stars', 'text', 'reviewText', 'publishedAtDate', 'publishedAt', 'responseFromOwnerText',
      'responseFromOwner', 'ownerResponse', 'url', 'placeUrl',
    ],
    buildInput(target) {
      if ('username' in target || 'pageUrl' in target || 'nip' in target) throw new Error('[internal] Invalid Maps target.')
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
