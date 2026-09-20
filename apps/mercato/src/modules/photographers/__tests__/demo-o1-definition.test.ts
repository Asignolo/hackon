import { workflowDefinitionDataSchema } from '@open-mercato/core/modules/workflows/data/validators'
import { createDemoWorkflowDefinition } from '../lib/demo-workflow'

test('demo persists O1 before dispatching O2 and completes only after saved scoring', () => {
  const definition = createDemoWorkflowDefinition()
  expect(workflowDefinitionDataSchema.parse(definition)).toBeDefined()
  expect(definition.transitions.flatMap((transition) => transition.activities ?? []).map((activity) => activity.config.functionName)).toEqual(['photographers.o1.prepare', 'photographers.o1.dispatch', 'photographers.o1.store_result', 'photographers.apify_o2.dispatch', 'photographers.demo.score'])
  expect(definition.transitions.find((transition) => transition.fromStepId === 'o1')?.toStepId).toBe('prepare_o2')
  expect(definition.steps.find((step) => step.stepId === 'apify_o2')?.signalConfig?.signalName).toBe('photographers.apify_o2.ready')
  expect(definition.transitions.find((transition) => transition.toStepId === 'end')?.activities?.[0].config.functionName).toBe('photographers.demo.score')
})
