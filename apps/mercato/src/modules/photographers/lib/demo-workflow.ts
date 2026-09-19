import type { CodeWorkflowDefinitionData } from '@open-mercato/shared/modules/workflows'
import { createSyntheticWorkflowDefinition } from './synthetic-workflow'
import english from '../i18n/en.json'

export const DEMO_WORKFLOW_ID = 'photographers.demo-evaluation'
export const DEMO_WORKFLOW_QUEUE = 'photographers-demo-workflow'
export const DEMO_REVIEW_STEP = 'wait_review'
export const DEMO_REVIEW_SIGNAL = 'photographers.demo.review.disposed'
export const DEMO_WORKFLOW_NAME = english['photographers.demo.workflow.name']

export function createDemoWorkflowDefinition(): CodeWorkflowDefinitionData {
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
