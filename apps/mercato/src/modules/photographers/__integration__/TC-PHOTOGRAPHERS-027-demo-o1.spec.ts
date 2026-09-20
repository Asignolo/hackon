import path from 'node:path'
import { createRequire } from 'node:module'
import { pathToFileURL } from 'node:url'
import { randomUUID } from 'node:crypto'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { asValue } from 'awilix'
import { expect, test } from '@playwright/test'
import { z } from 'zod'
import type { QueuedJob } from '@open-mercato/queue'
import type { AgentRunSessionStore } from '@open-mercato/enterprise/modules/agent_orchestrator/lib/runtime/agentRunSessionStore'
import type { OpenCodeRunnerClient } from '@open-mercato/enterprise/modules/agent_orchestrator/lib/runtime/openCodeAgentRunner'
import { apiRequest, getAuthToken } from '@open-mercato/core/helpers/integration/api'
import { apiRequestWithSelectedOrg } from '@open-mercato/core/helpers/integration/authFixtures'
import { withClient } from '@open-mercato/core/helpers/integration/dbFixtures'
import { readJsonSafe } from '@open-mercato/core/helpers/integration/generalFixtures'
import { registrationCrmFixture } from './helpers/registrationCrmFixtures'
import { portfolioDiscoveryInputSchema, portfolioDiscoveryResultSchema } from '../data/portfolio-discovery-validators'
import en from '../i18n/en.json' with { type: 'json' }
import { assessmentResponseSchema } from '../data/assessment-validators'
import { materialResponseSchema } from '../data/material-validators'

export const integrationMeta = { dependsOnModules: ['photographers', 'customers', 'workflows', 'agent_orchestrator', 'agent_examples'] }

const appRoot = path.resolve(process.env.OM_TEST_APP_ROOT?.trim() || path.resolve(process.cwd(), 'apps/mercato'))
const targetRequire = createRequire(path.join(appRoot, 'package.json'))


test.describe('TC-PHOTOGRAPHERS-027: demo persists O1, O2, facts and the existing score', () => {
  for (const scenario of ['complete', 'no_portfolio', 'partial', 'error', 'missing_configuration'] as const) {
    const hasPortfolio = scenario !== 'no_portfolio'
    const failed = scenario === 'error' || scenario === 'missing_configuration'
    test(`registration completes the saved evaluation: ${scenario}`, async ({ request, browser, baseURL }) => {
      const { bootstrapFromAppRoot, compileAppSourceFile } = await import(pathToFileURL(targetRequire.resolve('@open-mercato/shared/lib/bootstrap/dynamicLoader')).href) as typeof import('@open-mercato/shared/lib/bootstrap/dynamicLoader')
      const { createRequestContainer, getDiRegistrars, registerDiRegistrars } = await import(pathToFileURL(targetRequire.resolve('@open-mercato/shared/lib/di/container')).href) as typeof import('@open-mercato/shared/lib/di/container')
      const queues = await import(pathToFileURL(targetRequire.resolve('@open-mercato/queue')).href) as typeof import('@open-mercato/queue')
      const bootstrap = await bootstrapFromAppRoot(appRoot)
      const previousRegistrars = [...getDiRegistrars()]
      const fixture = await registrationCrmFixture(request, ['workflows.*', 'agent_orchestrator.*', 'integration_apify.research', 'configs.manage'])
      const queueBase = await mkdtemp(path.join(tmpdir(), 'photographers-o1-queue-'))
      const previousStrategy = process.env.QUEUE_STRATEGY
      const previousBase = process.env.QUEUE_BASE_DIR
      process.env.QUEUE_STRATEGY = 'local'
      process.env.QUEUE_BASE_DIR = queueBase
      const container = await createRequestContainer()
      const queueName = 'photographers-portfolio-discovery'
      const queue = queues.createModuleQueue<Record<string, unknown>>(queueName, { concurrency: 1 })
      const o2QueueName = 'photographers-apify-research'
      const o2Queue = queues.createModuleQueue<Record<string, unknown>>(o2QueueName, { concurrency: 1 })
      const o2Jobs: QueuedJob<Record<string, unknown>>[] = []
      const observedO2: unknown[] = []
      const marker = randomUUID()
      const sourceUrl = `https://www.instagram.com/fixture_${marker.replaceAll('-', '')}/`
      const input = { firstName: `O1-${marker}`, lastName: 'Fixture', email: `o1-${marker}@example.invalid`, portfolioRaw: hasPortfolio ? sourceUrl : 'brak' }
      const observedInputs: z.infer<typeof portfolioDiscoveryInputSchema>[] = []
      try {
        const admin = await getAuthToken(request, 'superadmin')
        for (const [entityId, fields] of [
          ['photographers:photographer_evaluation_material', ['body']],
          ['agent_orchestrator:agent_run', ['input', 'output']],
          ['agent_orchestrator:agent_tool_call', ['request_summary', 'response_summary']],
        ] as const) {
          const response = await apiRequestWithSelectedOrg(request, 'POST', '/api/entities/encryption', { token: admin, selectedOrgId: fixture.organizationId, data: { entityId, fields: fields.map((field) => ({ field })), isActive: true } })
          expect(response.status(), await response.text()).toBe(200)
        }
        const research = portfolioDiscoveryResultSchema.parse({ kind: 'research', data: {
          schemaVersion: 1, status: 'complete', stopReason: 'search_exhausted',
          portfolio: { kind: hasPortfolio ? 'website_url' : 'missing', originalValue: input.portfolioRaw, normalizedValue: hasPortfolio ? sourceUrl : null, resolvedUrl: hasPortfolio ? sourceUrl : null, status: hasPortfolio ? 'resolved' : 'unresolved' },
          links: [{ type: 'instagram', originalUrl: sourceUrl, url: sourceUrl, confidence: 'unconfirmed', approvalRequired: true, sources: [{ url: sourceUrl, method: 'page_read', evidence: `Synthetic contact ${input.email}` }] }],
          nip: [], city: [], coverage: { website: 'found', contact: 'not_found', instagram: 'not_found', facebook: 'not_found', google_maps: 'not_found', nip: 'not_found' },
          approvalRequired: false, attempts: [{ tool: 'web_search', target: input.email, outcome: 'found', detail: 'Controlled external response for integration verification' }], summary: 'Synthetic discovery result',
        } })
        const client: OpenCodeRunnerClient = {
          createSession: async () => ({ id: randomUUID() }),
          subscribeToEvents: () => () => undefined,
          sendMessage: async (_sessionId, message, options) => {
            expect(['agent_examples_portfolio_reader_o1', 'photographers_apify_link_researcher_o2']).toContain(options?.agent)
            const authorization = /^\[Session Authorization: ([^.]+)\./.exec(message)
            if (!authorization) throw new Error('[internal] Missing test session authorization')
            const agentInput: unknown = JSON.parse(message.slice(message.indexOf('\n\n') + 2))
            const store = container.resolve<AgentRunSessionStore>('agentRunSessionStore')
            if (options?.agent === 'agent_examples_portfolio_reader_o1') {
              observedInputs.push(portfolioDiscoveryInputSchema.parse(agentInput))
              expect(await store.completeOutcome(authorization[1], research)).toBe('completed')
            } else {
              observedO2.push(agentInput)
              expect(agentInput).toEqual({ o1: research.data })
              const saved = await withClient(async (db) => db.query('select id from photographers_evaluation_materials where tenant_id=$1 and organization_id=$2 and kind=$3', [fixture.tenantId, fixture.organizationId, 'traces']))
              expect(saved.rows).toHaveLength(1)
              if (scenario === 'error') {
                expect(await store.completeOutcome(authorization[1], { kind: 'research', data: { schemaVersion: 1, status: 'error', results: [], skipped: [], summary: 'Controlled external Apify failure' } })).toBe('completed')
                return {}
              }
              const observedAt = new Date().toISOString()
              const status = scenario === 'partial' ? 'partial' : 'complete'
              const provider = { ok: true, status, platform: 'instagram', canonicalUrl: sourceUrl, sourceUrl,
                observedAt, actorRunId: 'controlled-apify-run', data: { followersCount: 1250, biography: 'Wedding photographer' }, unavailableFields: [], diagnostics: [] }
              expect(await store.completeOutcome(authorization[1], { kind: 'research', data: {
                schemaVersion: 1, status, results: [{ tool: 'integration_apify.scrape_instagram_profile', url: sourceUrl,
                  confidence: 'unconfirmed', approvalRequired: true, status, actorRunId: provider.actorRunId,
                  observedAt, resultJson: JSON.stringify(provider), error: null }],
                skipped: [], summary: 'Controlled external Apify outcome',
              } })).toBe('completed')
            }
            return {}
          },
        }
        container.register({ openCodeClient: asValue(client) })
        registerDiRegistrars([...previousRegistrars, (requestContainer) => { requestContainer.register({ openCodeClient: asValue(client) }) }])
        const registration = await apiRequest(request, 'POST', '/api/photographers/raw-data', { token: fixture.token, data: input })
        expect(registration.status(), await registration.text()).toBe(201)
        const registrationId = z.object({ id: z.string().uuid() }).parse(await readJsonSafe(registration)).id
        const requestId = randomUUID()
        const started = await apiRequest(request, 'POST', '/api/photographers/demo-evaluations', { token: fixture.token, data: { requestId, registrationId } })
        expect(started.status(), await started.text()).toBe(202)
        const accepted = z.object({ executionId: z.string().uuid() }).parse(await readJsonSafe(started))
        const processWorker = bootstrap.modules.flatMap((module) => module.workers ?? []).find((candidate) => candidate.queue === 'agent-process-executions')
        if (!processWorker) throw new Error('[internal] Process worker was not discovered')
        await processWorker.handler({ id: randomUUID(), payload: { executionId: accepted.executionId } }, { resolve: <Value = unknown>(name: string): Value => container.resolve<Value>(name) })
        const stateResponse = await apiRequest(request, 'GET', `/api/photographers/demo-evaluations/${requestId}`, { token: fixture.token })
        expect(stateResponse.status(), await stateResponse.text()).toBe(200)
        const state = z.object({ workflowInstanceId: z.string().uuid(), evaluationId: z.string().uuid() }).parse(await readJsonSafe(stateResponse))
        const instance = { id: state.workflowInstanceId }
        const evaluationId = state.evaluationId
        const worker = bootstrap.modules.flatMap((module) => module.workers ?? []).find((candidate) => candidate.queue === queueName)
        expect(worker, 'O1 worker is discovered by the application registry').toBeDefined()
        if (!worker) throw new Error('[internal] O1 worker was not discovered')
        const jobs: QueuedJob<Record<string, unknown>>[] = []
        const runQueue = async () => queue.process(async (job, context) => {
          jobs.push(job)
          await worker.handler(job, { ...context, resolve: <Value = unknown>(name: string): Value => container.resolve<Value>(name) })
        })
        await expect.poll(async () => {
          await runQueue()
          const o2Worker = bootstrap.modules.flatMap((module) => module.workers ?? []).find((candidate) => candidate.queue === o2QueueName)
          if (!o2Worker) throw new Error('[internal] O2 worker was not discovered')
          await o2Queue.process(async (job, context) => {
            o2Jobs.push(job)
            const encryptionConfiguration = process.env.TENANT_DATA_ENCRYPTION
            try {
              if (scenario === 'missing_configuration') process.env.TENANT_DATA_ENCRYPTION = 'false'
              await o2Worker.handler(job, { ...context, resolve: <Value = unknown>(name: string): Value => container.resolve<Value>(name) })
            } finally {
              if (encryptionConfiguration === undefined) delete process.env.TENANT_DATA_ENCRYPTION
              else process.env.TENANT_DATA_ENCRYPTION = encryptionConfiguration
            }
          })
          return withClient(async (db) => {
            const state = (await db.query<{ status: string; error_message: string | null; error_details: unknown }>('select status,error_message,error_details from workflow_instances where id=$1 and tenant_id=$2 and organization_id=$3', [instance.id, fixture.tenantId, fixture.organizationId])).rows[0]
            if (state?.status === 'FAILED' && !failed) {
              const runs = await db.query('select status,result_kind,error_message from agent_runs where workflow_instance_id=$1 and tenant_id=$2 and organization_id=$3', [instance.id, fixture.tenantId, fixture.organizationId])
              throw new Error(`[internal] O1 integration failed: ${JSON.stringify({ state, runs: runs.rows })}`)
            }
            return state?.status
          })
        }, { timeout: 45_000 }).toBe(failed ? 'FAILED' : 'COMPLETED')
        expect(observedInputs).toEqual([{ originalPortfolio: input.portfolioRaw, registrationEmail: input.email, firstName: input.firstName, lastName: input.lastName }])
        const rows = await withClient(async (db) => (await db.query<{ id: string; body: string }>('select id,body from photographers_evaluation_materials where evaluation_id=$1 and tenant_id=$2 and organization_id=$3 and kind=$4 order by created_at asc', [evaluationId, fixture.tenantId, fixture.organizationId, 'traces'])).rows)
        expect(rows).toHaveLength(failed ? 1 : 2)
        expect(rows[0].body).not.toContain(marker)
        expect(rows[0].body).not.toContain(sourceUrl)
        const response = await apiRequest(request, 'GET', `/api/photographers/evaluation-materials/${rows[0].id}`, { token: fixture.token })
        expect(response.status(), await response.text()).toBe(200)
        expect(response.headers()['cache-control']).toBe('no-store')
        const material = materialResponseSchema.parse(await readJsonSafe(response))
        expect(material.kind).toBe('traces')
        if (material.kind !== 'traces') throw new Error('[internal] Expected traces material')
        expect(material.registrationId).toBe(registrationId)
        expect(material.data.traces).toHaveLength(1)
        expect(material.data.traces[0]).toMatchObject({ value: sourceUrl, status: 'confirmed', provenance: [{ sourceRef: sourceUrl, value: expect.stringContaining(input.email) }] })
        const finalResponse = await apiRequest(request, 'GET', `/api/photographers/demo-evaluations/${requestId}`, { token: fixture.token })
        expect(await readJsonSafe(finalResponse)).toMatchObject({ status: failed ? 'failed' : 'completed', proposalId: null, o1: { status: 'completed', tracesRef: rows[0].id, nextStage: 'o2', sourcesAccepted: true } })
        const handoffModule = await compileAppSourceFile(path.join(appRoot, 'src/modules/photographers/lib/demo-o1-handoff.ts'), { appRoot, outFile: path.join(appRoot, '.mercato/generated/demo-o1-handoff.integration.mjs') })
        const { readDemoO1Handoff } = await import(pathToFileURL(handoffModule).href) as typeof import('../lib/demo-o1-handoff')
        const handoff = await readDemoO1Handoff(instance.id, { container, auth: { sub: fixture.userId, tenantId: fixture.tenantId, orgId: fixture.organizationId }, selectedOrganizationId: fixture.organizationId, organizationIds: [fixture.organizationId], organizationScope: null })
        expect(handoff.output).toEqual(research)
        expect(handoff.registrationId).toBe(registrationId)
        expect(jobs).toHaveLength(1)
        await worker.handler(jobs[0], { jobId: jobs[0].id, attemptNumber: 2, queueName, resolve: <Value = unknown>(name: string): Value => container.resolve<Value>(name) })
        await withClient(async (db) => {
          const runs = await db.query<{ input: unknown; output: unknown }>('select input,output from agent_runs where workflow_instance_id=$1 and tenant_id=$2 and organization_id=$3', [instance.id, fixture.tenantId, fixture.organizationId])
          expect(runs.rows).toHaveLength(scenario === 'missing_configuration' ? 1 : 2)
          expect(JSON.stringify(runs.rows)).not.toContain(marker)
          for (const table of ['workflow_instances', 'step_instances', 'workflow_events']) {
            const owner = table === 'workflow_instances' ? 'id' : 'workflow_instance_id'
            const state = await db.query(`select * from ${table} where ${owner}=$1 and tenant_id=$2 and organization_id=$3`, [instance.id, fixture.tenantId, fixture.organizationId])
            expect(JSON.stringify(state.rows), `${table} contains no source data`).not.toContain(marker)
          }
          const count = await db.query<{ count: string }>('select count(*) from photographers_evaluation_materials where evaluation_id=$1 and tenant_id=$2 and organization_id=$3', [evaluationId, fixture.tenantId, fixture.organizationId])
          expect(Number(count.rows[0].count)).toBeGreaterThanOrEqual(scenario === 'missing_configuration' ? 1 : 2)
        })
        expect(observedInputs).toHaveLength(1)
        expect(observedO2).toHaveLength(scenario === 'missing_configuration' ? 0 : 1)
        const assessmentResponse = await apiRequest(request, 'GET', `/api/photographers/assessments/${evaluationId}?registrationId=${registrationId}`, { token: fixture.token })
        expect(assessmentResponse.status(), await assessmentResponse.text()).toBe(200)
        const assessment = assessmentResponseSchema.parse(await readJsonSafe(assessmentResponse))
        expect(assessment.registration.id).toBe(registrationId)
        expect(assessment.process.workflowInstanceId).toBe(instance.id)
        expect(assessment.source).toBe('real')
        expect(assessment.research.status).toBe(scenario === 'missing_configuration' ? 'unavailable' : scenario === 'error' ? 'failed' : scenario === 'partial' ? 'partial' : 'completed')
        if (failed) {
          expect(assessment.process.status).toBe('failed')
          expect(assessment.materials.score.status).toBe('missing')
        } else {
          expect(assessment.materials.facts.status).toBe('available')
          expect(assessment.materials.score.status).toBe('available')
          expect(assessment.materials.facts.data?.facts).toEqual(expect.arrayContaining([
            expect.objectContaining({ key: 'instagramFollowers', value: 1250, readStatus: scenario === 'partial' ? 'partial' : 'ok' }),
            expect.objectContaining({ key: 'category', value: 'wedding' }),
          ]))
          expect(assessment.materials.facts.data?.facts.some((fact) => fact.key === 'googleMapsReviews')).toBe(false)
          expect(assessment.materials.score.data?.evaluationId).toBe(evaluationId)
          expect(assessment.materials.score.data?.factsRef).toBe(assessment.materials.facts.id)
          expect(assessment.materials.facts.data?.tracesRef).toBe(assessment.materials.traces.id)
          expect(assessment.materials.score.data?.category).toBe('wedding')
          expect(assessment.materials.score.data?.unknownFactKeys).toContain('googleMapsReviews')
        }
        if (scenario === 'complete') {
          if (!baseURL) throw new Error('[internal] Missing integration base URL')
          const browserContext = await browser.newContext()
          try {
            await browserContext.addCookies([
              { name: 'auth_token', value: fixture.token, url: baseURL, httpOnly: true },
              { name: 'om_selected_org', value: fixture.organizationId, url: baseURL },
              { name: 'om_selected_tenant', value: fixture.tenantId, url: baseURL },
              { name: 'locale', value: 'en', url: baseURL },
              { name: 'om_demo_notice_ack', value: 'ack', url: baseURL },
              { name: 'om_cookie_notice_ack', value: 'ack', url: baseURL },
              { name: 'om_feedback_suppress', value: '1', url: baseURL },
            ])
            const page = await browserContext.newPage()
            await page.goto(`${baseURL}/backend/photographers/assessment?evaluationId=${evaluationId}&registrationId=${registrationId}`)
            await expect(page.getByRole('region', { name: en['photographers.assessment.facts'], exact: true })).toContainText(/1[,\s]?250/)
            await expect(page.getByRole('region', { name: en['photographers.assessment.score'], exact: true })).toContainText(en['photographers.materials.values.wedding'])
            await page.screenshot({ path: test.info().outputPath('saved-assessment.png'), fullPage: true })
          } finally { await browserContext.close() }
        }
        const materialIds = () => withClient(async (db) => (await db.query<{ id: string }>('select id from photographers_evaluation_materials where evaluation_id=$1 order by id', [evaluationId])).rows)
        const beforeReplay = await materialIds()
        const o2Worker = bootstrap.modules.flatMap((module) => module.workers ?? []).find((candidate) => candidate.queue === o2QueueName)!
        expect(o2Jobs).toHaveLength(1)
        await o2Worker.handler(o2Jobs[0], { jobId: o2Jobs[0].id, attemptNumber: 2, queueName: o2QueueName, resolve: <Value = unknown>(name: string): Value => container.resolve<Value>(name) })
        expect(await materialIds()).toEqual(beforeReplay)
        expect(observedO2).toHaveLength(scenario === 'missing_configuration' ? 0 : 1)
      } finally {
        registerDiRegistrars(previousRegistrars)
        await queue.close()
        await o2Queue.close()
        await container.dispose()
        if (previousStrategy === undefined) delete process.env.QUEUE_STRATEGY; else process.env.QUEUE_STRATEGY = previousStrategy
        if (previousBase === undefined) delete process.env.QUEUE_BASE_DIR; else process.env.QUEUE_BASE_DIR = previousBase
        await rm(queueBase, { recursive: true, force: true })
        await withClient(async (db) => {
          for (const table of ['agent_tool_calls', 'agent_spans', 'agent_guardrail_checks', 'agent_run_sessions', 'agent_runs', 'workflow_events', 'step_instances', 'workflow_branch_instances', 'workflow_instances', 'workflow_definitions', 'photographers_evaluation_materials', 'process_instances', 'process_definitions', 'scheduled_jobs']) {
            await db.query(`delete from ${table} where tenant_id=$1 and organization_id=$2`, [fixture.tenantId, fixture.organizationId])
          }
        })
        await fixture.cleanup()
      }
    })
  }
})
