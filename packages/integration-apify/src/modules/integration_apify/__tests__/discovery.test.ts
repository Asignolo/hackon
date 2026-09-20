import { registerGeneratedAiToolEntries } from '@open-mercato/ai-assistant/modules/ai_assistant/lib/tool-loader'
import { toolRegistry } from '@open-mercato/ai-assistant/modules/ai_assistant/lib/tool-registry'
import { aiTools } from '../ai-tools'

describe('Apify Agent Orchestrator discovery smoke', () => {
  beforeEach(() => toolRegistry.clear())
  afterAll(() => toolRegistry.clear())

  it('registers the package contribution through the generated-tool contract', () => {
    const registered = registerGeneratedAiToolEntries([{
      moduleId: 'integration_apify',
      tools: aiTools,
    }])
    expect(registered).toBe(5)
    expect(toolRegistry.listToolsByModule('integration_apify')).toEqual(aiTools.map((tool) => tool.name))
    for (const tool of aiTools) {
      expect(toolRegistry.getTool(tool.name)).toMatchObject({
        isMutation: false,
        requiredFeatures: ['integration_apify.research'],
      })
    }
  })
})
