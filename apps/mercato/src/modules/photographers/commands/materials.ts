import { registerCommand, type CommandHandler } from '@open-mercato/shared/lib/commands'
import { resolveTranslations } from '@open-mercato/shared/lib/i18n/server'
import { requirePhotographerScope } from '../lib/scope'
import { storeEvaluationMaterial } from '../lib/material-store'

export const storeMaterialCommand: CommandHandler<unknown, { id: string }> = {
  id: 'photographers.evaluation.store_material',
  isUndoable: false,
  execute: storeEvaluationMaterial,
  buildLog: async ({ result, ctx }) => {
    const { translate } = await resolveTranslations()
    return {
      actionLabel: translate('photographers.audit.materials.store'),
      resourceKind: 'photographers:evaluation_material',
      resourceId: result.id,
      payload: { __redoInput: {} },
      ...await requirePhotographerScope(ctx),
    }
  },
}

registerCommand(storeMaterialCommand)
