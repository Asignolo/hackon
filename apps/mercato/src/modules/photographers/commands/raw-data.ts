import { registerCommand, type CommandHandler } from '@open-mercato/shared/lib/commands'
import { resolveTranslations } from '@open-mercato/shared/lib/i18n/server'
import { requirePhotographerScope } from '../lib/scope'
import { createRawDataRecord, rawDataEntityId } from '../lib/raw-data-create'

export { createRawDataRecord, rawDataEntityId } from '../lib/raw-data-create'

export const createRawDataCommand: CommandHandler<unknown, { id: string }> = {
  id: 'photographers.raw_data.create',
  isUndoable: false,
  execute: (input, ctx) => createRawDataRecord(input, ctx),
  buildLog: async ({ result, ctx }) => {
    const { translate } = await resolveTranslations()
    return {
      actionLabel: translate('photographers.audit.raw_data.create'),
      resourceKind: rawDataEntityId,
      resourceId: result.id,
      payload: { __redoInput: {} },
      ...await requirePhotographerScope(ctx),
    }
  },
}

registerCommand(createRawDataCommand)
