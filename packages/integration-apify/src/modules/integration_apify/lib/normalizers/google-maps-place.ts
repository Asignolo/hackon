import { diagnostic } from '../diagnostics'
import type { ApifyResearchResult } from '../result'
import {
  completeResult,
  createNormalizerState,
  optionalBoolean,
  optionalNumber,
  optionalString,
  optionalStringArray,
} from './common'

export type GoogleMapsPlaceData = {
  placeId: string | null
  name: string | null
  primaryCategory: string | null
  categories: string[] | null
  address: string | null
  phone: string | null
  website: string | null
  rating: number | null
  reviewsCount: number | null
  priceLevel: string | null
  temporarilyClosed: boolean | null
  permanentlyClosed: boolean | null
  coordinates: { latitude: number; longitude: number } | null
}

export function normalizeGoogleMapsPlace(input: {
  items: Array<Record<string, unknown>>
  actorRunId: string
  sourceUrl: string | null
}): ApifyResearchResult<GoogleMapsPlaceData> {
  const record = input.items[0]
  if (!record) {
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
      diagnostics: [diagnostic('no_data', 'info', 'No Google Maps place data was returned.')],
    }
  }
  const state = createNormalizerState()
  let coordinates: GoogleMapsPlaceData['coordinates'] = null
  const location = record.location
  if (location && typeof location === 'object') {
    const latitude = (location as Record<string, unknown>).lat ?? (location as Record<string, unknown>).latitude
    const longitude = (location as Record<string, unknown>).lng ?? (location as Record<string, unknown>).longitude
    if (typeof latitude === 'number' && typeof longitude === 'number') {
      coordinates = { latitude, longitude }
    } else {
      state.unavailableFields.push({ field: 'coordinates', reason: 'schema_changed' })
      state.diagnostics.push(diagnostic('schema_changed', 'warning', 'The upstream field coordinates changed shape.', true))
    }
  } else {
    state.unavailableFields.push({ field: 'coordinates', reason: 'not_exposed' })
  }
  return completeResult({
    platform: 'google_maps',
    canonicalUrl: input.sourceUrl,
    sourceUrl: input.sourceUrl,
    actorRunId: input.actorRunId,
    state,
    data: {
      placeId: optionalString(record, ['placeId'], 'placeId', state, 200),
      name: optionalString(record, ['title', 'name'], 'name', state, 500),
      primaryCategory: optionalString(record, ['categoryName', 'primaryCategory'], 'primaryCategory', state, 500),
      categories: optionalStringArray(record, ['categories'], 'categories', state, 20),
      address: optionalString(record, ['address'], 'address', state, 1_000),
      phone: optionalString(record, ['phone'], 'phone', state, 100),
      website: optionalString(record, ['website'], 'website', state, 2_048),
      rating: optionalNumber(record, ['totalScore', 'rating'], 'rating', state),
      reviewsCount: optionalNumber(record, ['reviewsCount'], 'reviewsCount', state),
      priceLevel: optionalString(record, ['price', 'priceLevel'], 'priceLevel', state, 100),
      temporarilyClosed: optionalBoolean(record, ['temporarilyClosed'], 'temporarilyClosed', state),
      permanentlyClosed: optionalBoolean(record, ['permanentlyClosed'], 'permanentlyClosed', state),
      coordinates,
    },
  })
}
