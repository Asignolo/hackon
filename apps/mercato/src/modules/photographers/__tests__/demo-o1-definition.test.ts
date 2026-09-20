import { workflowDefinitionDataSchema } from '@open-mercato/core/modules/workflows/data/validators'
import { createDemoWorkflowDefinition, DEMO_O1_BOUNDARY_STEP } from '../lib/demo-workflow'

test('active demo dispatches real O1 and parks without an evaluation completion edge', () => {
  const definition = createDemoWorkflowDefinition()
  expect(workflowDefinitionDataSchema.parse(definition)).toBeDefined()
  expect(definition.transitions.flatMap((transition) => transition.activities ?? []).map((activity) => activity.config.functionName)).toEqual(['photographers.o1.prepare', 'photographers.o1.dispatch', 'photographers.o1.store_result'])
  expect(definition.transitions.find((transition) => transition.fromStepId === 'o1')?.toStepId).toBe(DEMO_O1_BOUNDARY_STEP)
  expect(definition.steps.find((step) => step.stepId === DEMO_O1_BOUNDARY_STEP)?.stepType).toBe('WAIT_FOR_SIGNAL')
  expect(definition.transitions.filter((transition) => transition.fromStepId === DEMO_O1_BOUNDARY_STEP)).toEqual([])
})
