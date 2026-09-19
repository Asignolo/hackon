import { parseBooleanToken } from '@open-mercato/shared/lib/boolean'
import type { IntegrationScope } from '@open-mercato/shared/modules/integrations/types'
import type { CredentialsService } from '@open-mercato/core/modules/integrations/lib/credentials-service'
import type { IntegrationLogService } from '@open-mercato/core/modules/integrations/lib/log-service'
import type { IntegrationStateService } from '@open-mercato/core/modules/integrations/lib/state-service'
import { APIFY_INTEGRATION_ID } from '../integration'

export type ApplyApifyPresetResult =
  | { status: 'skipped'; reason: string }
  | { status: 'configured'; enabled: boolean }

export function readApifyEnvPreset(env: NodeJS.ProcessEnv = process.env): {
  apiToken: string
  enabled: boolean
} | null {
  const apiToken = env.OM_INTEGRATION_APIFY_API_TOKEN?.trim()
  if (!apiToken) return null
  const parsedEnabled = parseBooleanToken(env.OM_INTEGRATION_APIFY_ENABLED)
  if (env.OM_INTEGRATION_APIFY_ENABLED !== undefined && parsedEnabled === null) {
    throw new Error('[internal] OM_INTEGRATION_APIFY_ENABLED must be a valid boolean token.')
  }
  return { apiToken, enabled: parsedEnabled ?? false }
}

export async function applyApifyEnvPreset(input: {
  credentialsService: CredentialsService
  stateService: IntegrationStateService
  integrationLogService?: IntegrationLogService
  scope: IntegrationScope
  force?: boolean
  env?: NodeJS.ProcessEnv
}): Promise<ApplyApifyPresetResult> {
  const preset = readApifyEnvPreset(input.env)
  if (!preset) {
    return { status: 'skipped', reason: 'No Apify API token was provided in the environment.' }
  }
  const scope = { ...input.scope, userId: null }
  if (!input.force) {
    const existing = await input.credentialsService.getRaw(APIFY_INTEGRATION_ID, scope)
    if (existing) {
      return { status: 'skipped', reason: 'Apify credentials already exist; use --force to replace them.' }
    }
  }
  await input.credentialsService.save(APIFY_INTEGRATION_ID, { apiToken: preset.apiToken }, scope)
  await input.stateService.upsert(APIFY_INTEGRATION_ID, { isEnabled: preset.enabled }, scope)
  if (input.integrationLogService) {
    await input.integrationLogService
      .scoped(APIFY_INTEGRATION_ID, scope)
      .info('Apify integration was preconfigured from environment variables.', {
        enabled: preset.enabled,
      })
  }
  return { status: 'configured', enabled: preset.enabled }
}
