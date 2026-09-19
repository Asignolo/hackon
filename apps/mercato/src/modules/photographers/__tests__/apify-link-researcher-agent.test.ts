import path from 'node:path'
import { loadFileAgentDir } from '@open-mercato/enterprise/modules/agent_orchestrator/lib/sdk/defineFileAgent'

const agent = loadFileAgentDir(path.join(__dirname, '..', 'agents', 'apify_link_researcher_o2'))!

test('loads O2 with the existing package tools and a research outcome', () => {
  expect(agent.entry.id).toBe('photographers.apify_link_researcher_o2')
  expect(agent.entry.resultKind).toBe('research')
  expect(agent.entry.tools).toEqual([
    'integration_apify.scrape_instagram_profile',
    'integration_apify.scrape_facebook_page',
    'integration_apify.scrape_google_maps_place',
    'integration_apify.scrape_google_maps_reviews',
  ])
  expect(agent.openCodeAgentFile).toContain('"open-mercato_integration_apify_scrape_instagram_profile": true')
  expect(agent.entry.sampleInput).toMatchObject({
    schemaVersion: 1,
    portfolio: { originalValue: 'margografia' },
    links: [
      { type: 'website' },
      { type: 'contact' },
      { type: 'instagram', url: 'https://www.instagram.com/margografia' },
      { type: 'facebook', url: 'https://www.facebook.com/margografia/' },
    ],
  })
})

test('preserves partial provider data, zero, missing values and attribution flags', () => {
  const provider = {
    ok: true, status: 'partial', platform: 'instagram',
    canonicalUrl: 'https://www.instagram.com/studio_example/',
    sourceUrl: 'https://www.instagram.com/studio_example/',
    observedAt: '2026-09-19T12:00:00Z', actorRunId: 'synthetic-run',
    data: { username: 'studio_example', followersCount: 0, postsCount: null },
    unavailableFields: [{ field: 'postsCount', reason: 'not_exposed' }], diagnostics: [],
  }
  const data = {
    schemaVersion: 1, status: 'partial',
    results: [{
      tool: 'integration_apify.scrape_instagram_profile', url: provider.sourceUrl,
      confidence: 'probable', approvalRequired: true, status: provider.status,
      actorRunId: provider.actorRunId, observedAt: provider.observedAt,
      resultJson: JSON.stringify(provider), error: null,
    }], skipped: [], summary: 'Dane częściowe; przypisanie nadal wymaga sprawdzenia.',
  }
  expect(agent.entry.schema.parse({ kind: 'research', data })).toEqual({ kind: 'research', data })
})

test('accepts empty input results and transport errors without fabricated provider metadata', () => {
  expect(agent.entry.schema.safeParse({ kind: 'research', data: {
    schemaVersion: 1, status: 'no_targets', results: [], skipped: [], summary: 'Brak linków.',
  } }).success).toBe(true)
  expect(agent.entry.schema.safeParse({ kind: 'research', data: {
    schemaVersion: 1, status: 'error', results: [{
      tool: 'integration_apify.scrape_facebook_page', url: 'https://www.facebook.com/studio_example',
      confidence: 'confirmed', approvalRequired: false, status: 'error',
      actorRunId: null, observedAt: null, resultJson: null, error: 'Tool unavailable',
    }], skipped: [], summary: 'Narzędzie niedostępne.',
  } }).success).toBe(true)
})
