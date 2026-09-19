import { ACTOR_CATALOG, ACTOR_CATALOG_ENTRIES } from '../lib/actor-catalog'
import { readApifyConfig } from '../lib/config'
import { normalizeFacebookTarget, normalizeGoogleMapsTarget, normalizeInstagramTarget } from '../lib/targets'

describe('Apify runtime contracts', () => {
  it('clamps configuration to compiled ceilings and rejects malformed values', () => {
    expect(readApifyConfig({
      OM_INTEGRATION_APIFY_MAX_CHARGE_USD: '99',
      OM_INTEGRATION_APIFY_TIMEOUT_SECONDS: '999',
      OM_INTEGRATION_APIFY_MAX_ITEMS: '999',
      OM_INTEGRATION_APIFY_MAX_CONCURRENCY: '999',
      OM_INTEGRATION_APIFY_MAX_CALLS_PER_RUN: '999',
    })).toMatchObject({
      maxChargeUsd: 0.5,
      timeoutSeconds: 180,
      maxItems: 25,
      maxConcurrency: 8,
      maxCallsPerRun: 8,
    })
    expect(() => readApifyConfig({ OM_INTEGRATION_APIFY_MAX_ITEMS: '1.5' })).toThrow()
    expect(() => readApifyConfig({ OM_INTEGRATION_APIFY_MAX_CHARGE_USD: 'NaN' })).toThrow()
  })

  it('canonicalizes one public target and rejects high-risk target shapes', () => {
    expect(normalizeInstagramTarget('@openmercato')).toEqual({
      username: 'openmercato',
      canonicalUrl: 'https://www.instagram.com/openmercato/',
    })
    expect(normalizeFacebookTarget('https://facebook.com/openmercato?tracking=1')).toEqual({
      pageUrl: 'https://www.facebook.com/openmercato/',
      canonicalUrl: 'https://www.facebook.com/openmercato/',
    })
    expect(normalizeGoogleMapsTarget({ placeId: 'ChIJ12345678901234567890123' })).toEqual({
      placeId: 'ChIJ12345678901234567890123',
      canonicalUrl: 'https://www.google.com/maps/search/?api=1&query_place_id=ChIJ12345678901234567890123',
    })
    expect(normalizeGoogleMapsTarget({
      placeUrl: 'https://www.google.com/maps/search/?api=1&query_place_id=ChIJ12345678901234567890123',
    })).toEqual({
      placeId: 'ChIJ12345678901234567890123',
      canonicalUrl: 'https://www.google.com/maps/search/?api=1&query_place_id=ChIJ12345678901234567890123',
    })
    expect(() => normalizeInstagramTarget('https://instagram.com/reel/123')).toThrow()
    expect(() => normalizeFacebookTarget('https://facebook.com/groups/123')).toThrow()
    expect(() => normalizeGoogleMapsTarget({ placeUrl: 'https://example.com/place' })).toThrow()
    expect(() => normalizeGoogleMapsTarget({ placeUrl: 'https://www.google.evil.com/maps/place/x' })).toThrow()
    expect(() => normalizeGoogleMapsTarget({ placeId: 'arbitrary-but-long-enough' })).toThrow()
    expect(() => normalizeGoogleMapsTarget({ placeUrl: 'https://maps.app.goo.gl/short-link' })).toThrow()
    expect(() => normalizeGoogleMapsTarget({ placeUrl: 'https://maps.google.com/maps/place/x', placeId: 'x' })).toThrow()
    expect(() => normalizeFacebookTarget('https://facebook.com/%67roups')).toThrow()
  })

  it('uses only exact numeric builds and closed actor inputs', () => {
    expect(ACTOR_CATALOG_ENTRIES).toHaveLength(4)
    for (const entry of ACTOR_CATALOG_ENTRIES) {
      expect(entry.build).toMatch(/^\d+\.\d+\.\d+$/)
      expect(entry.build).not.toMatch(/latest|beta/i)
      expect(entry.buildId).toMatch(/^[A-Za-z0-9]+$/)
      expect(entry.inputSchemaHash).toMatch(/^[a-f0-9]{64}$/)
      expect(entry.pricingFingerprint).toMatch(/^[a-f0-9]{64}$/)
      expect(entry.pricingModel).toBe('pay_per_event')
    }
    expect(ACTOR_CATALOG.google_maps_reviews.buildInput({
      placeId: 'ChIJ12345678901234567890123',
      maxReviews: 500,
      sort: 'most_relevant',
    })).toMatchObject({ maxReviews: 25, reviewsSort: 'mostRelevant', personalData: false })
    expect(ACTOR_CATALOG.google_maps_place.minimumChargeUsd).toBe(0.5)
  })
})
