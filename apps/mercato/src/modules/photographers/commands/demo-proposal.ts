import { registerCommand, type CommandHandler } from '@open-mercato/shared/lib/commands'
import { resolveTranslations } from '@open-mercato/shared/lib/i18n/server'
import { prepareDemoProposal } from '../lib/demo-proposal-prepare'
import { requirePhotographerScope } from '../lib/scope'

export const demoReviewPrepareCommand: CommandHandler<unknown, Awaited<ReturnType<typeof prepareDemoProposal>>> = {
  id: 'photographers.demo.review.prepare', isUndoable: false,
  execute: prepareDemoProposal,
  async buildLog({ result, ctx }) {
    const { translate } = await resolveTranslations()
    return { ...await requirePhotographerScope(ctx), actionLabel: translate('photographers.demo.audit.phase'), resourceKind: 'photographers:demo_publication', resourceId: result.invocationId, snapshotAfter: result, payload: { __redoInput: {} } }
  },
}
registerCommand(demoReviewPrepareCommand)
