import { APIFY_RESEARCH_FEATURE, features } from '../acl'
import { integration } from '../integration'
import { metadata } from '../index'

describe('integration_apify contracts', () => {
  it('registers the Marketplace provider and keeps research disabled by default', () => {
    expect(metadata).toMatchObject({
      id: 'integration_apify',
      requires: ['integrations', 'ai_assistant'],
    })
    expect(integration).toMatchObject({
      id: 'integration_apify',
      category: 'other',
      hub: 'agent_orchestrator',
      defaultState: { isEnabled: false },
      healthCheck: { service: 'apifyHealthCheck' },
    })
    expect(integration.credentials?.fields).toEqual([
      expect.objectContaining({ key: 'apiToken', type: 'secret', required: true }),
    ])
  })

  it('declares the default-off paid-egress feature', () => {
    expect(APIFY_RESEARCH_FEATURE).toBe('integration_apify.research')
    expect(features).toContainEqual(
      expect.objectContaining({
        id: APIFY_RESEARCH_FEATURE,
        dependsOn: ['agent_orchestrator.agents.run'],
      }),
    )
  })
})
