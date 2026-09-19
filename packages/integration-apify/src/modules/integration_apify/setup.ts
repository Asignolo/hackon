import type { ModuleSetupConfig } from '@open-mercato/shared/modules/setup'
import { createLogger } from '@open-mercato/shared/lib/logger'
import { getTelemetryRuntime } from '@open-mercato/shared/lib/telemetry/runtime'
import type { CredentialsService } from '@open-mercato/core/modules/integrations/lib/credentials-service'
import type { IntegrationLogService } from '@open-mercato/core/modules/integrations/lib/log-service'
import type { IntegrationStateService } from '@open-mercato/core/modules/integrations/lib/state-service'
import { applyApifyEnvPreset } from './lib/preset'

const logger = createLogger('integration_apify').child({ component: 'setup' })

export const setup: ModuleSetupConfig = {
  defaultRoleFeatures: {},
  async seedDefaults({ organizationId, tenantId, container }) {
    try {
      await applyApifyEnvPreset({
        credentialsService: container.resolve('integrationCredentialsService') as CredentialsService,
        stateService: container.resolve('integrationStateService') as IntegrationStateService,
        integrationLogService: container.resolve('integrationLogService') as IntegrationLogService,
        scope: { tenantId, organizationId },
      })
    } catch (error) {
      logger.error('Apify environment preset failed during default seeding.', {
        err: error,
        tenantId,
        organizationId,
      })
      getTelemetryRuntime()?.reportError(error, {
        module: 'integration_apify',
        code: 'integration_apify.preset_failed',
        attributes: { tenantId, organizationId },
      })
    }
  },
}

export default setup
