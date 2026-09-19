import { diagnostic } from '../diagnostics'
import type { ApifyResearchResult } from '../result'
import { completeResult, createNormalizerState, optionalNumber, optionalString } from './common'
import { matchesGooglePlaceIdentity } from './google-maps-place'

export type GoogleMapsReview = {
  rating: number | null
  text: string | null
  publishedAt: string | null
  ownerResponse: string | null
}

export type GoogleMapsReviewsData = {
  placeId: string | null
  placeName: string | null
  rating: number | null
  reviewsCount: number | null
  sampleSize: number
  sampledReviews: GoogleMapsReview[]
}

function normalizeReview(record: Record<string, unknown>, index: number, state: ReturnType<typeof createNormalizerState>): GoogleMapsReview {
  const prefix = `sampledReviews.${index}`
  const currentResponse = record.responseFromOwnerText
  if (currentResponse !== undefined) {
    let ownerResponse: string | null = null
    if (typeof currentResponse === 'string') {
      if (currentResponse.length > 500) {
        state.diagnostics.push(diagnostic('output_truncated', 'warning', `The field ${prefix}.ownerResponse was truncated to its safe limit.`, true))
      }
      ownerResponse = currentResponse.slice(0, 500)
    } else if (currentResponse !== null) {
      state.unavailableFields.push({ field: `${prefix}.ownerResponse`, reason: 'schema_changed' })
      state.diagnostics.push(diagnostic('schema_changed', 'warning', 'The upstream owner response changed shape.', true))
    }
    return {
      rating: optionalNumber(record, ['stars', 'rating'], `${prefix}.rating`, state),
      text: optionalString(record, ['text', 'reviewText'], `${prefix}.text`, state, 1_000),
      publishedAt: optionalString(record, ['publishedAtDate', 'publishedAt'], `${prefix}.publishedAt`, state, 100),
      ownerResponse,
    }
  }
  const response = record.responseFromOwner
  const responseRecord = response && typeof response === 'object' ? response as Record<string, unknown> : null
  let ownerResponse: string | null
  if (response === undefined) {
    ownerResponse = optionalString(record, ['ownerResponse'], `${prefix}.ownerResponse`, state, 500)
  } else if (response === null) {
    ownerResponse = null
  } else if (responseRecord) {
    ownerResponse = optionalString(responseRecord, ['text'], `${prefix}.ownerResponse`, state, 500)
  } else {
    ownerResponse = null
    state.unavailableFields.push({ field: `${prefix}.ownerResponse`, reason: 'schema_changed' })
    state.diagnostics.push(diagnostic('schema_changed', 'warning', 'The upstream owner response changed shape.', true))
  }
  return {
    rating: optionalNumber(record, ['stars', 'rating'], `${prefix}.rating`, state),
    text: optionalString(record, ['text', 'reviewText'], `${prefix}.text`, state, 1_000),
    publishedAt: optionalString(record, ['publishedAtDate', 'publishedAt'], `${prefix}.publishedAt`, state, 100),
    ownerResponse,
  }
}

export function normalizeGoogleMapsReviews(input: {
  items: Array<Record<string, unknown>>
  actorRunId: string
  sourceUrl: string | null
  maxReviews?: number
  expectedPlaceId?: string
  expectedPlaceUrl?: string
}): ApifyResearchResult<GoogleMapsReviewsData> {
  if (input.items.length === 0) {
    return {
      ok: false,
      status: 'no_data',
      platform: 'google_maps',
      canonicalUrl: input.sourceUrl,
      sourceUrl: input.sourceUrl,
      observedAt: new Date().toISOString(),
      actorRunId: input.actorRunId,
      data: null,
      unavailableFields: [],
      diagnostics: [diagnostic('no_data', 'info', 'No Google Maps reviews were returned.')],
    }
  }
  const state = createNormalizerState()
  const matchingItems = input.items.filter((item) => matchesGooglePlaceIdentity(
    item,
    input.expectedPlaceId,
    input.expectedPlaceUrl,
  ))
  const first = matchingItems[0]
  if (!first) {
    return {
      ok: false,
      status: 'error',
      platform: 'google_maps',
      canonicalUrl: input.sourceUrl,
      sourceUrl: input.sourceUrl,
      observedAt: new Date().toISOString(),
      actorRunId: input.actorRunId,
      data: null,
      unavailableFields: [{ field: 'placeId', reason: 'schema_changed' }],
      diagnostics: [diagnostic('schema_changed', 'error', 'Google Maps review identity could not be verified.')],
    }
  }
  const nestedReviews = first.reviews
  if (nestedReviews !== undefined && !Array.isArray(nestedReviews)) {
    return {
      ok: false,
      status: 'error',
      platform: 'google_maps',
      canonicalUrl: input.sourceUrl,
      sourceUrl: input.sourceUrl,
      observedAt: new Date().toISOString(),
      actorRunId: input.actorRunId,
      data: null,
      unavailableFields: [{ field: 'sampledReviews', reason: 'schema_changed' }],
      diagnostics: [diagnostic('schema_changed', 'error', 'Google Maps reviews changed shape.')],
    }
  }
  const allReviewRecords = Array.isArray(nestedReviews)
    ? nestedReviews.filter((entry): entry is Record<string, unknown> => Boolean(entry) && typeof entry === 'object')
    : matchingItems
  const reviewRecords = allReviewRecords.slice(0, Math.min(25, Math.max(1, input.maxReviews ?? 25)))
  if (allReviewRecords.length > reviewRecords.length) {
    state.diagnostics.push(diagnostic('output_truncated', 'warning', 'The review sample was truncated to its safe limit.', true))
  }
  const sourceRecord = first
  return completeResult({
    platform: 'google_maps',
    canonicalUrl: input.sourceUrl,
    sourceUrl: input.sourceUrl,
    actorRunId: input.actorRunId,
    state,
    data: {
      placeId: optionalString(sourceRecord, ['placeId'], 'placeId', state, 200),
      placeName: optionalString(sourceRecord, ['title', 'placeName'], 'placeName', state, 500),
      rating: optionalNumber(sourceRecord, ['totalScore', 'rating'], 'rating', state),
      reviewsCount: optionalNumber(sourceRecord, ['reviewsCount'], 'reviewsCount', state),
      sampleSize: reviewRecords.length,
      sampledReviews: reviewRecords.map((record, index) => normalizeReview(record, index, state)),
    },
  })
}
