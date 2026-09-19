import { z } from 'zod'
import type { CodeStepDefinition, CodeTransitionDefinition, CodeWorkflowDefinitionData } from '@open-mercato/shared/modules/workflows'
import { workflowDefinitionDataSchema } from '@open-mercato/core/modules/workflows/data/validators'

export const syntheticWorkflowLanes = ['portfolio', 'social'] as const

export function createSyntheticWorkflowDefinition() {
  const definition: CodeWorkflowDefinitionData = {
    steps: [
      { stepId: 'start', stepName: 'photographers.synthetic.start', stepType: 'START' },
      { stepId: 'research', stepName: 'photographers.synthetic.research', stepType: 'PARALLEL_FORK', config: { joinStepId: 'join' } },
      ...syntheticWorkflowLanes.map((lane): CodeStepDefinition => ({
        stepId: `wait_${lane}`, stepName: `photographers.synthetic.${lane}`, stepType: 'WAIT_FOR_SIGNAL',
        signalConfig: { signalName: `photographers.synthetic.${lane}.ready` },
      })),
      { stepId: 'join', stepName: 'photographers.synthetic.join', stepType: 'PARALLEL_JOIN', config: { forkStepId: 'research' } },
      { stepId: 'wait_review', stepName: 'photographers.synthetic.review', stepType: 'WAIT_FOR_SIGNAL', signalConfig: { signalName: 'photographers.synthetic.review.ready' } },
      { stepId: 'end', stepName: 'photographers.synthetic.end', stepType: 'END' },
    ],
    transitions: [
      { transitionId: 'start_research', fromStepId: 'start', toStepId: 'research', trigger: 'auto' },
      ...syntheticWorkflowLanes.flatMap((lane): CodeTransitionDefinition[] => [
        {
          transitionId: `dispatch_${lane}`, fromStepId: 'research', toStepId: `wait_${lane}`, trigger: 'auto',
          activities: [{ activityId: `dispatch_${lane}`, activityName: `${lane}Dispatch`, activityType: 'EXECUTE_FUNCTION', async: false, config: { functionName: 'photographers.synthetic.dispatch', args: { lane, waitStepId: `wait_${lane}` } } }],
        },
        { transitionId: `${lane}_join`, fromStepId: `wait_${lane}`, toStepId: 'join', trigger: 'auto' },
      ]),
      {
        transitionId: 'dispatch_review', fromStepId: 'join', toStepId: 'wait_review', trigger: 'auto',
        activities: [{ activityId: 'dispatch_review', activityName: 'reviewDispatch', activityType: 'EXECUTE_FUNCTION', async: false, config: { functionName: 'photographers.synthetic.dispatch', args: { lane: 'review', waitStepId: 'wait_review' } } }],
      },
      { transitionId: 'review_end', fromStepId: 'wait_review', toStepId: 'end', trigger: 'auto' },
    ],
  }
  workflowDefinitionDataSchema.parse(definition)
  return definition
}

const dispatchReceiptSchema = z.object({ result: z.object({ operationId: z.string().uuid() }) })

export function classifySyntheticCallback(input: {
  operationId: string
  waitStepId: string
  currentStepId: string
  status: string
  receipt: unknown
  waitAttemptStatus: 'ACTIVE' | 'COMPLETED' | null
}): 'ready' | 'retry' | 'obsolete' {
  const receipt = dispatchReceiptSchema.safeParse(input.receipt)
  if (receipt.success && receipt.data.result.operationId !== input.operationId) return 'obsolete'
  if (['COMPLETED', 'CANCELLED', 'FAILED', 'AT_JOIN'].includes(input.status)) return 'obsolete'
  if (!receipt.success) return 'retry'
  if (input.currentStepId !== input.waitStepId) return 'obsolete'
  if (input.waitAttemptStatus === 'COMPLETED') return 'obsolete'
  if (input.status === 'PAUSED' && input.waitAttemptStatus === 'ACTIVE') return 'ready'
  return 'retry'
}
