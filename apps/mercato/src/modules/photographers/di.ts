import { asValue } from 'awilix'
import type { AppContainer } from '@open-mercato/shared/lib/di/container'
import type { ActivityContext } from '@open-mercato/core/modules/workflows/lib/activity-executor'
import type * as WorkflowExecutor from '@open-mercato/core/modules/workflows/lib/workflow-executor'
import { DEMO_WORKFLOW_ID } from './lib/demo-workflow'

export function register(container: AppContainer) {
  if (container.hasRegistration('workflowExecutor')) {
    const executor = container.resolve<typeof WorkflowExecutor>('workflowExecutor')
    container.register({
      workflowExecutor: asValue({
        ...executor,
        startWorkflow: async (...args: Parameters<typeof executor.startWorkflow>) => {
          if (args[1].workflowId !== DEMO_WORKFLOW_ID) return executor.startWorkflow(...args)
          const { startDemoWorkflowOnce } = await import('./lib/demo-workflow-runtime')
          return startDemoWorkflowOnce(executor, container, ...args)
        },
      }),
    })
  }
  container.register({
    'workflowFunction:photographers.evaluation.request_review': asValue(async (args: unknown, context: ActivityContext) => {
      const { dispatchEvaluationReview } = await import('./lib/evaluation-review-workflow')
      return dispatchEvaluationReview(args, context, container)
    }),
    'workflowFunction:photographers.evaluation.score': asValue(async (args: unknown, context: ActivityContext) => {
      const { scorePhotographerWorkflow } = await import('./lib/evaluation-scoring-workflow')
      return scorePhotographerWorkflow(args, context, container)
    }),
    'workflowFunction:photographers.o1.prepare': asValue(async (args: unknown, context: ActivityContext) => {
      const { preparePortfolioDiscoveryWorkflow } = await import('./lib/portfolio-discovery-runtime')
      return preparePortfolioDiscoveryWorkflow(args, context, container)
    }),
    'workflowFunction:photographers.o1.dispatch': asValue(async (args: unknown, context: ActivityContext) => {
      const { dispatchPortfolioDiscoveryWorkflow } = await import('./lib/portfolio-discovery-runtime')
      return dispatchPortfolioDiscoveryWorkflow(args, context, container)
    }),
    'workflowFunction:photographers.o1.store_result': asValue(async (args: unknown, context: ActivityContext) => {
      const { storePortfolioDiscoveryWorkflowResult } = await import('./lib/portfolio-discovery-workflow')
      return storePortfolioDiscoveryWorkflowResult(args, context, container)
    }),
    'workflowFunction:photographers.o2.store_result': asValue(async (args: unknown, context: ActivityContext) => {
      const { storeTraceFinderWorkflowResult } = await import('./lib/trace-finder-workflow')
      return storeTraceFinderWorkflowResult(args, context, container)
    }),
    photographerRegistrationPrepare: asValue(async (input: unknown) => {
      const { prepareRegistrationFromEvent } = await import('./lib/registration-crm-event')
      await prepareRegistrationFromEvent(input, container)
    }),
    'workflowFunction:photographers.demo.finalize': asValue(async (args: unknown, context: ActivityContext) => {
      const { finalizePhotographerDemoWorkflow } = await import('./lib/demo-workflow-runtime')
      return finalizePhotographerDemoWorkflow(args, context, container)
    }),
    photographerDemoDispositionEnqueue: asValue(async (input: { tenantId: string; organizationId: string; proposalId: string }) => {
      const { enqueuePhotographerDemoDisposition } = await import('./lib/demo-workflow-runtime')
      await enqueuePhotographerDemoDisposition(input, container)
    }),
    'workflowFunction:photographers.demo.dispatch': asValue(async (args: unknown, context: ActivityContext) => {
      const { dispatchPhotographerDemoWorkflow } = await import('./lib/demo-workflow-runtime')
      return dispatchPhotographerDemoWorkflow(args, context, container)
    }),
  })
  if (process.env.OM_INTEGRATION_TEST !== 'true') return
  container.register({
    'workflowFunction:photographers.synthetic.dispatch': asValue(async (args: unknown, context: ActivityContext) => {
      const { dispatchSyntheticWorkflow } = await import('./lib/synthetic-workflow-runtime')
      return dispatchSyntheticWorkflow(args, context, container)
    }),
  })
}
