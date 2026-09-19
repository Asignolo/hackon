import type { ModuleSetupConfig } from '@open-mercato/shared/modules/setup'
import { installHiddenPotential } from './lib/install-hidden-potential'

export const setup: ModuleSetupConfig = {
  async seedDefaults(context) {
    await installHiddenPotential(context)
  },
  defaultRoleFeatures: {
    admin: ['photographers.view', 'photographers.create', 'photographers.evaluations.run', 'photographers.evaluations.view', 'photographers.evaluations.manage'],
  },
}

export default setup
