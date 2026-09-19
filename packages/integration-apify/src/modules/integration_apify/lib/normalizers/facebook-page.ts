import { diagnostic } from '../diagnostics'
import type { ApifyResearchResult } from '../result'
import { completeResult, createNormalizerState, optionalBoolean, optionalNumber, optionalString } from './common'

export type FacebookPageData = {
  name: string | null
  category: string | null
  description: string | null
  followersCount: number | null
  likesCount: number | null
  rating: number | null
  ratingCount: number | null
  website: string | null
  businessEmail: string | null
  businessPhone: string | null
  address: string | null
  isVerified: boolean | null
}

export function normalizeFacebookPage(input: {
  items: Array<Record<string, unknown>>
  actorRunId: string
  sourceUrl: string | null
}): ApifyResearchResult<FacebookPageData> {
  const record = input.items[0]
  if (!record) {
    return {
      ok: false,
      status: 'no_data',
      platform: 'facebook',
      canonicalUrl: input.sourceUrl,
      sourceUrl: input.sourceUrl,
      observedAt: new Date().toISOString(),
      actorRunId: input.actorRunId,
      data: null,
      unavailableFields: [],
      diagnostics: [diagnostic('no_data', 'info', 'No public Facebook Page data was returned.')],
    }
  }
  const type = record.type ?? record.pageType
  if ((typeof type === 'string' && ['profile', 'group', 'event'].includes(type.toLowerCase())) || record.isPersonalProfile === true) {
    return {
      ok: false,
      status: 'error',
      platform: 'facebook',
      canonicalUrl: input.sourceUrl,
      sourceUrl: input.sourceUrl,
      observedAt: new Date().toISOString(),
      actorRunId: input.actorRunId,
      data: null,
      unavailableFields: [],
      diagnostics: [diagnostic('unsupported_public_scope', 'error', 'Only public Facebook Pages are supported.')],
    }
  }
  const state = createNormalizerState()
  return completeResult({
    platform: 'facebook',
    canonicalUrl: input.sourceUrl,
    sourceUrl: input.sourceUrl,
    actorRunId: input.actorRunId,
    state,
    data: {
      name: optionalString(record, ['title', 'name', 'pageName'], 'name', state, 500),
      category: optionalString(record, ['categoryName', 'category'], 'category', state, 500),
      description: optionalString(record, ['about', 'description'], 'description', state, 2_000),
      followersCount: optionalNumber(record, ['followers', 'followersCount'], 'followersCount', state),
      likesCount: optionalNumber(record, ['likes', 'likesCount'], 'likesCount', state),
      rating: optionalNumber(record, ['rating', 'overallRating'], 'rating', state),
      ratingCount: optionalNumber(record, ['ratingCount', 'ratingsCount'], 'ratingCount', state),
      website: optionalString(record, ['website'], 'website', state, 2_048),
      businessEmail: optionalString(record, ['email', 'businessEmail'], 'businessEmail', state, 320),
      businessPhone: optionalString(record, ['phone', 'businessPhone'], 'businessPhone', state, 100),
      address: optionalString(record, ['address'], 'address', state, 1_000),
      isVerified: optionalBoolean(record, ['verified', 'isVerified'], 'isVerified', state),
    },
  })
}
