import { createWorkflowsModuleConfig, type CodeWorkflowDefinition } from '@open-mercato/shared/modules/workflows'
import { createSyntheticWorkflowDefinition } from './lib/synthetic-workflow'
import { createDemoWorkflowDefinition, DEMO_WORKFLOW_ID, DEMO_WORKFLOW_NAME } from './lib/demo-workflow'

const demoWorkflow: CodeWorkflowDefinition = {
  moduleId: 'photographers', workflowId: DEMO_WORKFLOW_ID, workflowName: DEMO_WORKFLOW_NAME, version: 2, enabled: true,
  description: null, metadata: { tags: ['demo'], category: 'photographers' }, definition: createDemoWorkflowDefinition(),
}

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
  workflows: process.env.OM_INTEGRATION_TEST === 'true' ? [demoWorkflow, syntheticWorkflow] : [demoWorkflow],
})

export default workflowsConfig
