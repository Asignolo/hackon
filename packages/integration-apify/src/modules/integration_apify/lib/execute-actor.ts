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
import { enforceApifyResultSize, errorResult, serializedSize, type ApifyResearchResult } from './result'

type AgentRunSessionStoreLike = {
  resolveActiveRunContext?(sessionToken: string): Promise<{
    runId: string
    tenantId: string
    organizationId: string
  } | null>
}

type ExecuteDependencies = {
  createMutationClient?: (credentials: Record<string, unknown>, timeoutSeconds: number) => ApifyClientLike
  createReadClient?: (credentials: Record<string, unknown>, timeoutSeconds: number) => ApifyClientLike
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
const HEALTH_MAX_AGE_MS = 15 * 60 * 1000
const MAX_HTTP_TIMEOUT_SECONDS = 10
const CLEANUP_TIMEOUT_MS = 10_000
const REPORT_TIMEOUT_MS = 5_000
const POLL_WAIT_SECONDS = 8

class ApifyDeadlineError extends Error {
  constructor(label: string) {
    super(`[internal] Apify ${label} exceeded its deadline.`)
    this.name = 'ApifyDeadlineError'
  }
}

async function withAbsoluteDeadline<T>(
  operation: () => Promise<T>,
  deadline: number,
  now: () => number,
  label: string,
): Promise<T> {
  const remainingMs = deadline - now()
  if (remainingMs <= 0) throw new ApifyDeadlineError(label)
  let timeout: NodeJS.Timeout | undefined
  try {
    return await Promise.race([
      operation(),
      new Promise<T>((_resolve, reject) => {
        timeout = setTimeout(() => reject(new ApifyDeadlineError(label)), remainingMs)
        timeout.unref?.()
      }),
    ])
  } finally {
    if (timeout) clearTimeout(timeout)
  }
}

function resolveRequired<T>(container: AwilixContainer, key: string): T | null {
  try {
    if (typeof container.hasRegistration === 'function' && !container.hasRegistration(key)) return null
    return (container.resolve(key) as T | undefined) ?? null
  } catch {
    return null
  }
}

async function resolveAgentRunContext(ctx: McpToolContext): Promise<{
  runId: string | null
  scopeMismatch: boolean
}> {
  if (!ctx.sessionId || !ctx.tenantId || !ctx.organizationId) return { runId: null, scopeMismatch: false }
  const store = resolveRequired<AgentRunSessionStoreLike>(ctx.container, 'agentRunSessionStore')
  if (!store?.resolveActiveRunContext) return { runId: null, scopeMismatch: false }
  try {
    const active = await store.resolveActiveRunContext(ctx.sessionId)
    if (!active) return { runId: null, scopeMismatch: false }
    if (active.tenantId !== ctx.tenantId || active.organizationId !== ctx.organizationId) {
      return { runId: null, scopeMismatch: true }
    }
    return { runId: active.runId, scopeMismatch: false }
  } catch {
    return { runId: null, scopeMismatch: false }
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

function isResponseTooLarge(error: unknown): boolean {
  if (!error || typeof error !== 'object') return false
  const code = (error as { code?: unknown }).code
  const message = (error as { message?: unknown }).message
  return code === 'ERR_BAD_RESPONSE'
    && typeof message === 'string'
    && message.includes('maxContentLength')
}

function isAmbiguousPaidStartFailure(error: unknown): boolean {
  if (error instanceof ApifyDeadlineError) return true
  if (!error || typeof error !== 'object') return true
  const statusCode = (error as { statusCode?: unknown }).statusCode
  return typeof statusCode !== 'number' || statusCode >= 500
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
    output_truncated: 'The Apify dataset exceeded the safe response size.',
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
  details?: Record<string, unknown>
}): Promise<void> {
  const scope = input.ctx.tenantId && input.ctx.organizationId
    ? { tenantId: input.ctx.tenantId, organizationId: input.ctx.organizationId }
    : null
  if (scope) {
    const logService = resolveRequired<IntegrationLogService>(input.container, 'integrationLogService')
    if (logService) {
      try {
        await withAbsoluteDeadline(
          () => logService.write({
            integrationId: APIFY_INTEGRATION_ID,
            runId: input.agentRunId,
            scopeEntityType: 'apify_actor_run',
            scopeEntityId: input.actorRunId,
            level: 'error',
            message: safeMessage(input.code),
            code: `integration_apify.${input.code}`,
            payload: input.details,
          }, scope),
          Date.now() + REPORT_TIMEOUT_MS,
          Date.now,
          'integration log write',
        )
      } catch (logError) {
        getTelemetryRuntime()?.reportError(logError, {
          module: 'integration_apify',
          code: 'integration_apify.log_write_failed',
          attributes: { tenantId: scope.tenantId, organizationId: scope.organizationId },
        })
      }
    }
  }
  if (input.error) {
    getTelemetryRuntime()?.reportError(new Error(`[internal] Apify research failed with ${input.code}.`), {
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
  logger.warn('Apify research call failed.', {
    callCount: 1,
    status: 'error',
    diagnosticCode: input.code,
    tenantId: input.ctx.tenantId,
    organizationId: input.ctx.organizationId,
    agentRunId: input.agentRunId,
    actorRunId: input.actorRunId,
    ...input.details,
  })
}

async function reportExecutionSummary<T>(input: {
  container: AwilixContainer
  ctx: McpToolContext
  agentRunId: string
  actorRunId: string | null
  result: ApifyResearchResult<T>
  details: Record<string, unknown>
}): Promise<void> {
  const fields = {
    callCount: 1,
    status: input.result.status,
    diagnosticCodes: input.result.diagnostics.map((entry) => entry.code),
    diagnosticCount: input.result.diagnostics.length,
    resultBytes: serializedSize(input.result),
    tenantId: input.ctx.tenantId,
    organizationId: input.ctx.organizationId,
    agentRunId: input.agentRunId,
    actorRunId: input.actorRunId,
    ...input.details,
  }
  if (input.result.ok) logger.info('Apify research call completed.', fields)
  else logger.warn('Apify research call completed with a diagnostic.', fields)
  if (!input.ctx.tenantId || !input.ctx.organizationId) return
  const tenantId = input.ctx.tenantId
  const organizationId = input.ctx.organizationId
  const logService = resolveRequired<IntegrationLogService>(input.container, 'integrationLogService')
  if (!logService) return
  try {
    await withAbsoluteDeadline(
      () => logService.write({
        integrationId: APIFY_INTEGRATION_ID,
        runId: input.agentRunId,
        scopeEntityType: 'apify_actor_run',
        scopeEntityId: input.actorRunId,
        level: input.result.ok ? 'info' : 'warn',
        message: 'Apify research call completed.',
        code: 'integration_apify.call_completed',
        payload: fields,
      }, { tenantId, organizationId }),
      Date.now() + REPORT_TIMEOUT_MS,
      Date.now,
      'integration summary log write',
    )
  } catch (error) {
    getTelemetryRuntime()?.reportError(error, {
      module: 'integration_apify',
      code: 'integration_apify.summary_log_write_failed',
      attributes: {
        tenantId,
        organizationId,
        agentRunId: input.agentRunId,
        actorRunId: input.actorRunId ?? undefined,
      },
    })
  }
}

async function markIntegrationUnhealthy(input: {
  stateService: IntegrationStateService
  scope: { tenantId: string; organizationId: string; userId: null }
  ctx: McpToolContext
  agentRunId: string
  actorRunId: string | null
}): Promise<void> {
  try {
    await withAbsoluteDeadline(
      () => input.stateService.upsert(APIFY_INTEGRATION_ID, {
        lastHealthStatus: 'unhealthy',
        lastHealthCheckedAt: new Date(),
        reauthRequired: true,
      }, input.scope),
      Date.now() + REPORT_TIMEOUT_MS,
      Date.now,
      'health state update',
    )
  } catch (error) {
    getTelemetryRuntime()?.reportError(error, {
      module: 'integration_apify',
      code: 'integration_apify.health_update_failed',
      attributes: {
        tenantId: input.scope.tenantId,
        organizationId: input.scope.organizationId,
        agentRunId: input.agentRunId,
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
    const run = await withAbsoluteDeadline(
      () => client.run(actorRunId).get({ waitForFinish: Math.min(POLL_WAIT_SECONDS, remainingSeconds) }),
      deadline,
      now,
      'run polling',
    )
    if (!run) return null
    if (TERMINAL_STATUSES.has(run.status)) return run
  }
  return null
}

async function abortKnownRun(
  client: ApifyClientLike,
  actorRunId: string,
): Promise<ApifyRunRecord | null> {
  const abortDeadline = Date.now() + CLEANUP_TIMEOUT_MS
  const aborted = await withAbsoluteDeadline(
    () => client.run(actorRunId).abort(),
    abortDeadline,
    Date.now,
    'run abort',
  )
  if (TERMINAL_STATUSES.has(aborted.status)) return aborted
  const confirmed = await pollKnownRun(client, actorRunId, abortDeadline, Date.now)
  return confirmed && TERMINAL_STATUSES.has(confirmed.status) ? confirmed : null
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
  const runContext = await resolveAgentRunContext(ctx)
  const agentRunId = runContext.runId
  if (!agentRunId) {
    await reportFailure({
      container: ctx.container,
      ctx,
      agentRunId: null,
      actorRunId: null,
      code: 'run_context_missing',
      ...(runContext.scopeMismatch
        ? { error: new Error('[internal] Agent run session scope mismatch.') }
        : {}),
    })
    return errorResult({ platform: input.platform, sourceUrl, code: 'run_context_missing', message: safeMessage('run_context_missing') })
  }

  let config
  try {
    config = readApifyConfig(input.dependencies?.env)
  } catch (error) {
    await reportFailure({ container: ctx.container, ctx, agentRunId, actorRunId: null, code: 'budget_exceeded', error })
    return errorResult({
      platform: input.platform,
      sourceUrl,
      code: 'budget_exceeded',
      message: safeMessage('budget_exceeded'),
    })
  }
  const now = input.dependencies?.now ?? Date.now
  const scope = { tenantId: ctx.tenantId, organizationId: ctx.organizationId, userId: null }
  const stateService = resolveRequired<IntegrationStateService>(ctx.container, 'integrationStateService')
  if (!stateService) {
    return errorResult({ platform: input.platform, sourceUrl, code: 'not_configured', message: safeMessage('not_configured') })
  }
  let integrationState
  try {
    integrationState = await stateService.resolveState(APIFY_INTEGRATION_ID, scope)
  } catch (error) {
    await reportFailure({ container: ctx.container, ctx, agentRunId, actorRunId: null, code: 'upstream_unavailable', error })
    return errorResult({
      platform: input.platform,
      sourceUrl,
      code: 'upstream_unavailable',
      message: safeMessage('upstream_unavailable'),
    })
  }
  if (!integrationState.isEnabled) {
    return errorResult({ platform: input.platform, sourceUrl, code: 'not_configured', message: safeMessage('not_configured') })
  }
  const healthCheckedAt = integrationState.lastHealthCheckedAt?.getTime() ?? Number.NaN
  const healthAgeMs = now() - healthCheckedAt
  if (integrationState.lastHealthStatus !== 'healthy' || healthAgeMs < -60_000 || healthAgeMs > HEALTH_MAX_AGE_MS) {
    await reportFailure({ container: ctx.container, ctx, agentRunId, actorRunId: null, code: 'upstream_unavailable' })
    return errorResult({
      platform: input.platform,
      sourceUrl,
      code: 'upstream_unavailable',
      message: safeMessage('upstream_unavailable'),
    })
  }
  if (input.entry.minimumChargeUsd > config.maxChargeUsd) {
    await reportFailure({
      container: ctx.container,
      ctx,
      agentRunId,
      actorRunId: null,
      code: 'budget_exceeded',
      details: {
        toolId: `integration_apify.scrape_${input.entry.toolKey}`,
        pricingModel: input.entry.pricingModel,
        configuredMaxCostMilliUsd: Math.round(config.maxChargeUsd * 1000),
        catalogMinimumCostMilliUsd: Math.ceil(input.entry.minimumChargeUsd * 1000),
      },
    })
    return errorResult({
      platform: input.platform,
      sourceUrl,
      code: 'budget_exceeded',
      message: safeMessage('budget_exceeded'),
    })
  }
  const chargeLimitUsd = config.maxChargeUsd
  const reservedMilliUsd = Math.ceil(chargeLimitUsd * 1000)
  const deadline = now() + config.timeoutSeconds * 1000
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

  const createMutationClient = input.dependencies?.createMutationClient ?? createApifyMutationClient
  const createReadClient = input.dependencies?.createReadClient ?? createApifyReadClient
  let actorRun: ApifyRunRecord | null = null
  let mutationClient: ApifyClientLike | null = null
  let resultForCleanup: ApifyResearchResult<T> | null = null
  let startLatencyMs: number | null = null
  let runLatencyMs: number | null = null
  let pollingLatencyMs: number | null = null
  let normalizationLatencyMs: number | null = null
  let datasetItemCount = 0
  let paidStartAttempted = false
  let retainDistributedLease = false
  try {
    const credentialsService = resolveRequired<CredentialsService>(ctx.container, 'integrationCredentialsService')
    if (!credentialsService) {
      return errorResult({ platform: input.platform, sourceUrl, code: 'not_configured', message: safeMessage('not_configured') })
    }
    const credentials = await withAbsoluteDeadline(
      () => credentialsService.resolve(APIFY_INTEGRATION_ID, scope),
      deadline,
      now,
      'credential resolution',
    )
    if (!credentials) {
      return errorResult({ platform: input.platform, sourceUrl, code: 'not_configured', message: safeMessage('not_configured') })
    }

    const httpTimeoutSeconds = Math.min(MAX_HTTP_TIMEOUT_SECONDS, config.timeoutSeconds)
    const activeMutationClient = createMutationClient(credentials, httpTimeoutSeconds)
    mutationClient = activeMutationClient
    const readClient = createReadClient(credentials, httpTimeoutSeconds)
    const startStartedAt = now()
    paidStartAttempted = true
    actorRun = await withAbsoluteDeadline(
      () => activeMutationClient.actor(input.entry.actorId).start(input.entry.buildInput(input.target), {
        build: input.entry.build,
        maxItems: Math.min(input.entry.maxItems, config.maxItems),
        maxTotalChargeUsd: chargeLimitUsd,
        timeout: config.timeoutSeconds,
      }),
      deadline,
      now,
      'actor start',
    )
    startLatencyMs = Math.max(0, now() - startStartedAt)
    const pollingStartedAt = now()
    const completed = await pollKnownRun(readClient, actorRun.id, deadline, now)
    pollingLatencyMs = Math.max(0, now() - pollingStartedAt)
    runLatencyMs = Math.max(0, now() - startStartedAt)
    if (!completed) {
      throw new ApifyDeadlineError('run polling')
    }
    actorRun = completed
    if (completed.status !== 'SUCCEEDED') {
      const code = completed.status === 'TIMED-OUT' ? 'timeout' : 'upstream_unavailable'
      await reportFailure({
        container: ctx.container,
        ctx,
        agentRunId,
        actorRunId: completed.id,
        code,
        error: new Error(`[internal] Apify actor finished with status ${completed.status}.`),
      })
      resultForCleanup = errorResult({ platform: input.platform, sourceUrl, actorRunId: completed.id, code, message: safeMessage(code) })
      return resultForCleanup
    }
    if (!completed.defaultDatasetId) {
      resultForCleanup = errorResult({ platform: input.platform, sourceUrl, actorRunId: completed.id, code: 'no_data', message: safeMessage('no_data') })
      return resultForCleanup
    }
    const datasetId = completed.defaultDatasetId
    const maximumItems = Math.min(input.entry.maxItems, config.maxItems)
    const dataset = await withAbsoluteDeadline(
      () => readClient.dataset(datasetId).listItems({
        limit: maximumItems + 1,
        fields: input.entry.datasetFields,
      }),
      deadline,
      now,
      'dataset read',
    )
    datasetItemCount = dataset.items.length
    const normalizationStartedAt = now()
    let result = input.normalize({
      actorRunId: completed.id,
      sourceUrl,
      items: dataset.items.slice(0, maximumItems + 1),
    })
    if (dataset.items.length > maximumItems) {
      result.status = result.status === 'error' ? result.status : 'partial'
      result.ok = result.status !== 'error'
      result.diagnostics.push(diagnostic('partial_dataset', 'warning', 'Apify returned more records than the configured limit.', true))
    }
    result = enforceApifyResultSize(result)
    normalizationLatencyMs = Math.max(0, now() - normalizationStartedAt)
    resultForCleanup = result
    return result
  } catch (error) {
    retainDistributedLease = paidStartAttempted && !actorRun && isAmbiguousPaidStartFailure(error)
    const code = error instanceof ApifyDeadlineError
      ? 'timeout'
      : isResponseTooLarge(error) ? 'output_truncated' : mapUpstreamError(error)
    if (actorRun && !TERMINAL_STATUSES.has(actorRun.status) && mutationClient) {
      const activeMutationClient = mutationClient
      const activeActorRunId = actorRun.id
      const aborted = await abortKnownRun(activeMutationClient, activeActorRunId).catch(async (abortError) => {
        await reportFailure({
          container: ctx.container,
          ctx,
          agentRunId,
          actorRunId: actorRun?.id ?? null,
          code: 'cleanup_failed',
          error: abortError,
        })
        return null
      })
      if (aborted) actorRun = aborted
    }
    if (code === 'upstream_unauthorized') {
      await markIntegrationUnhealthy({ stateService, scope, ctx, agentRunId, actorRunId: actorRun?.id ?? null })
    }
    await reportFailure({ container: ctx.container, ctx, agentRunId, actorRunId: actorRun?.id ?? null, code, error })
    resultForCleanup = errorResult({ platform: input.platform, sourceUrl, actorRunId: actorRun?.id, code, message: safeMessage(code) })
    return resultForCleanup
  } finally {
    if (actorRun && mutationClient && TERMINAL_STATUSES.has(actorRun.status)) {
      const finalMutationClient = mutationClient
      const finalActorRun = actorRun
      const cleanup = await withAbsoluteDeadline(
        () => cleanupApifyRunStorage(finalMutationClient, finalActorRun),
        Date.now() + CLEANUP_TIMEOUT_MS,
        Date.now,
        'storage cleanup',
      ).catch(() => ({ attempted: 1, failed: 1 }))
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
    } else if (actorRun && mutationClient && resultForCleanup) {
      resultForCleanup.status = resultForCleanup.status === 'error' ? 'error' : 'partial'
      resultForCleanup.diagnostics.push(
        diagnostic('cleanup_failed', 'warning', 'Apify storage cleanup was skipped because the run could not be stopped.', true),
      )
      await reportFailure({
        container: ctx.container,
        ctx,
        agentRunId,
        actorRunId: actorRun.id,
        code: 'cleanup_failed',
        error: new Error('[internal] Apify storage cleanup skipped for a nonterminal run.'),
      })
    }
    if (resultForCleanup) {
      const boundedResult = enforceApifyResultSize(resultForCleanup)
      if (boundedResult !== resultForCleanup) Object.assign(resultForCleanup, boundedResult)
      const normalizedItemCount = resultForCleanup.data === null
        ? 0
        : Array.isArray((resultForCleanup.data as Record<string, unknown>).sampledReviews)
          ? ((resultForCleanup.data as Record<string, unknown>).sampledReviews as unknown[]).length
          : Array.isArray((resultForCleanup.data as Record<string, unknown>).reviews)
            ? ((resultForCleanup.data as Record<string, unknown>).reviews as unknown[]).length
            : 1
      await reportExecutionSummary({
        container: ctx.container,
        ctx,
        agentRunId,
        actorRunId: actorRun?.id ?? null,
        result: resultForCleanup,
        details: {
          toolId: `integration_apify.scrape_${input.entry.toolKey}`,
          pricingModel: input.entry.pricingModel,
          reservedCostMilliUsd: reservedMilliUsd,
          actualCostMilliUsd: typeof actorRun?.usageTotalUsd === 'number'
            ? Math.round(actorRun.usageTotalUsd * 1000)
            : null,
          startLatencyMs,
          runLatencyMs,
          pollingLatencyMs,
          normalizationLatencyMs,
          upstreamItemCount: datasetItemCount,
          normalizedItemCount,
        },
      })
    }
    await withAbsoluteDeadline(
      () => lease.release({
        retainDistributed: retainDistributedLease || Boolean(actorRun && !TERMINAL_STATUSES.has(actorRun.status)),
      }),
      Date.now() + REPORT_TIMEOUT_MS,
      Date.now,
      'quota lease release',
    ).catch((error) => {
      getTelemetryRuntime()?.reportError(error, {
        module: 'integration_apify',
        code: 'integration_apify.lease_release_failed',
        attributes: {
          tenantId: ctx.tenantId ?? undefined,
          organizationId: ctx.organizationId ?? undefined,
          agentRunId,
        },
      })
    })
  }
}
