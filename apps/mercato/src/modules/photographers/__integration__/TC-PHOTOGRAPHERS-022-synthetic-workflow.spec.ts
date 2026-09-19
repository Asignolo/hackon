import path from 'node:path'
import { createRequire } from 'node:module'
import { pathToFileURL } from 'node:url'
import { randomUUID } from 'node:crypto'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { expect, test } from '@playwright/test'
import type { EntityManager } from '@mikro-orm/core'
import type { CommandBus } from '@open-mercato/shared/lib/commands/command-bus'
import type { CommandRuntimeContext } from '@open-mercato/shared/lib/commands'
import type * as WorkflowExecutor from '@open-mercato/core/modules/workflows/lib/workflow-executor'
import type { QueuedJob } from '@open-mercato/queue'
import { getAuthToken } from '@open-mercato/core/helpers/integration/api'
import { apiRequestWithSelectedOrg, createUserFixture } from '@open-mercato/core/helpers/integration/authFixtures'
import { createOrganizationInDb, setUserAclInDb, withClient } from '@open-mercato/core/helpers/integration/dbFixtures'
import { createPersonFixture, createDealFixture } from '@open-mercato/core/helpers/integration/crmFixtures'
import { getTokenContext } from '@open-mercato/core/helpers/integration/generalFixtures'

const appRoot = path.resolve(process.env.OM_TEST_APP_ROOT?.trim() || path.resolve(process.cwd(), 'apps/mercato'))
const queueName = 'photographers-synthetic-workflow'
const workflowId = 'photographers.synthetic-evaluation'
type ReferenceJob = { workflowInstanceId: string; operationId: string; lane: string; organizationId: string }

test.describe('TC-PHOTOGRAPHERS-022: actual application workflow and queue execution', () => {
  test.describe.configure({ mode: 'serial' })
  const targetRequire = createRequire(path.join(appRoot, 'package.json'))
  let runtime: typeof import('@open-mercato/shared/lib/di/container')
  let queues: typeof import('@open-mercato/queue')
  const createdQueueBases: string[] = []
  let bootstrapData: Awaited<ReturnType<typeof import('@open-mercato/shared/lib/bootstrap/dynamicLoader')['bootstrapFromAppRoot']>>
  test.beforeAll(async () => {
    const bootstrap = await import(pathToFileURL(targetRequire.resolve('@open-mercato/shared/lib/bootstrap/dynamicLoader')).href) as typeof import('@open-mercato/shared/lib/bootstrap/dynamicLoader')
    runtime = await import(pathToFileURL(targetRequire.resolve('@open-mercato/shared/lib/di/container')).href) as typeof import('@open-mercato/shared/lib/di/container')
    queues = await import(pathToFileURL(targetRequire.resolve('@open-mercato/queue')).href) as typeof import('@open-mercato/queue')
    bootstrapData = await bootstrap.bootstrapFromAppRoot(appRoot)
  })
  test.afterAll(async () => {
    await Promise.all(createdQueueBases.map((directory) => rm(directory, { recursive: true, force: true })))
  })

  for (const scenario of [{ strategy: 'local', failReviewDispatch: false }, { strategy: 'async', failReviewDispatch: false }, { strategy: 'local', failReviewDispatch: true }] as const) {
    const { strategy, failReviewDispatch } = scenario
    test(`${strategy}: ${failReviewDispatch ? 'review dispatch failure reaches FAILED without locking callback recovery' : 'parallel reference callbacks join and leave the synthetic review paused'}`, async ({ request }) => {
      test.slow()
      test.skip(process.env.OM_INTEGRATION_TEST !== 'true', 'Synthetic execution is only available in the isolated integration environment')
      const disposableRedisUrl = process.env.PHOTOGRAPHERS_TEST_REDIS_URL
      test.skip(strategy === 'async' && !disposableRedisUrl, 'Async queue coverage requires PHOTOGRAPHERS_TEST_REDIS_URL pointing to disposable test Redis; developer Redis is never used')
      const previousStrategy = process.env.QUEUE_STRATEGY
      const previousQueueBase = process.env.QUEUE_BASE_DIR
      const previousQueueRedis = process.env.QUEUE_REDIS_URL
      const queueBase = await mkdtemp(path.join(tmpdir(), 'photographers-workflow-'))
      createdQueueBases.push(queueBase)
      process.env.QUEUE_STRATEGY = strategy
      process.env.QUEUE_BASE_DIR = queueBase
      if (strategy === 'async') process.env.QUEUE_REDIS_URL = disposableRedisUrl
      const adminToken = await getAuthToken(request, 'superadmin')
      const { tenantId } = getTokenContext(adminToken)
      const organizationId = await createOrganizationInDb({ tenantId, name: `QA synthetic workflow ${randomUUID()}` })
      let userId: string | null = null
      const queue = queues.createModuleQueue<ReferenceJob>(queueName, { concurrency: 1 })

      try {
        for (const [entityId, fields] of [
          ['photographers:photographer_evaluation_material', ['body']],
          ['audit_logs:action_log', ['command_payload', 'snapshot_before', 'snapshot_after', 'changes_json', 'context_json']],
        ] as const) {
          const response = await apiRequestWithSelectedOrg(request, 'POST', '/api/entities/encryption', { token: adminToken, selectedOrgId: organizationId, data: { entityId, fields: fields.map((field) => ({ field })), isActive: true } })
          expect(response.status(), await response.text()).toBe(200)
        }
        const email = `qa-photographers-workflow-${randomUUID()}@example.com`
        const password = `QA-${randomUUID()}!`
        userId = await createUserFixture(request, adminToken, { email, password, organizationId, roles: [] })
        await setUserAclInDb({ userId, tenantId, features: ['photographers.*', 'customers.*', 'workflows.*'], organizations: [organizationId] })
        const token = await getAuthToken(request, email, password)
        const photographerId = await createPersonFixture(request, token, { firstName: 'Test', lastName: 'Workflow', displayName: `QA Workflow ${randomUUID()}` })
        const dealId = await createDealFixture(request, token, { title: `QA Workflow ${randomUUID()}`, personIds: [photographerId] })
        const personId = await withClient(async (client) => {
          const result = await client.query<{ id: string }>('select id from customer_people where entity_id = $1 and tenant_id = $2 and organization_id = $3', [photographerId, tenantId, organizationId])
          expect(result.rows).toHaveLength(1)
          return result.rows[0].id
        })
        const worker = bootstrapData.modules.flatMap((module) => module.workers ?? []).find((candidate) => candidate.id === 'photographers:synthetic-workflow')
        expect(worker, 'generated module registry discovers the real worker').toBeDefined()
        if (!worker) throw new Error('[internal] Synthetic worker was not discovered')
        const container = await runtime.createRequestContainer()
        const commandBus = container.resolve<CommandBus>('commandBus')
        const executor = container.resolve<typeof WorkflowExecutor>('workflowExecutor')
        const em = container.resolve<EntityManager>('em').fork()
        const ctx: CommandRuntimeContext = { container, auth: { sub: userId, tenantId, orgId: organizationId }, selectedOrganizationId: organizationId, organizationIds: [organizationId], organizationScope: null }
        const evaluationId = randomUUID()
        const evaluatedAt = new Date().toISOString()
        const traces = await commandBus.execute<Record<string, unknown>, { id: string }>('photographers.evaluation.store_material', { input: { operationId: randomUUID(), snapshot: { photographerId, personId, dealId, material: { kind: 'traces', data: { schemaVersion: 1, evaluationId, evaluatedAt, traces: [], discoveryStatus: 'complete' } } } }, ctx })
        const facts = await commandBus.execute<Record<string, unknown>, { id: string }>('photographers.evaluation.store_material', { input: { operationId: randomUUID(), snapshot: { photographerId, personId, dealId, material: { kind: 'facts', data: { schemaVersion: 1, evaluationId, evaluatedAt, facts: [], tracesRef: traces.result.id } } } }, ctx })
        const instance = await executor.startWorkflow(em, { workflowId, tenantId, organizationId, metadata: { initiatedBy: userId }, initialContext: { synthetic: { enabled: true, evaluationId, photographerId, personId, dealId, materials: { portfolio: traces.result.id, social: traces.result.id, review: facts.result.id } } } })
        await executor.executeWorkflow(em, container, instance.id, { userId })
        if (failReviewDispatch) {
          const blockedPath = path.join(queueBase, 'not-a-directory')
          await writeFile(blockedPath, 'Synthetic queue outage')
          process.env.QUEUE_BASE_DIR = blockedPath
        }
        const observed: QueuedJob<ReferenceJob>[] = []
        const processJobs = async () => queue.process(async (job, jobContext) => {
          await worker.handler(job, { ...jobContext, resolve: <Value = unknown>(name: string): Value => container.resolve<Value>(name) })
          if (job.payload.workflowInstanceId === instance.id) observed.push(job)
        })
        if (strategy === 'async') await processJobs()
        await expect.poll(async () => {
          if (strategy === 'local') await processJobs()
          return withClient(async (client) => {
            const result = await client.query<{ status: string; current_step_id: string }>('select status, current_step_id from workflow_instances where id = $1 and tenant_id = $2 and organization_id = $3', [instance.id, tenantId, organizationId])
            return result.rows[0]
          })
        }, { timeout: 45_000, intervals: [250, 500, 1000] }).toEqual(failReviewDispatch ? { status: 'FAILED', current_step_id: 'join' } : { status: 'PAUSED', current_step_id: 'wait_review' })
        if (failReviewDispatch) return
        await expect.poll(async () => {
          if (strategy === 'local') await processJobs()
          return observed.filter((job) => job.payload.lane === 'review').length
        }, { timeout: 15_000, intervals: [250, 500, 1000] }).toBe(1)
        expect(observed.map((job) => job.payload.lane).sort()).toEqual(['portfolio', 'review', 'social'])
        const portfolio = observed.find((job) => job.payload.lane === 'portfolio')
        if (!portfolio) throw new Error('[internal] Portfolio callback was not processed')
        await worker.handler(portfolio, { jobId: portfolio.id, attemptNumber: 2, queueName, resolve: <Value = unknown>(name: string): Value => container.resolve<Value>(name) })
        await withClient(async (client) => {
          const branches = await client.query<{ status: string }>('select status from workflow_branch_instances where workflow_instance_id = $1 and tenant_id = $2 and organization_id = $3', [instance.id, tenantId, organizationId])
          expect(branches.rows.map((row) => row.status)).toEqual(['COMPLETED', 'COMPLETED'])
          const received = await client.query<{ total: string }>("select count(*)::text as total from workflow_events where workflow_instance_id = $1 and event_type = 'SIGNAL_RECEIVED'", [instance.id])
          expect(received.rows[0].total).toBe('2')
          const remaining = await client.query<{ status: string; current_step_id: string }>('select status,current_step_id from workflow_instances where id = $1', [instance.id])
          expect(remaining.rows[0]).toEqual({ status: 'PAUSED', current_step_id: 'wait_review' })
        })
      } finally {
        if (previousStrategy === undefined) delete process.env.QUEUE_STRATEGY; else process.env.QUEUE_STRATEGY = previousStrategy
        if (previousQueueBase === undefined) delete process.env.QUEUE_BASE_DIR; else process.env.QUEUE_BASE_DIR = previousQueueBase
        if (previousQueueRedis === undefined) delete process.env.QUEUE_REDIS_URL; else process.env.QUEUE_REDIS_URL = previousQueueRedis
        try {
          try {
            await queue.removeQueuedJobsByScope?.({ tenantId, organizationId })
          } finally {
            await queue.close()
          }
        } finally {
          try {
            await withClient(async (client) => {
              for (const table of ['customer_deal_people', 'customer_deal_companies']) await client.query(`delete from ${table} where deal_id in (select id from customer_deals where tenant_id = $1 and organization_id = $2)`, [tenantId, organizationId])
              for (const table of ['workflow_events', 'step_instances', 'workflow_branch_instances', 'workflow_instances', 'photographers_evaluation_materials', 'customer_deal_stage_transitions', 'customer_deals', 'customer_people', 'customer_entities', 'entity_indexes', 'search_tokens', 'action_logs', 'access_logs', 'encryption_maps']) await client.query(`delete from ${table} where tenant_id = $1 and organization_id = $2`, [tenantId, organizationId])
              if (userId) {
                for (const table of ['sessions', 'user_acls', 'user_roles', 'password_resets', 'user_consents']) await client.query(`delete from ${table} where user_id = $1`, [userId])
                await client.query('delete from users where id = $1 and tenant_id = $2', [userId, tenantId])
              }
              await client.query('delete from organizations where id = $1 and tenant_id = $2', [organizationId, tenantId])
            })
          } finally {
            await rm(queueBase, { recursive: true, force: true })
          }
        }
      }
    })
  }
})
