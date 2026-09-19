import instagramComplete from '../__fixtures__/instagram-complete.json'
import instagramPrivate from '../__fixtures__/instagram-private.json'
import facebookPartial from '../__fixtures__/facebook-partial.json'
import mapsPlaceComplete from '../__fixtures__/google-maps-place-complete.json'
import mapsReviewsRedaction from '../__fixtures__/google-maps-reviews-redaction.json'
import { normalizeFacebookPage } from '../lib/normalizers/facebook-page'
import { normalizeGoogleMapsPlace } from '../lib/normalizers/google-maps-place'
import { normalizeGoogleMapsReviews } from '../lib/normalizers/google-maps-reviews'
import { normalizeInstagramProfile } from '../lib/normalizers/instagram-profile'
import { enforceApifyResultSize, serializedSize } from '../lib/result'

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

  it('fails closed when Instagram privacy is not explicitly public', () => {
    expect(normalizeInstagramProfile({
      items: [{ username: 'openmercato', isBusinessAccount: true }],
      actorRunId: 'run-a',
      sourceUrl: 'https://www.instagram.com/openmercato/',
      expectedUsername: 'openmercato',
    })).toMatchObject({ ok: false, data: null, diagnostics: [{ code: 'schema_changed' }] })
    expect(normalizeInstagramProfile({
      items: [{ username: 'openmercato', isBusinessAccount: true, isPrivate: false, private: true }],
      actorRunId: 'run-a',
      sourceUrl: 'https://www.instagram.com/openmercato/',
      expectedUsername: 'openmercato',
    })).toMatchObject({ ok: false, data: null, diagnostics: [{ code: 'schema_changed' }] })
  })

  it('fails closed when the pinned Instagram business discriminator is absent or invalid', () => {
    for (const record of [
      {},
      { isBusinessAccount: false },
      { isBusinessAccount: 'true' },
    ]) {
      expect(normalizeInstagramProfile({
        items: [{ username: 'openmercato', isPrivate: false, ...record }],
        actorRunId: 'run-a',
        sourceUrl: 'https://www.instagram.com/openmercato/',
        expectedUsername: 'openmercato',
      })).toMatchObject({
        ok: false,
        data: null,
        diagnostics: [{ code: 'unsupported_public_scope' }],
      })
    }
  })

  it('maps only known Instagram Actor error codes without exposing upstream text', () => {
    expect(normalizeInstagramProfile({
      items: [{ error: 'not_found', errorDescription: 'secret details' }],
      actorRunId: 'run-a',
      sourceUrl: 'https://www.instagram.com/missing/',
      expectedUsername: 'missing',
    })).toMatchObject({ ok: false, status: 'no_data', diagnostics: [{ code: 'no_data' }] })
    expect(normalizeInstagramProfile({
      items: [{ error: 'blocked', requestErrorMessages: ['secret details'] }],
      actorRunId: 'run-a',
      sourceUrl: 'https://www.instagram.com/openmercato/',
      expectedUsername: 'openmercato',
    })).toMatchObject({ ok: false, status: 'error', diagnostics: [{ code: 'platform_blocked' }] })
    const unknown = normalizeInstagramProfile({
      items: [{ error: 'new_code', errorDescription: 'secret details' }],
      actorRunId: 'run-a',
      sourceUrl: 'https://www.instagram.com/openmercato/',
      expectedUsername: 'openmercato',
    })
    expect(unknown).toMatchObject({ ok: false, diagnostics: [{ code: 'schema_changed' }] })
    expect(JSON.stringify(unknown)).not.toContain('secret details')
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
      data: {
        category: 'Software company',
        description: 'Composable commerce platform',
        followersCount: 0,
        rating: 96,
        website: 'https://openmercato.com',
        isVerified: false,
      },
    })
    expect(result.unavailableFields).toContainEqual({ field: 'likesCount', reason: 'not_exposed' })
  })

  it('fails closed for an unclassified or mismatched Facebook result', () => {
    expect(normalizeFacebookPage({
      items: [{ title: 'Unknown target' }],
      actorRunId: 'run-a',
      sourceUrl: 'https://www.facebook.com/openmercato/',
    })).toMatchObject({ ok: false, diagnostics: [{ code: 'unsupported_public_scope' }] })
    expect(normalizeFacebookPage({
      items: [{ categories: ['Page'], title: 'Other', facebookUrl: 'https://www.facebook.com/other/' }],
      actorRunId: 'run-a',
      sourceUrl: 'https://www.facebook.com/openmercato/',
    })).toMatchObject({ ok: false, diagnostics: [{ code: 'unsupported_public_scope' }] })
    expect(normalizeFacebookPage({
      items: [{
        categories: ['Public figure'],
        personalProfile: { name: 'Person' },
        title: 'Person',
        facebookUrl: 'https://www.facebook.com/openmercato/',
      }],
      actorRunId: 'run-a',
      sourceUrl: 'https://www.facebook.com/openmercato/',
    })).toMatchObject({ ok: false, diagnostics: [{ code: 'unsupported_public_scope' }] })
  })

  it('deduplicates and bounds place categories', () => {
    const result = normalizeGoogleMapsPlace({
      items: [mapsPlaceComplete],
      actorRunId: 'run-a',
      sourceUrl: 'https://www.google.com/maps/place/example',
      expectedPlaceId: 'ChIJ12345678901234567890123',
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

  it('bounds every category element so an upstream string cannot bypass the result ceiling', () => {
    const result = normalizeGoogleMapsPlace({
      items: [{
        ...mapsPlaceComplete,
        categories: Array.from({ length: 20 }, (_entry, index) => `${index}-${'x'.repeat(10_000)}`),
      }],
      actorRunId: 'run-a',
      sourceUrl: 'https://www.google.com/maps/place/example',
      expectedPlaceId: 'ChIJ12345678901234567890123',
    })
    expect(result.data?.categories?.every((entry) => entry.length <= 500)).toBe(true)
    expect(result.diagnostics).toContainEqual(expect.objectContaining({ code: 'output_truncated' }))
    expect(serializedSize(result)).toBeLessThanOrEqual(64 * 1024)
  })

  it('removes every reviewer identity field and bounds review content', () => {
    const result = normalizeGoogleMapsReviews({
      items: [mapsReviewsRedaction],
      actorRunId: 'run-a',
      sourceUrl: 'https://www.google.com/maps/place/example',
      expectedPlaceId: 'ChIJ12345678901234567890123',
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

  it('does not copy review text into a missing owner response and honors the requested sample size', () => {
    const result = normalizeGoogleMapsReviews({
      items: [{
        placeId: 'ChIJ12345678901234567890123',
        title: 'Open Mercato Lab',
        reviews: [
          { stars: 5, text: 'First review.' },
          { stars: 4, text: 'Second review.' },
        ],
      }],
      actorRunId: 'run-a',
      sourceUrl: 'https://www.google.com/maps/place/example',
      maxReviews: 1,
      expectedPlaceId: 'ChIJ12345678901234567890123',
    })
    expect(result.data?.sampledReviews).toEqual([expect.objectContaining({
      text: 'First review.',
      ownerResponse: null,
    })])
    expect(result.diagnostics).toContainEqual(expect.objectContaining({ code: 'output_truncated' }))
  })

  it('fails closed for missing, mismatched, or cross-host Facebook identity', () => {
    const base = {
      actorRunId: 'run-a',
      sourceUrl: 'https://www.facebook.com/openmercato/',
    }
    expect(normalizeFacebookPage({
      ...base,
      items: [{ categories: ['Page'], title: 'Missing identity' }],
    })).toMatchObject({ ok: false, diagnostics: [{ code: 'unsupported_public_scope' }] })
    expect(normalizeFacebookPage({
      ...base,
      items: [{ categories: ['Page'], facebookUrl: 'https://example.com/openmercato/' }],
    })).toMatchObject({ ok: false, diagnostics: [{ code: 'unsupported_public_scope' }] })
    expect(normalizeFacebookPage({
      ...base,
      items: [{
        categories: ['Page'],
        personalProfile: { name: 'Person' },
        facebookUrl: 'https://www.facebook.com/openmercato/',
      }],
    })).toMatchObject({ ok: false, diagnostics: [{ code: 'unsupported_public_scope' }] })
  })

  it('selects only an unambiguously matching Google place record', () => {
    const result = normalizeGoogleMapsPlace({
      items: [
        { ...mapsPlaceComplete, placeId: 'ChIJ00000000000000000000000', title: 'Wrong' },
        mapsPlaceComplete,
      ],
      actorRunId: 'run-a',
      sourceUrl: 'https://www.google.com/maps/place/example',
      expectedPlaceId: 'ChIJ12345678901234567890123',
    })
    expect(result).toMatchObject({ ok: true, data: { name: 'Open Mercato Lab' } })
    expect(normalizeGoogleMapsPlace({
      items: [{ ...mapsPlaceComplete, placeId: 'ChIJ00000000000000000000000' }],
      actorRunId: 'run-a',
      sourceUrl: 'https://www.google.com/maps/place/example',
      expectedPlaceId: 'ChIJ12345678901234567890123',
    })).toMatchObject({ ok: false, diagnostics: [{ code: 'schema_changed' }] })
  })

  it('verifies a concrete Google Maps URL and rejects an unverifiable short-link identity', () => {
    const sourceUrl = 'https://www.google.com/maps/place/Open+Mercato'
    const canonicalResultUrl = 'https://www.google.com/maps/search/?api=1&query=Open%20Mercato&query_place_id=ChIJ12345678901234567890123'
    expect(normalizeGoogleMapsPlace({
      items: [{ ...mapsPlaceComplete, searchString: `Direct Detail URL: ${sourceUrl}`, url: canonicalResultUrl }],
      actorRunId: 'run-a',
      sourceUrl,
      expectedPlaceUrl: sourceUrl,
    })).toMatchObject({ ok: true, data: { placeId: 'ChIJ12345678901234567890123' } })
    expect(normalizeGoogleMapsPlace({
      items: [{ ...mapsPlaceComplete, searchString: `Direct Detail URL: ${sourceUrl}`, url: canonicalResultUrl }],
      actorRunId: 'run-a',
      sourceUrl: 'https://maps.app.goo.gl/short-link',
      expectedPlaceUrl: 'https://maps.app.goo.gl/short-link',
    })).toMatchObject({ ok: false, diagnostics: [{ code: 'schema_changed' }] })
    expect(normalizeGoogleMapsPlace({
      items: [{
        ...mapsPlaceComplete,
        searchString: 'Direct Detail URL: https://www.google.com/maps/place/Other',
        url: canonicalResultUrl,
      }],
      actorRunId: 'run-a',
      sourceUrl,
      expectedPlaceUrl: sourceUrl,
    })).toMatchObject({ ok: false, diagnostics: [{ code: 'schema_changed' }] })
  })

  it('does not mix flat reviews from different places and rejects malformed nested reviews', () => {
    const expectedPlaceId = 'ChIJ12345678901234567890123'
    const result = normalizeGoogleMapsReviews({
      items: [
        { placeId: 'ChIJ00000000000000000000000', stars: 1, text: 'Wrong place' },
        { placeId: expectedPlaceId, stars: 5, text: 'Expected place' },
      ],
      actorRunId: 'run-a',
      sourceUrl: 'https://www.google.com/maps/place/example',
      expectedPlaceId,
    })
    expect(result.data?.sampledReviews).toEqual([expect.objectContaining({ text: 'Expected place' })])
    expect(JSON.stringify(result)).not.toContain('Wrong place')
    expect(normalizeGoogleMapsReviews({
      items: [{ placeId: expectedPlaceId, reviews: 'changed' }],
      actorRunId: 'run-a',
      sourceUrl: 'https://www.google.com/maps/place/example',
      expectedPlaceId,
    })).toMatchObject({ ok: false, diagnostics: [{ code: 'schema_changed' }] })
  })

  it('marks a malformed owner response as schema drift without copying fallback text', () => {
    const expectedPlaceId = 'ChIJ12345678901234567890123'
    const result = normalizeGoogleMapsReviews({
      items: [{
        placeId: expectedPlaceId,
        reviews: [{ stars: 5, text: 'Review', responseFromOwner: 'changed', ownerResponse: 'must not copy' }],
      }],
      actorRunId: 'run-a',
      sourceUrl: 'https://www.google.com/maps/place/example',
      expectedPlaceId,
    })
    expect(result.data?.sampledReviews[0]?.ownerResponse).toBeNull()
    expect(result.diagnostics).toContainEqual(expect.objectContaining({ code: 'schema_changed' }))
    expect(JSON.stringify(result)).not.toContain('must not copy')
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

  it('deterministically truncates an unforeseen normalized payload to 64 KiB', () => {
    const result = enforceApifyResultSize({
      ok: true,
      status: 'complete',
      platform: 'google_maps',
      canonicalUrl: null,
      sourceUrl: null,
      observedAt: '2026-09-19T00:00:00.000Z',
      actorRunId: 'run-a',
      data: { unexpected: 'x'.repeat(70 * 1024) },
      unavailableFields: [],
      diagnostics: [],
    })
    expect(result).toMatchObject({
      ok: true,
      status: 'partial',
      diagnostics: [{ code: 'output_truncated' }],
    })
    expect((result.data as { unexpected: string }).unexpected.length).toBeLessThan(70 * 1024)
    expect(serializedSize(result)).toBeLessThanOrEqual(64 * 1024)
  })
})
