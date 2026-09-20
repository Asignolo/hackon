import type { CodeWorkflowDefinitionData } from '@open-mercato/shared/modules/workflows'
import { createSyntheticWorkflowDefinition } from './synthetic-workflow'
import english from '../i18n/en.json'

export { DEMO_WORKFLOW_ID } from '../data/demo-workflow-validators'
export const DEMO_WORKFLOW_QUEUE = 'photographers-demo-workflow'
export const DEMO_REVIEW_STEP = 'wait_review'
export const DEMO_REVIEW_SIGNAL = 'photographers.demo.review.disposed'
export const DEMO_WORKFLOW_NAME = english['photographers.demo.workflow.name']

export function createLegacyDemoWorkflowDefinition(): CodeWorkflowDefinitionData {
  const definition = createSyntheticWorkflowDefinition()
  return {
    ...definition,
    steps: definition.steps.map((step) => ({
      ...step,
      stepName: english[step.stepName.replace('photographers.synthetic.', 'photographers.demo.workflow.') as keyof typeof english],
      ...(step.signalConfig ? { signalConfig: { signalName: step.stepId === DEMO_REVIEW_STEP ? DEMO_REVIEW_SIGNAL : step.signalConfig.signalName.replace('photographers.synthetic.', 'photographers.demo.') } } : {}),
    })),
    transitions: definition.transitions.map((transition) => ({
      ...transition,
      ...(transition.transitionId === 'review_end' ? { activities: [{ activityId: 'verify_decision', activityName: 'verifiedDecision', activityType: 'EXECUTE_FUNCTION' as const, async: false, config: { functionName: 'photographers.demo.finalize', args: {} } }] } : {}),
      ...(transition.activities ? { activities: transition.activities.map((activity) => ({
        ...activity,
        config: { functionName: 'photographers.demo.dispatch', args: { lane: activity.activityId.replace('dispatch_', '') } },
      })) } : {}),
    })),
  }
}

export const DEMO_O1_BOUNDARY_STEP = 'await_o2_integration'

export function createDemoWorkflowDefinition(): CodeWorkflowDefinitionData {
  return {
    steps: [
      { stepId: 'start', stepName: english['photographers.demo.o1.start'], stepType: 'START' },
      { stepId: 'prepare', stepName: english['photographers.demo.o1.prepare'], stepType: 'AUTOMATED' },
      { stepId: 'o1', stepName: english['photographers.demo.o1.research'], stepType: 'WAIT_FOR_SIGNAL', signalConfig: { signalName: 'photographers.o1.ready' } },
      { stepId: DEMO_O1_BOUNDARY_STEP, stepName: english['photographers.demo.o1.boundary'], stepType: 'WAIT_FOR_SIGNAL', signalConfig: { signalName: 'photographers.demo.o2.integration.ready' } },
    ],
    transitions: [
      { transitionId: 'start_prepare', fromStepId: 'start', toStepId: 'prepare', trigger: 'auto', activities: [
        { activityId: 'prepare_o1', activityName: 'o1Preparation', activityType: 'EXECUTE_FUNCTION', async: false, config: { functionName: 'photographers.o1.prepare', args: {} } },
      ] },
      { transitionId: 'prepare_o1', fromStepId: 'prepare', toStepId: 'o1', trigger: 'auto', activities: [
        { activityId: 'dispatch_o1', activityName: 'o1Dispatch', activityType: 'EXECUTE_FUNCTION', async: false, config: { functionName: 'photographers.o1.dispatch', args: {} } },
      ] },
      { transitionId: 'o1_boundary', fromStepId: 'o1', toStepId: DEMO_O1_BOUNDARY_STEP, trigger: 'auto', activities: [
        { activityId: 'store_o1_result', activityName: 'o1Result', activityType: 'EXECUTE_FUNCTION', async: false, config: { functionName: 'photographers.o1.store_result', args: { runId: '{{context.o1RunId}}' } } },
      ] },
    ],
  }
}
