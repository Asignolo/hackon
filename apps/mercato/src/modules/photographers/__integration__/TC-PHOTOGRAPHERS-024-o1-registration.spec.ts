import path from 'node:path'
import { createRequire } from 'node:module'
import { pathToFileURL } from 'node:url'
import { randomUUID } from 'node:crypto'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { asValue } from 'awilix'
import { expect, test } from '@playwright/test'
import { z } from 'zod'
import type { EntityManager } from '@mikro-orm/postgresql'
import type { QueuedJob } from '@open-mercato/queue'
import type * as WorkflowExecutor from '@open-mercato/core/modules/workflows/lib/workflow-executor'
import type { AgentRunSessionStore } from '@open-mercato/enterprise/modules/agent_orchestrator/lib/runtime/agentRunSessionStore'
import type { OpenCodeRunnerClient } from '@open-mercato/enterprise/modules/agent_orchestrator/lib/runtime/openCodeAgentRunner'
import { apiRequest, getAuthToken } from '@open-mercato/core/helpers/integration/api'
import { apiRequestWithSelectedOrg } from '@open-mercato/core/helpers/integration/authFixtures'
import { withClient } from '@open-mercato/core/helpers/integration/dbFixtures'
import { readJsonSafe } from '@open-mercato/core/helpers/integration/generalFixtures'
import { registrationCrmFixture } from './helpers/registrationCrmFixtures'
import { portfolioDiscoveryInputSchema, portfolioDiscoveryResultSchema } from '../data/portfolio-discovery-validators'
import { materialResponseSchema } from '../data/material-validators'

export const integrationMeta = { dependsOnModules: ['photographers', 'customers', 'workflows', 'agent_orchestrator', 'agent_examples'] }

const appRoot = path.resolve(process.env.OM_TEST_APP_ROOT?.trim() || path.resolve(process.cwd(), 'apps/mercato'))
const targetRequire = createRequire(path.join(appRoot, 'package.json'))
const skeleton: typeof import('../workflow-definitions/hidden-potential.v1.json') = targetRequire('./src/modules/photographers/workflow-definitions/hidden-potential.v1.json')

test.describe('TC-PHOTOGRAPHERS-024: registration reaches encrypted O1 traces', () => {
  test.describe.configure({ mode: 'serial' })
  for (const hasPortfolio of [true, false]) {
    test(hasPortfolio ? 'portfolio registration persists sourced traces' : 'registration without portfolio still invokes O1 and persists email discovery', async ({ request }) => {
      const { bootstrapFromAppRoot } = await import(pathToFileURL(targetRequire.resolve('@open-mercato/shared/lib/bootstrap/dynamicLoader')).href) as typeof import('@open-mercato/shared/lib/bootstrap/dynamicLoader')
      const { createRequestContainer, getDiRegistrars, registerDiRegistrars } = await import(pathToFileURL(targetRequire.resolve('@open-mercato/shared/lib/di/container')).href) as typeof import('@open-mercato/shared/lib/di/container')
      const queues = await import(pathToFileURL(targetRequire.resolve('@open-mercato/queue')).href) as typeof import('@open-mercato/queue')
      const bootstrap = await bootstrapFromAppRoot(appRoot)
      const previousRegistrars = [...getDiRegistrars()]
      const fixture = await registrationCrmFixture(request, ['workflows.*', 'agent_orchestrator.*'])
      const queueBase = await mkdtemp(path.join(tmpdir(), 'photographers-o1-queue-'))
      const previousStrategy = process.env.QUEUE_STRATEGY
      const previousBase = process.env.QUEUE_BASE_DIR
      process.env.QUEUE_STRATEGY = 'local'
      process.env.QUEUE_BASE_DIR = queueBase
      const container = await createRequestContainer()
      const queueName = 'photographers-portfolio-discovery'
      const queue = queues.createModuleQueue<Record<string, unknown>>(queueName, { concurrency: 1 })
      const marker = randomUUID()
      const sourceUrl = `https://example.invalid/portfolio-${marker}`
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
          links: [{ type: 'website', originalUrl: sourceUrl, url: sourceUrl, confidence: 'confirmed', approvalRequired: false, sources: [{ url: sourceUrl, method: 'page_read', evidence: `Synthetic contact ${input.email}` }] }],
          nip: [], city: [], coverage: { website: 'found', contact: 'not_found', instagram: 'not_found', facebook: 'not_found', google_maps: 'not_found', nip: 'not_found' },
          approvalRequired: false, attempts: [{ tool: 'web_search', target: input.email, outcome: 'found', detail: 'Controlled external response for integration verification' }], summary: 'Synthetic discovery result',
        } })
        const client: OpenCodeRunnerClient = {
          createSession: async () => ({ id: randomUUID() }),
          subscribeToEvents: () => () => undefined,
          sendMessage: async (_sessionId, message, options) => {
            expect(options?.agent).toBe('agent_examples_portfolio_reader_o1')
            const authorization = /^\[Session Authorization: ([^.]+)\./.exec(message)
            if (!authorization) throw new Error('[internal] Missing test session authorization')
            observedInputs.push(portfolioDiscoveryInputSchema.parse(JSON.parse(message.slice(message.indexOf('\n\n') + 2))))
            const store = container.resolve<AgentRunSessionStore>('agentRunSessionStore')
            expect(await store.completeOutcome(authorization[1], research)).toBe('completed')
            return {}
          },
        }
        container.register({ openCodeClient: asValue(client) })
        registerDiRegistrars([...previousRegistrars, (requestContainer) => { requestContainer.register({ openCodeClient: asValue(client) }) }])
        const registration = await apiRequest(request, 'POST', '/api/photographers/raw-data', { token: fixture.token, data: input })
        expect(registration.status(), await registration.text()).toBe(201)
        const registrationId = z.object({ id: z.string().uuid() }).parse(await readJsonSafe(registration)).id
        const stepIds = new Set(['start', 'prepare', 'o1', 'identity'])
        const definition = {
          ...skeleton, enabled: true, version: Math.floor(Date.now() / 1000),
          workflowName: 'QA O1 registration slice',
          definition: {
            ...skeleton.definition,
            steps: skeleton.definition.steps.filter((step) => stepIds.has(step.stepId)).map((step) => step.stepId === 'identity' ? { ...step, stepType: 'END' } : step),
            transitions: skeleton.definition.transitions.filter((transition) => stepIds.has(transition.fromStepId) && stepIds.has(transition.toStepId)),
          },
        }
        const created = await apiRequest(request, 'POST', '/api/workflows/definitions', { token: fixture.token, data: definition })
        expect(created.status(), await created.text()).toBe(201)
        const executor = container.resolve<typeof WorkflowExecutor>('workflowExecutor')
        const em = container.resolve<EntityManager>('em').fork()
        const evaluationId = randomUUID()
        const instance = await executor.startWorkflow(em, { workflowId: skeleton.workflowId, version: definition.version, tenantId: fixture.tenantId, organizationId: fixture.organizationId, metadata: { initiatedBy: fixture.userId }, initialContext: { registrationId, evaluationId, evaluatedAt: new Date().toISOString() } })
        await executor.executeWorkflow(em, container, instance.id, { userId: fixture.userId })
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
          return withClient(async (db) => {
            const state = (await db.query<{ status: string; error_message: string | null; error_details: unknown }>('select status,error_message,error_details from workflow_instances where id=$1 and tenant_id=$2 and organization_id=$3', [instance.id, fixture.tenantId, fixture.organizationId])).rows[0]
            if (state?.status === 'FAILED') {
              const runs = await db.query('select status,result_kind,error_message from agent_runs where workflow_instance_id=$1 and tenant_id=$2 and organization_id=$3', [instance.id, fixture.tenantId, fixture.organizationId])
              throw new Error(`[internal] O1 integration failed: ${JSON.stringify({ state, runs: runs.rows })}`)
            }
            return state?.status
          })
        }, { timeout: 45_000 }).toBe('COMPLETED')
        expect(observedInputs).toEqual([{ originalPortfolio: input.portfolioRaw, registrationEmail: input.email, firstName: input.firstName, lastName: input.lastName }])
        const rows = await withClient(async (db) => (await db.query<{ id: string; body: string }>('select id,body from photographers_evaluation_materials where evaluation_id=$1 and tenant_id=$2 and organization_id=$3 and kind=$4', [evaluationId, fixture.tenantId, fixture.organizationId, 'traces'])).rows)
        expect(rows).toHaveLength(1)
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
        expect(material.data.traces[0]).toMatchObject({ value: sourceUrl, status: 'unconfirmed', provenance: [{ sourceRef: sourceUrl, value: expect.stringContaining(input.email) }] })
        expect(jobs).toHaveLength(1)
        await worker.handler(jobs[0], { jobId: jobs[0].id, attemptNumber: 2, queueName, resolve: <Value = unknown>(name: string): Value => container.resolve<Value>(name) })
        await withClient(async (db) => {
          const runs = await db.query<{ input: unknown; output: unknown }>('select input,output from agent_runs where workflow_instance_id=$1 and tenant_id=$2 and organization_id=$3', [instance.id, fixture.tenantId, fixture.organizationId])
          expect(runs.rows).toHaveLength(1)
          expect(JSON.stringify(runs.rows)).not.toContain(marker)
          for (const table of ['workflow_instances', 'step_instances', 'workflow_events']) {
            const owner = table === 'workflow_instances' ? 'id' : 'workflow_instance_id'
            const state = await db.query(`select * from ${table} where ${owner}=$1 and tenant_id=$2 and organization_id=$3`, [instance.id, fixture.tenantId, fixture.organizationId])
            expect(JSON.stringify(state.rows), `${table} contains no source data`).not.toContain(marker)
          }
          const count = await db.query<{ count: string }>('select count(*) from photographers_evaluation_materials where evaluation_id=$1 and tenant_id=$2 and organization_id=$3', [evaluationId, fixture.tenantId, fixture.organizationId])
          expect(count.rows[0].count).toBe('1')
        })
        expect(observedInputs).toHaveLength(1)
      } finally {
        registerDiRegistrars(previousRegistrars)
        await queue.close()
        await container.dispose()
        if (previousStrategy === undefined) delete process.env.QUEUE_STRATEGY; else process.env.QUEUE_STRATEGY = previousStrategy
        if (previousBase === undefined) delete process.env.QUEUE_BASE_DIR; else process.env.QUEUE_BASE_DIR = previousBase
        await rm(queueBase, { recursive: true, force: true })
        await withClient(async (db) => {
          for (const table of ['agent_tool_calls', 'agent_spans', 'agent_guardrail_checks', 'agent_run_sessions', 'agent_runs', 'workflow_events', 'step_instances', 'workflow_branch_instances', 'workflow_instances', 'workflow_definitions', 'photographers_evaluation_materials']) {
            await db.query(`delete from ${table} where tenant_id=$1 and organization_id=$2`, [fixture.tenantId, fixture.organizationId])
          }
        })
        await fixture.cleanup()
      }
    })
  }
})
