import { diagnostic } from '../diagnostics'
import type { ApifyResearchResult } from '../result'
import {
  completeResult,
  createNormalizerState,
  optionalBoolean,
  optionalNumber,
  optionalString,
  optionalStringArray,
  type NormalizerState,
} from './common'

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

function isMatchingFacebookPage(record: Record<string, unknown>, sourceUrl: string | null): boolean {
  const categories = record.categories
  const confirmedPage = Array.isArray(categories)
    && categories.length > 0
    && categories.every((value) => typeof value === 'string' && value.trim() !== '')
  if (!confirmedPage || (record.personalProfile !== undefined && record.personalProfile !== null) || !sourceUrl) {
    return false
  }
  const returnedUrl = record.facebookUrl ?? record.pageUrl
  if (typeof returnedUrl !== 'string') return false
  try {
    const expectedUrl = new URL(sourceUrl)
    const returnedPageUrl = new URL(returnedUrl)
    const supportedHost = ['facebook.com', 'www.facebook.com', 'm.facebook.com']
      .includes(returnedPageUrl.hostname.toLowerCase())
    const expectedPath = expectedUrl.pathname.replace(/\/$/, '').toLowerCase()
    const returnedPath = returnedPageUrl.pathname.replace(/\/$/, '').toLowerCase()
    return supportedHost && expectedPath === returnedPath
  } catch {
    return false
  }
}

function facebookCategory(record: Record<string, unknown>, state: NormalizerState): string | null {
  const categories = optionalStringArray(record, ['categories'], 'category', state, 10)
  if (!categories || categories.length === 0) return null
  return categories.find((category) => category.toLowerCase() !== 'page') ?? categories[0]
}

function facebookWebsite(record: Record<string, unknown>, state: NormalizerState): string | null {
  const candidates: string[] = []
  let schemaChanged = false
  const website = record.website
  if (typeof website === 'string' && website.trim() !== '') candidates.push(website)
  else if (website !== undefined && website !== null && website !== '') {
    if (Array.isArray(website)) {
      for (const entry of website) {
        if (!entry || typeof entry !== 'object') {
          schemaChanged = true
          continue
        }
        const value = (entry as Record<string, unknown>).url ?? (entry as Record<string, unknown>).website
        if (typeof value === 'string' && value.trim() !== '') candidates.push(value)
        else schemaChanged = true
      }
    } else {
      schemaChanged = true
    }
  }
  const websites = record.websites
  if (Array.isArray(websites)) {
    for (const entry of websites) {
      if (typeof entry === 'string' && entry.trim() !== '') candidates.push(entry)
      else schemaChanged = true
    }
  } else if (websites !== undefined && websites !== null) {
    schemaChanged = true
  }
  const selected = candidates[0]
  if (!selected) {
    state.unavailableFields.push({ field: 'website', reason: schemaChanged ? 'schema_changed' : 'not_exposed' })
    if (schemaChanged) {
      state.diagnostics.push(diagnostic('schema_changed', 'warning', 'The upstream website changed shape.', true))
    }
    return null
  }
  if (selected.length > 2_048) {
    state.diagnostics.push(diagnostic('output_truncated', 'warning', 'The field website was truncated to its safe limit.', true))
  }
  return selected.slice(0, 2_048)
}

export function normalizeFacebookPage(input: {
  items: Array<Record<string, unknown>>
  actorRunId: string
  sourceUrl: string | null
}): ApifyResearchResult<FacebookPageData> {
  if (input.items.length === 0) {
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
  const record = input.items.find((item) => isMatchingFacebookPage(item, input.sourceUrl))
  if (!record) {
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
  const category = facebookCategory(record, state)
  const website = facebookWebsite(record, state)
  return completeResult({
    platform: 'facebook',
    canonicalUrl: input.sourceUrl,
    sourceUrl: input.sourceUrl,
    actorRunId: input.actorRunId,
    state,
    data: {
      name: optionalString(record, ['title', 'name', 'pageName'], 'name', state, 500),
      category,
      description: optionalString(record, ['intro', 'about', 'description'], 'description', state, 2_000),
      followersCount: optionalNumber(record, ['followers', 'followersCount'], 'followersCount', state),
      likesCount: optionalNumber(record, ['likes', 'likesCount'], 'likesCount', state),
      rating: optionalNumber(record, ['ratingOverall', 'rating', 'overallRating'], 'rating', state),
      ratingCount: optionalNumber(record, ['ratingCount', 'ratingsCount'], 'ratingCount', state),
      website,
      businessEmail: optionalString(record, ['email', 'businessEmail'], 'businessEmail', state, 320),
      businessPhone: optionalString(record, ['phone', 'businessPhone'], 'businessPhone', state, 100),
      address: optionalString(record, ['address'], 'address', state, 1_000),
      isVerified: optionalBoolean(record, ['verified', 'isVerified'], 'isVerified', state),
    },
  })
}
