export const APIFY_RESEARCH_FEATURE = 'integration_apify.research'

export const features = [
  {
    id: 'integration_apify.research',
    title: 'Run paid Apify public-business research',
    module: 'integration_apify',
    dependsOn: ['agent_orchestrator.agents.run'],
  },
]

export default features
