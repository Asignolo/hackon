import path from 'node:path'
import { createRequire } from 'node:module'
import { pathToFileURL } from 'node:url'
import { randomUUID } from 'node:crypto'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import type { QueuedJob } from '@open-mercato/queue'
import { expect, test } from '@playwright/test'
import { z } from 'zod'
import type { EntityManager } from '@mikro-orm/postgresql'
import type { CommandBus, CommandRuntimeContext } from '@open-mercato/shared/lib/commands'
import type * as WorkflowExecutor from '@open-mercato/core/modules/workflows/lib/workflow-executor'
import { apiRequest, getAuthToken } from '@open-mercato/core/helpers/integration/api'
import { apiRequestWithSelectedOrg } from '@open-mercato/core/helpers/integration/authFixtures'
import { withClient } from '@open-mercato/core/helpers/integration/dbFixtures'
import { readJsonSafe } from '@open-mercato/core/helpers/integration/generalFixtures'
import { registrationCrmFixture } from './helpers/registrationCrmFixtures'
import { DEFAULT_HIDDEN_POTENTIAL_RULES } from '../lib/rules-config'
import { proposalReviewMaterialsResponseSchema } from '../data/proposal-review-validators'

export const integrationMeta = { dependsOnModules: ['photographers', 'customers', 'workflows', 'agent_orchestrator'] }
const appRoot = path.resolve(process.env.OM_TEST_APP_ROOT?.trim() || path.resolve(process.cwd(), 'apps/mercato'))
const targetRequire = createRequire(path.join(appRoot, 'package.json'))
const skeleton: typeof import('../workflow-definitions/hidden-potential.v1.json') = targetRequire('./src/modules/photographers/workflow-definitions/hidden-potential.v1.json')

test.describe('TC-PHOTOGRAPHERS-026: flagged score reaches Caseload', () => {
  for (const scenario of ['flagged', 'unflagged']) {
    test(`routes the saved score without executing a decision: ${scenario}`, async ({ request, page, baseURL }, testInfo) => {
      const { bootstrapFromAppRoot } = await import(pathToFileURL(targetRequire.resolve('@open-mercato/shared/lib/bootstrap/dynamicLoader')).href) as typeof import('@open-mercato/shared/lib/bootstrap/dynamicLoader')
      const { createRequestContainer } = await import(pathToFileURL(targetRequire.resolve('@open-mercato/shared/lib/di/container')).href) as typeof import('@open-mercato/shared/lib/di/container')
      const bootstrap = await bootstrapFromAppRoot(appRoot)
      const fixture = await registrationCrmFixture(request, ['workflows.*', 'agent_orchestrator.*'])
      const queues = await import(pathToFileURL(targetRequire.resolve('@open-mercato/queue')).href) as typeof import('@open-mercato/queue')
      const queueBase = await mkdtemp(path.join(tmpdir(), 'photographers-review-queue-'))
      const previousStrategy = process.env.QUEUE_STRATEGY
      const previousBase = process.env.QUEUE_BASE_DIR
      process.env.QUEUE_STRATEGY = 'local'
      process.env.QUEUE_BASE_DIR = queueBase
      const container = await createRequestContainer()
      const queueName = 'photographers-evaluation-review'
      const queue = queues.createModuleQueue<Record<string, unknown>>(queueName, { concurrency: 1 })
      try {
        const admin = await getAuthToken(request, 'superadmin')
        const encryption = await apiRequestWithSelectedOrg(request, 'POST', '/api/entities/encryption', { token: admin, selectedOrgId: fixture.organizationId, data: { entityId: 'photographers:photographer_evaluation_material', fields: [{ field: 'body' }], isActive: true } })
        expect(encryption.status(), await encryption.text()).toBe(200)
        const registration = await apiRequest(request, 'POST', '/api/photographers/raw-data', { token: fixture.token, data: { firstName: 'Scoring', lastName: 'Fixture', email: `score-${randomUUID()}@example.invalid`, portfolioRaw: 'brak' } })
        expect(registration.status(), await registration.text()).toBe(201)
        const registrationId = z.object({ id: z.string().uuid() }).parse(await readJsonSafe(registration)).id
        const crm = await apiRequest(request, 'POST', `/api/photographers/registrations/${registrationId}/crm`, { token: fixture.token, data: {} })
        expect(crm.status(), await crm.text()).toBe(200)
        const owners = z.object({ photographerId: z.string().uuid(), personId: z.string().uuid(), dealId: z.string().uuid() }).parse(await readJsonSafe(crm))
        const evaluationId = randomUUID()
        const evaluatedAt = '2026-09-19T12:00:00Z'
        const sourceRef = `https://example.invalid/registry/${randomUUID()}`
        const traceId = randomUUID()
        const commandBus = container.resolve<CommandBus>('commandBus')
        const ctx: CommandRuntimeContext = { container, auth: { sub: fixture.userId, tenantId: fixture.tenantId, orgId: fixture.organizationId }, selectedOrganizationId: fixture.organizationId, organizationIds: [fixture.organizationId], organizationScope: null }
        const store = async (material: unknown) => {
          const saved = await commandBus.execute<unknown, { id: string }>('photographers.evaluation.store_material', { input: { operationId: randomUUID(), snapshot: { ...owners, registrationId, material } }, ctx })
          return saved.result.id
        }
        const tracesRef = await store({ kind: 'traces', data: { schemaVersion: 1, evaluationId, evaluatedAt, discoveryStatus: 'complete', traces: [{ schemaVersion: 1, id: traceId, kind: 'registry', value: sourceRef, status: 'confirmed', provenance: [{ value: 'Owned test evidence', sourceRef, observedAt: evaluatedAt }], observedAt: evaluatedAt, candidateIds: [] }] } })
        const factsRef = await store({ kind: 'facts', data: { schemaVersion: 1, evaluationId, evaluatedAt, tracesRef, facts: [
          { key: 'nipConfirmed', value: true }, { key: 'businessStartedAt', value: '2020-01-01T00:00:00Z' },
          { key: 'vatStatus', value: 'active' }, { key: 'photographicPkd', value: true },
          { key: 'businessStatus', value: scenario === 'flagged' ? 'suspended' : 'active' },
        ].map((fact) => ({ ...fact, schemaVersion: 1, state: 'known', traceId, sourceRef, observedAt: evaluatedAt, readStatus: 'ok', owner: 'registry' })) } })
        const stepIds = ['start', 'score', 'disposition', 'review', 'end']
        const definition = { ...skeleton, enabled: true, version: Math.floor(Date.now() / 1000), workflowName: 'QA flagged score slice', definition: { ...skeleton.definition,
          steps: skeleton.definition.steps.filter((step) => stepIds.includes(step.stepId)),
          transitions: [
            { transitionId: 'start_score_test', fromStepId: 'start', toStepId: 'score', trigger: 'auto' },
            ...skeleton.definition.transitions.filter((route) => ['score_disposition_18', 'disposition_review_19'].includes(route.transitionId)),
            { transitionId: 'review_end_test', fromStepId: 'review', toStepId: 'end', trigger: 'manual' },
          ],
        } }
        const { createWorkflowDefinitionInputCheckedSchema } = await import(pathToFileURL(targetRequire.resolve('@open-mercato/core/modules/workflows/data/validators')).href) as typeof import('@open-mercato/core/modules/workflows/data/validators')
        createWorkflowDefinitionInputCheckedSchema.parse(definition)
        await withClient(async (db) => {
          await db.query('insert into workflow_definitions (id,workflow_id,workflow_name,version,definition,enabled,tenant_id,organization_id,created_at,updated_at) values ($1,$2,$3,$4,$5::jsonb,true,$6,$7,now(),now())', [randomUUID(), definition.workflowId, definition.workflowName, definition.version, JSON.stringify(definition.definition), fixture.tenantId, fixture.organizationId])
        })
        const executor = container.resolve<typeof WorkflowExecutor>('workflowExecutor')
        const em = container.resolve<EntityManager>('em').fork()
        const instance = await executor.startWorkflow(em, { workflowId: skeleton.workflowId, version: definition.version, tenantId: fixture.tenantId, organizationId: fixture.organizationId, metadata: { initiatedBy: fixture.userId }, initialContext: { ...owners, registrationId, evaluationId, evaluatedAt, factsRef, rulesVersion: '2026-09-19.1', rulesSnapshot: DEFAULT_HIDDEN_POTENTIAL_RULES } })
        await executor.executeWorkflow(em, container, instance.id, { userId: fixture.userId })
        const state = () => withClient(async (db) => (await db.query('select status,current_step_id,error_message from workflow_instances where id=$1', [instance.id])).rows[0])
        if (scenario === 'unflagged') {
          expect(await state()).toMatchObject({ current_step_id: 'disposition' })
          expect((await state()).status).not.toBe('FAILED')
          const jobs: unknown[] = []
          await queue.process(async (job) => { jobs.push(job) })
          expect(jobs).toHaveLength(0)
          expect(await withClient(async (db) => (await db.query('select id from agent_proposals where workflow_instance_id=$1', [instance.id])).rows)).toHaveLength(0)
          return
        }
        expect(await state()).toMatchObject({ status: 'PAUSED', current_step_id: 'review' })
        const worker = bootstrap.modules.flatMap((module) => module.workers ?? []).find((candidate) => candidate.queue === queueName)
        if (!worker) throw new Error('[internal] Evaluation review worker not discovered')
        const jobs: QueuedJob<Record<string, unknown>>[] = []
        const proposals = () => withClient(async (db) => (await db.query<{ id: string; disposition: string; updated_at: Date }>('select id,disposition,updated_at from agent_proposals where workflow_instance_id=$1 and tenant_id=$2 and organization_id=$3', [instance.id, fixture.tenantId, fixture.organizationId])).rows)
        await expect.poll(async () => {
          await queue.process(async (job, context) => {
            jobs.push(job)
            await worker.handler(job, { ...context, resolve: <Value = unknown>(name: string): Value => container.resolve<Value>(name) })
          })
          return (await proposals()).length
        }, { timeout: 30_000 }).toBe(1)
        expect(jobs).toHaveLength(1)
        await Promise.all([1, 2].map(async (attempt) => worker.handler(jobs[0], { jobId: jobs[0].id, attemptNumber: attempt + 1, queueName, resolve: <Value = unknown>(name: string): Value => container.resolve<Value>(name) })))
        expect(await proposals()).toHaveLength(1)
        const proposal = (await proposals())[0]
        const materialPath = `/api/photographers/proposals/${proposal.id}/materials`
        const preview = await apiRequest(request, 'GET', materialPath, { token: fixture.token })
        expect(preview.status(), await preview.text()).toBe(200)
        expect(preview.headers()['cache-control']).toContain('no-store')
        const materials = proposalReviewMaterialsResponseSchema.parse(await readJsonSafe(preview))
        expect(materials.options[0].materials.map((material) => material.kind)).toEqual(['facts', 'score'])
        expect(materials.options[0].materials[1]).toMatchObject({ kind: 'score', data: { score: 60, flags: ['business_suspended'], suggestedAction: 'review' } })
        for (const disposition of ['approved', 'edited', 'rejected']) {
          const response = await apiRequest(request, 'POST', `/api/agent_orchestrator/proposals/${proposal.id}/dispose`, { token: fixture.token, data: { disposition, ...(disposition === 'rejected' ? {} : { selectedOptionId: 'review' }), reason: 'QA blocked decision', ...(disposition === 'edited' ? { payload: { options: [{ id: 'review', label: 'Review flagged assessment', actions: [{ type: 'photographers.evaluation.review', risk: 'high', payload: { ...owners, evaluationId, registrationId, factsRef, scoreRef: materials.options[0].materials[1].id } }] }] } } : {}) }, headers: { 'x-om-ext-optimistic-lock-expected-updated-at': proposal.updated_at.toISOString() } })
          expect(response.status(), await response.text()).toBe(409)
        }
        if (!baseURL) throw new Error('[internal] Runner base URL required')
        await page.context().addCookies([
          { name: 'auth_token', value: fixture.token, url: baseURL, httpOnly: true },
          { name: 'om_selected_org', value: fixture.organizationId, url: baseURL },
          { name: 'om_selected_tenant', value: fixture.tenantId, url: baseURL },
          { name: 'locale', value: 'en', url: baseURL },
          { name: 'om_demo_notice_ack', value: 'ack', url: baseURL },
          { name: 'om_cookie_notice_ack', value: 'ack', url: baseURL },
          { name: 'om_feedback_suppress', value: '1', url: baseURL },
        ])
        await page.goto(`/backend/caseload/${proposal.id}`, { waitUntil: 'domcontentloaded' })
        const region = page.getByRole('region', { name: 'Evaluation materials', exact: true })
        await expect(region.getByText('Score: 60/100', { exact: true })).toBeVisible()
        await expect(region.getByText('Business suspended', { exact: true })).toBeVisible()
        await expect(region.getByText('Points breakdown', { exact: true })).toBeVisible()
        await expect(region.getByText(/Assessment preview\./)).toBeVisible()
        await expect(region.getByRole('term').filter({ hasText: 'Confirmed tax ID — 20 points' })).toBeVisible()
        await region.getByRole('button', { name: 'Refresh materials', exact: true }).click()
        await expect(region.getByText('Score: 60/100', { exact: true })).toBeVisible()
        await page.screenshot({ path: testInfo.outputPath('flagged-score-caseload.png'), fullPage: true })
        await withClient(async (db) => {
          expect((await proposals())[0].disposition).toBe('pending')
          expect(await state()).toMatchObject({ status: 'PAUSED', current_step_id: 'review' })
          const runs = await db.query('select id,result_kind,status from agent_runs where workflow_instance_id=$1', [instance.id])
          expect(runs.rows).toHaveLength(1)
          expect(runs.rows[0]).toMatchObject({ result_kind: 'proposal', status: 'ok' })
          expect((await db.query('select id from user_tasks where workflow_instance_id=$1', [instance.id])).rows).toHaveLength(1)
          expect((await db.query('select id from agent_spans where agent_run_id=$1', [runs.rows[0].id])).rows.length).toBeGreaterThan(0)
          for (const table of ['workflow_instances', 'step_instances', 'workflow_events', 'agent_proposals']) {
            const owner = table === 'workflow_instances' ? 'id' : 'workflow_instance_id'
            const rows = await db.query(`select * from ${table} where ${owner}=$1 and tenant_id=$2 and organization_id=$3`, [instance.id, fixture.tenantId, fixture.organizationId])
            expect(JSON.stringify(rows.rows)).not.toContain(sourceRef)
          }
          expect((await db.query('select pipeline_stage_id from customer_deals where id=$1', [owners.dealId])).rows[0].pipeline_stage_id).toBe(fixture.stageId)
        })
      } finally {
        await queue.close()
        await container.dispose()
        if (previousStrategy === undefined) delete process.env.QUEUE_STRATEGY; else process.env.QUEUE_STRATEGY = previousStrategy
        if (previousBase === undefined) delete process.env.QUEUE_BASE_DIR; else process.env.QUEUE_BASE_DIR = previousBase
        await rm(queueBase, { recursive: true, force: true })
        await withClient(async (db) => {
          for (const table of ['agent_tool_calls', 'agent_spans', 'agent_guardrail_checks', 'agent_eval_results', 'agent_proposals', 'agent_run_sessions', 'agent_runs', 'user_tasks', 'workflow_events', 'step_instances', 'workflow_branch_instances', 'workflow_instances', 'workflow_definitions', 'photographers_evaluation_materials']) await db.query(`delete from ${table} where tenant_id=$1 and organization_id=$2`, [fixture.tenantId, fixture.organizationId])
        })
        await fixture.cleanup()
      }
    })
  }
})
