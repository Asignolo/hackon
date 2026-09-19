import type { McpToolContext } from '@open-mercato/ai-assistant/modules/ai_assistant/lib/types'
import type { FetchedPage } from '@open-mercato/web-research'
import { webFetchTool } from '../tools'
import { buildWebSearchEngine } from '../registry'
import { resolveEnvSettings, resolveWebSearchSettings } from '../policy'
import { enforceWebSearchRateLimit } from '../guardrails'

jest.mock('../registry', () => ({ buildWebSearchEngine: jest.fn() }))
jest.mock('../steps', () => ({ createStepEmitter: jest.fn() }))
jest.mock('../policy', () => ({ ...jest.requireActual('../policy'), resolveWebSearchSettings: jest.fn() }))
jest.mock('../guardrails', () => ({
  resolveRunId: jest.fn(async () => null),
  resolveSpentAdapterBudgets: jest.fn(async () => new Set()),
  enforceWebSearchRateLimit: jest.fn(async () => ({ ok: true })),
}))

const context: McpToolContext = {
  tenantId: 'tenant-synthetic', organizationId: 'org-synthetic', userId: null,
  userFeatures: [], isSuperAdmin: false,
  container: {} as McpToolContext['container'],
}
const basePage: FetchedPage = {
  url: 'https://studio.example/', title: null, text: 'Portfolio', contentType: 'text/html',
  status: 200, truncated: false, renderedWith: 'http',
}

function configure(page: FetchedPage) {
  const fetch = jest.fn(async () => ({ status: 'ok' as const, page }))
  const dispose = jest.fn(async () => {})
  jest.mocked(buildWebSearchEngine).mockReturnValue({ engine: { fetch, dispose }, problems: [] } as unknown as ReturnType<typeof buildWebSearchEngine>)
  jest.mocked(resolveWebSearchSettings).mockResolvedValue(resolveEnvSettings({ OM_WEB_SEARCH_ALLOW_DOMAINS: 'studio.example, facebook.com' }))
  return { fetch, dispose }
}

describe('web_fetch source link governance', () => {
  beforeEach(() => jest.clearAllMocks())

  it('filters source links through domain policy and safe URL checks without following them', async () => {
    const urls = ['https://facebook.com/studio', 'https://instagram.com/studio', 'http://127.0.0.1/', 'https://user:secret@studio.example/']
    const engine = configure({ ...basePage, links: urls.map((url) => ({ url, originalHref: url, text: 'Profile' })) })
    const result = await webFetchTool.handler({ url: basePage.url }, context)
    expect(result).toMatchObject({ ok: true, links: [{ url: urls[0], originalHref: urls[0], text: 'Profile' }], linksTruncated: true })
    expect(engine.fetch).toHaveBeenCalledTimes(1)
    expect(engine.dispose).toHaveBeenCalledTimes(1)
    expect(enforceWebSearchRateLimit).toHaveBeenCalled()
    expect(webFetchTool.requiredFeatures).toEqual(['agent_orchestrator.web_search', 'agent_orchestrator.web_fetch'])
  })

  it('does not turn missing extraction into an empty list', async () => {
    configure({ ...basePage, renderedWith: 'browser' })
    expect(await webFetchTool.handler({ url: basePage.url }, context)).not.toHaveProperty('links')
  })

  it('bounds adapter-supplied link counts and text', async () => {
    configure({ ...basePage, links: Array.from({ length: 205 }, (_, index) => ({ url: `https://studio.example/${index}`, originalHref: `/${index}`, text: 'a'.repeat(500) })) })
    const result = await webFetchTool.handler({ url: basePage.url }, context) as { links: Array<{ text: string }>; linksTruncated: boolean }
    expect(result.links).toHaveLength(200)
    expect(result.links[0].text).toHaveLength(300)
    expect(result.linksTruncated).toBe(true)
  })

  it('still rejects redirects to a denied final domain', async () => {
    configure({ ...basePage, url: 'https://denied.example/', links: [] })
    expect(await webFetchTool.handler({ url: basePage.url }, context)).toMatchObject({ ok: false, code: 'domain_blocked' })
  })
})
