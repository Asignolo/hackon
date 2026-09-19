import { diagnostic } from '../diagnostics'
import type { ApifyResearchResult } from '../result'
import { completeResult, createNormalizerState, optionalNumber, optionalString } from './common'

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
  const response = record.responseFromOwner
  const responseRecord = response && typeof response === 'object' ? response as Record<string, unknown> : record
  return {
    rating: optionalNumber(record, ['stars', 'rating'], `${prefix}.rating`, state),
    text: optionalString(record, ['text', 'reviewText'], `${prefix}.text`, state, 1_000),
    publishedAt: optionalString(record, ['publishedAtDate', 'publishedAt'], `${prefix}.publishedAt`, state, 100),
    ownerResponse: optionalString(responseRecord, ['text', 'ownerResponse'], `${prefix}.ownerResponse`, state, 500),
  }
}

export function normalizeGoogleMapsReviews(input: {
  items: Array<Record<string, unknown>>
  actorRunId: string
  sourceUrl: string | null
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
  const first = input.items[0]
  const nestedReviews = first.reviews
  const allReviewRecords = Array.isArray(nestedReviews)
    ? nestedReviews.filter((entry): entry is Record<string, unknown> => Boolean(entry) && typeof entry === 'object')
    : input.items
  const reviewRecords = allReviewRecords.slice(0, 25)
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
