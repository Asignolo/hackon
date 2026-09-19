import { z } from 'zod'

const INSTAGRAM_RESERVED_PATHS = new Set(['p', 'reel', 'reels', 'stories', 'explore', 'accounts'])
const FACEBOOK_RESERVED_PATHS = new Set(['groups', 'events', 'profile.php', 'posts', 'watch', 'marketplace'])
const PLACE_ID_PATTERN = /^[A-Za-z0-9_-]{10,200}$/

function parseHttpsUrl(value: string, hosts: (hostname: string) => boolean): URL {
  const url = new URL(value)
  if (url.protocol !== 'https:' || !hosts(url.hostname.toLowerCase())) {
    throw new Error('[internal] Unsupported public target host.')
  }
  url.hash = ''
  return url
}

export function normalizeInstagramTarget(value: string): { username: string; canonicalUrl: string } {
  const trimmed = value.trim()
  const rawUsername = trimmed.includes('://')
    ? (() => {
        const url = parseHttpsUrl(trimmed, (host) => host === 'instagram.com' || host === 'www.instagram.com')
        const segments = url.pathname.split('/').filter(Boolean)
        if (segments.length !== 1) throw new Error('[internal] Instagram target must be one profile.')
        return segments[0]
      })()
    : trimmed.replace(/^@/, '')
  const username = z.string().regex(/^[A-Za-z0-9._]{1,30}$/).parse(rawUsername)
  if (INSTAGRAM_RESERVED_PATHS.has(username.toLowerCase())) {
    throw new Error('[internal] Instagram target is not a profile.')
  }
  return { username, canonicalUrl: `https://www.instagram.com/${username}/` }
}

export function normalizeFacebookTarget(value: string): { pageUrl: string; canonicalUrl: string } {
  const url = parseHttpsUrl(value.trim(), (host) =>
    host === 'facebook.com' || host === 'www.facebook.com' || host === 'm.facebook.com')
  const segments = url.pathname.split('/').filter(Boolean)
  if (segments.length !== 1 || FACEBOOK_RESERVED_PATHS.has(segments[0].toLowerCase())) {
    throw new Error('[internal] Facebook target must be one public Page.')
  }
  const canonicalUrl = `https://www.facebook.com/${segments[0]}/`
  return { pageUrl: canonicalUrl, canonicalUrl }
}

export function normalizeGoogleMapsTarget(input: {
  placeUrl?: string
  placeId?: string
}): { placeUrl?: string; placeId?: string; canonicalUrl: string } {
  const hasUrl = typeof input.placeUrl === 'string' && input.placeUrl.trim() !== ''
  const hasId = typeof input.placeId === 'string' && input.placeId.trim() !== ''
  if (hasUrl === hasId) throw new Error('[internal] Provide exactly one Google Maps URL or Place ID.')
  if (hasId) {
    const placeId = z.string().regex(PLACE_ID_PATTERN).parse(input.placeId?.trim())
    return { placeId, canonicalUrl: `https://www.google.com/maps/search/?api=1&query_place_id=${placeId}` }
  }
  const url = parseHttpsUrl(input.placeUrl?.trim() ?? '', (host) =>
    host === 'maps.app.goo.gl' || /^(?:www\.)?google\.[a-z.]+$/.test(host))
  const queryPlaceId = url.searchParams.get('query_place_id')
  const isConcreteGooglePlace = url.pathname.startsWith('/maps/place/')
    || (url.pathname.startsWith('/maps/search') && Boolean(queryPlaceId))
  if (url.hostname !== 'maps.app.goo.gl' && !isConcreteGooglePlace) {
    throw new Error('[internal] URL must identify a Google Maps place.')
  }
  url.search = queryPlaceId ? `?api=1&query_place_id=${queryPlaceId}` : ''
  return { placeUrl: url.toString(), canonicalUrl: url.toString() }
}
