import { createWorkflowsModuleConfig, type CodeWorkflowDefinition } from '@open-mercato/shared/modules/workflows'
import { createSyntheticWorkflowDefinition } from './lib/synthetic-workflow'

const syntheticWorkflow: CodeWorkflowDefinition = {
  moduleId: 'photographers',
  workflowId: 'photographers.synthetic-evaluation',
  workflowName: 'photographers.synthetic.name',
  version: 1,
  enabled: true,
  description: null,
  metadata: { tags: ['integration-test'], category: 'photographers' },
  definition: createSyntheticWorkflowDefinition(),
}

export const workflowsConfig = createWorkflowsModuleConfig({
  moduleId: 'photographers',
  workflows: process.env.OM_INTEGRATION_TEST === 'true' ? [syntheticWorkflow] : [],
})

export default workflowsConfig
