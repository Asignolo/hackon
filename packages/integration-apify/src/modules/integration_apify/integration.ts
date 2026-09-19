import type { IntegrationBundle, IntegrationDefinition } from '@open-mercato/shared/modules/integrations/types'

export const APIFY_INTEGRATION_ID = 'integration_apify'

export const integration: IntegrationDefinition = {
  id: APIFY_INTEGRATION_ID,
  title: 'Apify Research',
  description: 'Cost-bounded public business research for Agent Orchestrator runs.',
  category: 'other',
  hub: 'agent_orchestrator',
  providerKey: 'apify',
  docsUrl: 'https://docs.apify.com/api/client/js/docs',
  package: '@open-mercato/integration-apify',
  version: '1.0.0',
  author: 'Open Mercato Team',
  company: 'Open Mercato',
  license: 'MIT',
  tags: ['apify', 'research', 'instagram', 'facebook', 'google-maps', 'agent-orchestrator'],
  defaultState: { isEnabled: false },
  credentials: {
    fields: [
      {
        key: 'apiToken',
        label: 'API token',
        type: 'secret',
        required: true,
        helpText: 'Tenant-wide Apify API token. Stored encrypted at rest and resolved only after runtime guards pass.',
      },
    ],
  },
  healthCheck: { service: 'apifyHealthCheck' },
}

export const integrations: IntegrationDefinition[] = [integration]
export const bundles: IntegrationBundle[] = []
export const bundle: IntegrationBundle | undefined = undefined
