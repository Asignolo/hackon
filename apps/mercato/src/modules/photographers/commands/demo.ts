import { registerCommand, type CommandBus, type CommandHandler } from '@open-mercato/shared/lib/commands'
import { resolveTranslations } from '@open-mercato/shared/lib/i18n/server'
import { demoRequestSchema, demoStartRequestSchema, type DemoExecution } from '../data/demo-api-validators'
import { authorizeDemo } from '../lib/demo-api'
import type { PreparedPhotographerDemo } from '../data/demo-workflow-validators'
import { requirePhotographerScope } from '../lib/scope'
import { assertPhotographerDemoAvailable, startPhotographerDemoWorkflow, reconcilePhotographerDemoExecution } from '../lib/demo-workflow-runtime'

const startDemoCommand: CommandHandler<unknown, DemoExecution> = {
  id: 'photographers.demo.start',
  isUndoable: false,
  async execute(input, ctx) {
    const { requestId, registrationId } = demoStartRequestSchema.parse(input)
    await authorizeDemo(ctx, true)
    await assertPhotographerDemoAvailable(ctx)
    const { prepareRegistrationDemo } = await import('../lib/demo-preparation')
    const prepared = registrationId
      ? await prepareRegistrationDemo(requestId, registrationId, ctx)
      : (await ctx.container.resolve<CommandBus>('commandBus').execute<unknown, PreparedPhotographerDemo>('photographers.demo.prepare', { input: { requestId }, ctx })).result
    return startPhotographerDemoWorkflow(prepared, ctx)
  },
  async buildLog({ result, ctx }) {
    const { translate } = await resolveTranslations()
    return { ...await requirePhotographerScope(ctx), actionLabel: translate('photographers.demo.audit.start'), resourceKind: 'photographers:demo_execution', resourceId: result.executionId, payload: { __redoInput: {} } }
  },
}

const reconcileDemoCommand: CommandHandler<unknown, DemoExecution> = {
  id: 'photographers.demo.reconcile',
  isUndoable: false,
  async execute(input, ctx) {
    const { requestId } = demoRequestSchema.parse(input)
    await authorizeDemo(ctx, true)
    return reconcilePhotographerDemoExecution(requestId, ctx)
  },
  async buildLog({ result, ctx }) {
    const { translate } = await resolveTranslations()
    return { ...await requirePhotographerScope(ctx), actionLabel: translate('photographers.demo.audit.reconcile'), resourceKind: 'photographers:demo_execution', resourceId: result.executionId, payload: { __redoInput: {} } }
  },
}

registerCommand(startDemoCommand)
registerCommand(reconcileDemoCommand)
