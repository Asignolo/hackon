import instagramComplete from '../__fixtures__/instagram-complete.json'
import instagramPrivate from '../__fixtures__/instagram-private.json'
import facebookPartial from '../__fixtures__/facebook-partial.json'
import mapsPlaceComplete from '../__fixtures__/google-maps-place-complete.json'
import mapsReviewsRedaction from '../__fixtures__/google-maps-reviews-redaction.json'
import { normalizeFacebookPage } from '../lib/normalizers/facebook-page'
import { normalizeGoogleMapsPlace } from '../lib/normalizers/google-maps-place'
import { normalizeGoogleMapsReviews } from '../lib/normalizers/google-maps-reviews'
import { normalizeInstagramProfile } from '../lib/normalizers/instagram-profile'
import { serializedSize } from '../lib/result'

describe('Apify result normalizers', () => {
  it('normalizes a confirmed public Instagram business profile', () => {
    const result = normalizeInstagramProfile({
      items: [instagramComplete],
      actorRunId: 'run-a',
      sourceUrl: 'https://www.instagram.com/openmercato/',
      expectedUsername: 'openmercato',
    })
    expect(result).toMatchObject({
      ok: true,
      status: 'complete',
      data: {
        username: 'openmercato',
        accountType: 'business',
        followersCount: 1200,
        isVerified: false,
        isPrivate: false,
      },
    })
  })

  it('drops private and unconfirmed Instagram metadata', () => {
    const result = normalizeInstagramProfile({
      items: [instagramPrivate],
      actorRunId: 'run-a',
      sourceUrl: 'https://www.instagram.com/private_profile/',
      expectedUsername: 'private_profile',
    })
    expect(result).toMatchObject({
      ok: false,
      data: null,
      diagnostics: [{ code: 'unsupported_public_scope' }],
    })
    expect(result.data).toBeNull()
  })

  it('preserves explicit zero and false while marking absent Page fields unavailable', () => {
    const result = normalizeFacebookPage({
      items: [facebookPartial],
      actorRunId: 'run-a',
      sourceUrl: 'https://www.facebook.com/openmercato/',
    })
    expect(result).toMatchObject({
      ok: true,
      status: 'partial',
      data: { followersCount: 0, isVerified: false },
    })
    expect(result.unavailableFields).toContainEqual({ field: 'description', reason: 'not_exposed' })
  })

  it('deduplicates and bounds place categories', () => {
    const result = normalizeGoogleMapsPlace({
      items: [mapsPlaceComplete],
      actorRunId: 'run-a',
      sourceUrl: 'https://www.google.com/maps/place/example',
    })
    expect(result).toMatchObject({
      ok: true,
      status: 'complete',
      data: {
        categories: ['Software company', 'Technology company'],
        coordinates: { latitude: 52.2297, longitude: 21.0122 },
      },
    })
  })

  it('removes every reviewer identity field and bounds review content', () => {
    const result = normalizeGoogleMapsReviews({
      items: [mapsReviewsRedaction],
      actorRunId: 'run-a',
      sourceUrl: 'https://www.google.com/maps/place/example',
    })
    expect(result.data?.sampledReviews).toEqual([{
      rating: 5,
      text: 'Helpful team.',
      publishedAt: '2026-09-01T10:00:00.000Z',
      ownerResponse: 'Thank you.',
    }])
    const serialized = JSON.stringify(result)
    expect(serialized).not.toContain('Reviewer Identity')
    expect(serialized).not.toContain('private-reviewer-id')
    expect(serializedSize(result)).toBeLessThanOrEqual(64 * 1024)
  })

  it('treats identity drift as an error and an empty dataset as no data', () => {
    expect(normalizeInstagramProfile({
      items: [{ username: 12 }],
      actorRunId: 'run-a',
      sourceUrl: null,
      expectedUsername: 'openmercato',
    })).toMatchObject({ ok: false, diagnostics: [{ code: 'schema_changed' }] })
    expect(normalizeGoogleMapsPlace({
      items: [],
      actorRunId: 'run-a',
      sourceUrl: null,
    })).toMatchObject({ ok: false, status: 'no_data', diagnostics: [{ code: 'no_data' }] })
  })
})
