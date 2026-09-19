import { asValue } from 'awilix'
import type { AppContainer } from '@open-mercato/shared/lib/di/container'
import type { ActivityContext } from '@open-mercato/core/modules/workflows/lib/activity-executor'

export function register(container: AppContainer) {
  if (process.env.OM_INTEGRATION_TEST !== 'true') return
  container.register({
    'workflowFunction:photographers.synthetic.dispatch': asValue(async (args: unknown, context: ActivityContext) => {
      const { dispatchSyntheticWorkflow } = await import('./lib/synthetic-workflow-runtime')
      return dispatchSyntheticWorkflow(args, context, container)
    }),
  })
}
