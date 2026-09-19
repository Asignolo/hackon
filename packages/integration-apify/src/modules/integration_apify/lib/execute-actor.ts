import type { AwilixContainer } from 'awilix'
import { createLogger } from '@open-mercato/shared/lib/logger'
import { getTelemetryRuntime } from '@open-mercato/shared/lib/telemetry/runtime'
import type { CredentialsService } from '@open-mercato/core/modules/integrations/lib/credentials-service'
import type { IntegrationLogService } from '@open-mercato/core/modules/integrations/lib/log-service'
import type { IntegrationStateService } from '@open-mercato/core/modules/integrations/lib/state-service'
import type { McpToolContext } from '@open-mercato/ai-assistant/modules/ai_assistant/lib/types'
import { APIFY_INTEGRATION_ID } from '../integration'
import type { ActorCatalogEntry, ActorTarget } from './actor-catalog'
import { cleanupApifyRunStorage } from './cleanup'
import { createApifyMutationClient, createApifyReadClient, type ApifyClientLike, type ApifyRunRecord } from './client'
import { readApifyConfig } from './config'
import { diagnostic } from './diagnostics'
import { ApifyQuotaError, reserveApifyQuota } from './quota'
import { errorResult, type ApifyResearchResult } from './result'

type AgentRunSessionStoreLike = {
  resolveActiveRunId(sessionToken: string): Promise<string | null>
}

type ExecuteDependencies = {
  createMutationClient?: (credentials: Record<string, unknown>) => ApifyClientLike
  createReadClient?: (credentials: Record<string, unknown>) => ApifyClientLike
  now?: () => number
  env?: NodeJS.ProcessEnv
}

export type ApifyNormalizeContext = {
  actorRunId: string
  sourceUrl: string | null
  items: Array<Record<string, unknown>>
}

const logger = createLogger('integration_apify').child({ component: 'execute_actor' })
const TERMINAL_STATUSES = new Set(['SUCCEEDED', 'FAILED', 'ABORTED', 'TIMED-OUT'])

function resolveRequired<T>(container: AwilixContainer, key: string): T | null {
  try {
    if (typeof container.hasRegistration === 'function' && !container.hasRegistration(key)) return null
    return (container.resolve(key) as T | undefined) ?? null
  } catch {
    return null
  }
}

async function resolveAgentRunId(ctx: McpToolContext): Promise<string | null> {
  if (!ctx.sessionId) return null
  const store = resolveRequired<AgentRunSessionStoreLike>(ctx.container, 'agentRunSessionStore')
  if (!store) return null
  try {
    return await store.resolveActiveRunId(ctx.sessionId)
  } catch {
    return null
  }
}

function mapUpstreamError(error: unknown): 'upstream_unauthorized' | 'upstream_forbidden' | 'upstream_rate_limited' | 'upstream_unavailable' {
  const statusCode = error && typeof error === 'object'
    ? (error as { statusCode?: unknown }).statusCode
    : undefined
  if (statusCode === 401) return 'upstream_unauthorized'
  if (statusCode === 403) return 'upstream_forbidden'
  if (statusCode === 429) return 'upstream_rate_limited'
  return 'upstream_unavailable'
}

function safeMessage(code: string): string {
  const messages: Record<string, string> = {
    not_configured: 'Apify is not configured for this tenant.',
    run_context_missing: 'An active agent run is required for paid research.',
    budget_exceeded: 'The configured research budget or quota is exhausted.',
    concurrency_limited: 'The configured research concurrency limit is reached.',
    upstream_unauthorized: 'Apify rejected the configured credentials.',
    upstream_forbidden: 'Apify denied this research request.',
    upstream_rate_limited: 'Apify rate-limited this research request.',
    upstream_unavailable: 'Apify could not complete this research request.',
    timeout: 'The Apify research run exceeded its deadline.',
    no_data: 'Apify returned no data for this target.',
  }
  return messages[code] ?? 'Apify research could not be completed.'
}

async function reportFailure(input: {
  container: AwilixContainer
  ctx: McpToolContext
  agentRunId: string | null
  actorRunId: string | null
  code: string
  error?: unknown
}): Promise<void> {
  const scope = input.ctx.tenantId && input.ctx.organizationId
    ? { tenantId: input.ctx.tenantId, organizationId: input.ctx.organizationId }
    : null
  if (scope) {
    const logService = resolveRequired<IntegrationLogService>(input.container, 'integrationLogService')
    await logService?.write({
      integrationId: APIFY_INTEGRATION_ID,
      runId: input.agentRunId,
      scopeEntityType: 'apify_actor_run',
      scopeEntityId: input.actorRunId,
      level: 'error',
      message: safeMessage(input.code),
      code: `integration_apify.${input.code}`,
    }, scope).catch(() => undefined)
  }
  if (input.error) {
    getTelemetryRuntime()?.reportError(input.error, {
      module: 'integration_apify',
      code: `integration_apify.${input.code}`,
      attributes: {
        tenantId: input.ctx.tenantId ?? undefined,
        organizationId: input.ctx.organizationId ?? undefined,
        agentRunId: input.agentRunId ?? undefined,
        actorRunId: input.actorRunId ?? undefined,
      },
    })
  }
}

async function pollKnownRun(
  client: ApifyClientLike,
  actorRunId: string,
  deadline: number,
  now: () => number,
): Promise<ApifyRunRecord | null> {
  while (now() < deadline) {
    const remainingSeconds = Math.max(1, Math.ceil((deadline - now()) / 1000))
    const run = await client.run(actorRunId).get({ waitForFinish: Math.min(60, remainingSeconds) })
    if (!run) return null
    if (TERMINAL_STATUSES.has(run.status)) return run
  }
  return null
}

export async function executeApifyActor<T>(input: {
  ctx: McpToolContext
  entry: ActorCatalogEntry
  target: ActorTarget
  platform: ApifyResearchResult<T>['platform']
  canonicalUrl?: string | null
  sourceUrl?: string | null
  normalize(context: ApifyNormalizeContext): ApifyResearchResult<T>
  dependencies?: ExecuteDependencies
}): Promise<ApifyResearchResult<T>> {
  const { ctx } = input
  const sourceUrl = input.sourceUrl ?? input.canonicalUrl ?? null
  if (!ctx.tenantId || !ctx.organizationId) {
    return errorResult({ platform: input.platform, sourceUrl, code: 'run_context_missing', message: safeMessage('run_context_missing') })
  }
  const agentRunId = await resolveAgentRunId(ctx)
  if (!agentRunId) {
    await reportFailure({ container: ctx.container, ctx, agentRunId: null, actorRunId: null, code: 'run_context_missing' })
    return errorResult({ platform: input.platform, sourceUrl, code: 'run_context_missing', message: safeMessage('run_context_missing') })
  }

  const config = readApifyConfig(input.dependencies?.env)
  const chargeLimitUsd = Math.max(config.maxChargeUsd, input.entry.minimumChargeUsd)
  const reservedMilliUsd = Math.ceil(chargeLimitUsd * 1000)
  let lease
  try {
    lease = await reserveApifyQuota({
      container: ctx.container,
      agentRunId,
      tenantId: ctx.tenantId,
      reservedMilliUsd,
      config,
    })
  } catch (error) {
    const code = error instanceof ApifyQuotaError ? error.code : 'budget_exceeded'
    await reportFailure({ container: ctx.container, ctx, agentRunId, actorRunId: null, code, error })
    return errorResult({ platform: input.platform, sourceUrl, code, message: safeMessage(code) })
  }

  const now = input.dependencies?.now ?? Date.now
  const deadline = now() + config.timeoutSeconds * 1000
  const createMutationClient = input.dependencies?.createMutationClient ?? createApifyMutationClient
  const createReadClient = input.dependencies?.createReadClient ?? createApifyReadClient
  let actorRun: ApifyRunRecord | null = null
  let mutationClient: ApifyClientLike | null = null
  let resultForCleanup: ApifyResearchResult<T> | null = null
  try {
    const stateService = resolveRequired<IntegrationStateService>(ctx.container, 'integrationStateService')
    const credentialsService = resolveRequired<CredentialsService>(ctx.container, 'integrationCredentialsService')
    if (!stateService || !credentialsService) {
      return errorResult({ platform: input.platform, sourceUrl, code: 'not_configured', message: safeMessage('not_configured') })
    }
    const scope = { tenantId: ctx.tenantId, organizationId: ctx.organizationId, userId: null }
    if (!(await stateService.isEnabled(APIFY_INTEGRATION_ID, scope))) {
      return errorResult({ platform: input.platform, sourceUrl, code: 'not_configured', message: safeMessage('not_configured') })
    }
    const credentials = await credentialsService.resolve(APIFY_INTEGRATION_ID, scope)
    if (!credentials) {
      return errorResult({ platform: input.platform, sourceUrl, code: 'not_configured', message: safeMessage('not_configured') })
    }

    mutationClient = createMutationClient(credentials)
    const readClient = createReadClient(credentials)
    actorRun = await mutationClient.actor(input.entry.actorId).start(input.entry.buildInput(input.target), {
      build: input.entry.build,
      maxItems: Math.min(input.entry.maxItems, config.maxItems),
      maxTotalChargeUsd: chargeLimitUsd,
      timeout: config.timeoutSeconds,
    })
    const completed = await pollKnownRun(readClient, actorRun.id, deadline, now)
    if (!completed) {
      await mutationClient.run(actorRun.id).abort().catch(() => undefined)
      return errorResult({ platform: input.platform, sourceUrl, actorRunId: actorRun.id, code: 'timeout', message: safeMessage('timeout') })
    }
    actorRun = completed
    if (completed.status !== 'SUCCEEDED') {
      const code = completed.status === 'TIMED-OUT' ? 'timeout' : 'upstream_unavailable'
      return errorResult({ platform: input.platform, sourceUrl, actorRunId: completed.id, code, message: safeMessage(code) })
    }
    if (!completed.defaultDatasetId) {
      return errorResult({ platform: input.platform, sourceUrl, actorRunId: completed.id, code: 'no_data', message: safeMessage('no_data') })
    }
    const maximumItems = Math.min(input.entry.maxItems, config.maxItems)
    const dataset = await readClient.dataset(completed.defaultDatasetId).listItems({ limit: maximumItems + 1 })
    const result = input.normalize({
      actorRunId: completed.id,
      sourceUrl,
      items: dataset.items.slice(0, maximumItems),
    })
    if (dataset.items.length > maximumItems) {
      result.status = result.status === 'error' ? result.status : 'partial'
      result.ok = result.status !== 'error'
      result.diagnostics.push(diagnostic('partial_dataset', 'warning', 'Apify returned more records than the configured limit.', true))
    }
    resultForCleanup = result
    return result
  } catch (error) {
    const code = mapUpstreamError(error)
    await reportFailure({ container: ctx.container, ctx, agentRunId, actorRunId: actorRun?.id ?? null, code, error })
    logger.warn('Apify actor execution failed.', {
      code,
      tenantId: ctx.tenantId,
      organizationId: ctx.organizationId,
      agentRunId,
      actorRunId: actorRun?.id,
    })
    return errorResult({ platform: input.platform, sourceUrl, actorRunId: actorRun?.id, code, message: safeMessage(code) })
  } finally {
    if (actorRun && mutationClient) {
      const cleanup = await cleanupApifyRunStorage(mutationClient, actorRun)
      if (cleanup.failed > 0) {
        if (resultForCleanup) {
          resultForCleanup.status = resultForCleanup.status === 'error' ? 'error' : 'partial'
          resultForCleanup.diagnostics.push(
            diagnostic('cleanup_failed', 'warning', 'Apify storage cleanup was incomplete.', true),
          )
        }
        await reportFailure({
          container: ctx.container,
          ctx,
          agentRunId,
          actorRunId: actorRun.id,
          code: 'cleanup_failed',
          error: new Error('[internal] Apify run storage cleanup failed.'),
        })
      }
    }
    await lease.release()
  }
}
