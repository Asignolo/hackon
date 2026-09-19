import type { FetchedPage } from '../../contract/results'
import { resolvePolicy } from '../../contract/policy'
import { createStubHttpClient } from '../../testing/contract'
import { createFakeAdapter } from '../../testing/fakeAdapter'
import { createSearchEngine } from '../engine'

describe('fetch source links', () => {
  it('extracts from the complete HTTP HTML, resolving against the actual response URL without fetching links', async () => {
    const http = createStubHttpClient(() => ({
      url: 'https://final.example/portfolio/',
      body: '<main>' + 'Photography portfolio. '.repeat(60) + '</main><footer><a href="../contact">Contact</a></footer>',
    }))
    const engine = createSearchEngine({ policy: resolvePolicy({}), adapters: [], http })
    try {
      const outcome = await engine.fetch({ url: 'https://initial.example/' })
      expect(outcome).toMatchObject({ status: 'ok', page: {
        url: 'https://final.example/portfolio/',
        links: [{ url: 'https://final.example/contact', originalHref: '../contact', text: 'Contact' }],
        linksTruncated: false,
      } })
      expect(http.calls).toEqual(['https://initial.example/'])
    } finally {
      await engine.dispose()
    }
  })

  it('omits link extraction for non-HTML content', async () => {
    const engine = createSearchEngine({ policy: resolvePolicy({}), adapters: [],
      http: createStubHttpClient(() => ({ body: '<a href="https://example.com">Plain text</a>', contentType: 'text/plain' })),
    })
    try {
      const outcome = await engine.fetch({ url: 'https://example.com/file.txt', render: 'never' })
      expect(outcome.status).toBe('ok')
      if (outcome.status === 'ok') expect(outcome.page).not.toHaveProperty('links')
    } finally {
      await engine.dispose()
    }
  })

  it.each([true, false])('keeps source provenance when browser escalation success=%s', async (success) => {
    const browser = createFakeAdapter({ id: 'browser', kind: 'browser' })
    const page: FetchedPage = { url: 'https://rendered.example/', title: null, text: 'Rendered page', contentType: 'text/html', status: 200, truncated: false, renderedWith: 'browser' }
    const engine = createSearchEngine({ policy: resolvePolicy({ escalateToBrowser: true }),
      adapters: [{ adapter: { ...browser, fetch: async () => success ? { status: 'ok', page } : { status: 'unavailable', reason: 'offline' } }, enabled: true, weight: 1, order: 0 }],
      http: createStubHttpClient(() => ({ body: '<div id="root"></div><a href="/contact">Contact</a>' })),
    })
    try {
      const outcome = await engine.fetch({ url: 'https://source.example/' })
      expect(outcome.status).toBe('ok')
      if (outcome.status !== 'ok') return
      if (success) {
        expect(outcome.page.url).toBe('https://rendered.example/')
        expect(outcome.page).not.toHaveProperty('links')
      } else {
        expect(outcome.page.url).toBe('https://source.example/')
        expect(outcome.page.links).toEqual([{ url: 'https://source.example/contact', originalHref: '/contact', text: 'Contact' }])
      }
    } finally {
      await engine.dispose()
    }
  })
})
