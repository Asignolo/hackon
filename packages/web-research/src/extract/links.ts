import { isIP } from 'node:net'
import type { FetchedPageLink } from '../contract/results'
import { isLoopbackHostname, isPrivateAddress } from '../net/ssrf'
import { NON_CONTENT_ELEMENTS } from './text'
import { MAX_HTML_INPUT, tokenizeHtml } from './tokenizer'

export const MAX_PAGE_LINKS = 200
export const MAX_PAGE_LINK_URL_LENGTH = 2048
export const MAX_PAGE_LINK_TEXT_LENGTH = 300

export function resolvePageLink(href: string, baseUrl: string): string | null {
  if (!href.trim() || href.length > MAX_PAGE_LINK_URL_LENGTH) return null
  try {
    const url = new URL(href, baseUrl)
    if (url.protocol !== 'https:' && url.protocol !== 'http:') return null
    if (url.username || url.password || url.href.length > MAX_PAGE_LINK_URL_LENGTH) return null
    const hostname = url.hostname.replace(/^\[|\]$/g, '').replace(/\.$/, '')
    if (isLoopbackHostname(hostname) || (isIP(hostname) && isPrivateAddress(hostname))) return null
    return url.href
  } catch {
    return null
  }
}

export function extractPageLinks(html: string, pageUrl: string): {
  links: FetchedPageLink[]
  linksTruncated: boolean
} {
  const links: FetchedPageLink[] = []
  const seen = new Set<string>()
  let baseUrl = pageUrl
  let baseSeen = false
  let linksTruncated = html.length > MAX_HTML_INPUT
  let current: { originalHref: string; url: string; text: string; label: string } | null = null
  let skipName: string | null = null
  let skipDepth = 0

  const finishLink = () => {
    if (!current) return
    if (!seen.has(current.url)) {
      seen.add(current.url)
      if (links.length >= MAX_PAGE_LINKS) linksTruncated = true
      else links.push({
        url: current.url,
        originalHref: current.originalHref,
        text: (current.text.trim() || current.label).replace(/\s+/g, ' ').trim().slice(0, MAX_PAGE_LINK_TEXT_LENGTH),
      })
    }
    current = null
  }

  for (const token of tokenizeHtml(html)) {
    if (skipName) {
      if (token.kind === 'open' && token.name === skipName) skipDepth += 1
      if (token.kind === 'close' && token.name === skipName) {
        skipDepth -= 1
        if (skipDepth === 0) skipName = null
      }
      continue
    }
    if (token.kind === 'text') {
      if (current) current.text = `${current.text}${token.value.replace(/\s+/g, ' ')}`.slice(0, MAX_PAGE_LINK_TEXT_LENGTH)
      continue
    }
    if (token.kind === 'close') {
      if (token.name === 'a') finishLink()
      continue
    }
    if (NON_CONTENT_ELEMENTS.has(token.name)) {
      skipName = token.name
      skipDepth = 1
      continue
    }
    if (token.name === 'base' && !baseSeen && token.attributes.has('href')) {
      baseSeen = true
      try {
        baseUrl = new URL(token.attributes.get('href') ?? '', pageUrl).href
      } catch {
        baseUrl = pageUrl
      }
    }
    if (token.name === 'a') {
      finishLink()
      if (linksTruncated && links.length >= MAX_PAGE_LINKS) break
      const originalHref = token.attributes.get('href') ?? ''
      const url = resolvePageLink(originalHref, baseUrl)
      if (url) current = {
        originalHref,
        url,
        text: '',
        label: (token.attributes.get('aria-label') || token.attributes.get('title') || '').slice(0, MAX_PAGE_LINK_TEXT_LENGTH),
      }
    } else if (token.name === 'img' && current && !current.label) {
      current.label = (token.attributes.get('alt') ?? '').slice(0, MAX_PAGE_LINK_TEXT_LENGTH)
    }
  }
  finishLink()
  return { links, linksTruncated }
}
