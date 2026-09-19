import { registerCommand, type CommandHandler } from '@open-mercato/shared/lib/commands'
import { resolveTranslations } from '@open-mercato/shared/lib/i18n/server'
import { prepareRegistrationCrm } from '../lib/registration-crm'
import { requirePhotographerScope } from '../lib/scope'
import { rawDataEntityId } from '../lib/raw-data-create'
import type { RegistrationCrmResult } from '../data/registration-crm-validators'

export const prepareRegistrationCrmCommand: CommandHandler<unknown, RegistrationCrmResult> = {
  id: 'photographers.registration.prepare_crm',
  isUndoable: false,
  execute: prepareRegistrationCrm,
  async buildLog({ result, ctx }) {
    const { translate } = await resolveTranslations()
    return { actionLabel: translate('photographers.audit.registration.prepare_crm'), resourceKind: rawDataEntityId,
      resourceId: result.registrationId, payload: { __redoInput: {} }, ...await requirePhotographerScope(ctx) }
  },
}

registerCommand(prepareRegistrationCrmCommand)
