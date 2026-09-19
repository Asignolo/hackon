import { createRequestContainer } from '@open-mercato/shared/lib/di/container'
import type { ModuleCli } from '@open-mercato/shared/modules/registry'
import type { CredentialsService } from '@open-mercato/core/modules/integrations/lib/credentials-service'
import type { IntegrationLogService } from '@open-mercato/core/modules/integrations/lib/log-service'
import type { IntegrationStateService } from '@open-mercato/core/modules/integrations/lib/state-service'
import { applyApifyEnvPreset } from './lib/preset'

function parseArgs(args: string[]): { tenantId: string; organizationId: string; force: boolean } | null {
  const values = new Map<string, string>()
  let force = false
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index]
    if (arg === '--force') {
      force = true
      continue
    }
    if ((arg === '--tenant' || arg === '--org') && args[index + 1]) {
      values.set(arg, args[index + 1])
      index += 1
    }
  }
  const tenantId = values.get('--tenant')
  const organizationId = values.get('--org')
  return tenantId && organizationId ? { tenantId, organizationId, force } : null
}

function printHelp(): void {
  console.log('Usage: yarn mercato integration_apify configure-from-env --tenant <id> --org <id> [--force]')
  console.log('Reads OM_INTEGRATION_APIFY_API_TOKEN and optional OM_INTEGRATION_APIFY_ENABLED.')
}

const configureFromEnv: ModuleCli = {
  command: 'configure-from-env',
  async run(args) {
    const options = parseArgs(args)
    if (!options) {
      printHelp()
      return
    }
    const container = await createRequestContainer()
    try {
      const result = await applyApifyEnvPreset({
        credentialsService: container.resolve('integrationCredentialsService') as CredentialsService,
        stateService: container.resolve('integrationStateService') as IntegrationStateService,
        integrationLogService: container.resolve('integrationLogService') as IntegrationLogService,
        scope: { tenantId: options.tenantId, organizationId: options.organizationId },
        force: options.force,
      })
      console.log(
        result.status === 'configured'
          ? `[integration_apify] Configured from environment; enabled=${String(result.enabled)}.`
          : `[integration_apify] Skipped: ${result.reason}`,
      )
    } finally {
      const disposable = container as unknown as { dispose?: () => Promise<void> }
      await disposable.dispose?.()
    }
  },
}

const help: ModuleCli = { command: 'help', run: async () => printHelp() }

export default [configureFromEnv, help]
