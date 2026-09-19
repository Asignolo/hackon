import path from 'node:path'
import { randomUUID } from 'node:crypto'
import { createRequire } from 'node:module'
import { pathToFileURL } from 'node:url'
import { expect, type APIRequestContext } from '@playwright/test'
import type { EntityManager } from '@mikro-orm/postgresql'
import type { SchedulerService } from '@open-mercato/scheduler/modules/scheduler/services/schedulerService'
import { getAuthToken } from '@open-mercato/core/helpers/integration/api'
import { apiRequestWithSelectedOrg, createUserFixture } from '@open-mercato/core/helpers/integration/authFixtures'
import { createOrganizationInDb, setUserAclInDb, withClient } from '@open-mercato/core/helpers/integration/dbFixtures'
import { getTokenContext } from '@open-mercato/core/helpers/integration/generalFixtures'
import type { DemoExecution } from '../../data/demo-api-validators'

export async function prepareDemoScenarioFixture(request: APIRequestContext) {
  if (process.env.OM_INTEGRATION_TEST !== 'true' || !process.env.DATABASE_URL) throw new Error('[internal] Demo scenario fixtures require the complete isolated CLI environment')
  const appRoot = path.resolve(process.env.OM_TEST_APP_ROOT ?? 'apps/mercato')
  const targetRequire = createRequire(path.join(appRoot, 'package.json'))
  const bootstrap = await import(pathToFileURL(targetRequire.resolve('@open-mercato/shared/lib/bootstrap/dynamicLoader')).href) as typeof import('@open-mercato/shared/lib/bootstrap/dynamicLoader')
  const runtime = await import(pathToFileURL(targetRequire.resolve('@open-mercato/shared/lib/di/container')).href) as typeof import('@open-mercato/shared/lib/di/container')
  const encryption = await import(pathToFileURL(targetRequire.resolve('@open-mercato/shared/lib/encryption/find')).href) as typeof import('@open-mercato/shared/lib/encryption/find')
  const customerEntities = await import(pathToFileURL(targetRequire.resolve('@open-mercato/core/modules/customers/data/entities')).href) as typeof import('@open-mercato/core/modules/customers/data/entities')
  const agentEntities = await import(pathToFileURL(targetRequire.resolve('@open-mercato/enterprise/modules/agent_orchestrator/data/entities')).href) as typeof import('@open-mercato/enterprise/modules/agent_orchestrator/data/entities')
  const workflowEntities = await import(pathToFileURL(targetRequire.resolve('@open-mercato/core/modules/workflows/data/entities')).href) as typeof import('@open-mercato/core/modules/workflows/data/entities')
  const installation = await import(pathToFileURL(path.join(appRoot, 'src/modules/photographers/lib/install-hidden-potential.ts')).href) as typeof import('../../lib/install-hidden-potential')
  const queues = await import(pathToFileURL(targetRequire.resolve('@open-mercato/queue')).href) as typeof import('@open-mercato/queue')
  await bootstrap.bootstrapFromAppRoot(appRoot)
  const container = await runtime.createRequestContainer()
  const em = container.resolve<EntityManager>('em').fork()
  const adminToken = await getAuthToken(request, 'superadmin')
  const { tenantId } = getTokenContext(adminToken)
  const organizationId = await createOrganizationInDb({ tenantId, name: `QA photographer demo ${randomUUID()}` })
  const scope = { tenantId, organizationId }
  let userId: string | null = null
  async function cleanup() {
    try {
      const schedules = await withClient(async (client) => (await client.query<{ id: string }>('select id from scheduled_jobs where tenant_id = $1 and organization_id = $2', [tenantId, organizationId])).rows)
      for (const schedule of schedules) await container.resolve<SchedulerService>('schedulerService').unregister(schedule.id)
      const queue = queues.createModuleQueue('photographers-demo-workflow', { concurrency: 1 })
      try { await queue.removeQueuedJobsByScope?.(scope) } finally { await queue.close() }
      await withClient(async (client) => {
        for (const table of ['customer_deal_people', 'customer_deal_companies']) await client.query(`delete from ${table} where deal_id in (select id from customer_deals where tenant_id = $1 and organization_id = $2)`, [tenantId, organizationId])
        for (const table of [
          'agent_eval_results', 'agent_eval_assertions', 'agent_eval_cases', 'agent_corrections', 'agent_tool_calls', 'agent_spans', 'agent_guardrail_checks', 'agent_proposals', 'agent_run_artifacts', 'agent_run_sessions', 'agent_runs',
          'workflow_events', 'user_tasks', 'step_instances', 'workflow_branch_instances', 'process_instances', 'workflow_instances', 'process_definitions',
          'photographers_evaluation_materials', 'photographers_raw_data', 'customer_interactions', 'customer_deal_stage_transitions', 'customer_deals', 'customer_people', 'customer_entities', 'customer_pipeline_stages', 'customer_pipelines',
          'notifications', 'entity_indexes', 'search_tokens', 'action_logs', 'access_logs', 'module_configs', 'encryption_maps',
        ]) await client.query(`delete from ${table} where tenant_id = $1 and organization_id = $2`, [tenantId, organizationId])
        if (userId) {
          for (const table of ['sessions', 'user_acls', 'user_roles', 'password_resets', 'user_consents']) await client.query(`delete from ${table} where user_id = $1`, [userId])
          await client.query('delete from users where id = $1 and tenant_id = $2', [userId, tenantId])
        }
        await client.query('delete from organizations where id = $1 and tenant_id = $2', [organizationId, tenantId])
      })
    } finally { await container.dispose() }
  }
  try {
    for (const [entityId, fields] of [
      ['photographers:photographer_raw_data', ['first_name', 'last_name', 'email', 'portfolio_raw']],
      ['photographers:photographer_evaluation_material', ['body']],
      ['customers:customer_entity', ['display_name', 'primary_email']],
      ['customers:customer_person_profile', ['first_name', 'last_name']],
      ['customers:customer_deal', ['title']],
      ['customers:customer_interaction', ['title', 'body']],
      ['audit_logs:action_log', ['command_id', 'command_payload', 'snapshot_before', 'snapshot_after', 'changes_json', 'context_json']],
    ] as const) {
      const response = await apiRequestWithSelectedOrg(request, 'POST', '/api/entities/encryption', { token: adminToken, selectedOrgId: organizationId, data: { entityId, fields: fields.map((field) => ({ field })), isActive: true } })
      expect(response.status(), await response.text()).toBe(200)
    }
    const installed = await installation.installHiddenPotential({ container, em, ...scope })
    const email = `qa-demo-${randomUUID()}@photographers.invalid`
    const password = `QA-${randomUUID()}!`
    userId = await createUserFixture(request, adminToken, { email, password, organizationId, roles: [] })
    await setUserAclInDb({ userId, tenantId, features: ['photographers.*', 'customers.*', 'agent_orchestrator.*', 'workflows.*', 'configs.manage'], organizations: [organizationId] })
    const token = await getAuthToken(request, email, password)
    async function inspect(execution: DemoExecution) {
      const manager = em.fork()
      const [interactions, deal, process, workflow] = await Promise.all([
        encryption.findWithDecryption(manager, customerEntities.CustomerInteraction, { ...scope, entity: execution.photographerId, dealId: execution.dealId, deletedAt: null }, {}, scope),
        encryption.findOneWithDecryption(manager, customerEntities.CustomerDeal, { id: execution.dealId, ...scope }, {}, scope),
        encryption.findOneWithDecryption(manager, agentEntities.ProcessInstance, { id: execution.executionId, ...scope }, {}, scope),
        execution.workflowInstanceId ? encryption.findOneWithDecryption(manager, workflowEntities.WorkflowInstance, { id: execution.workflowInstanceId, ...scope }, {}, scope) : null,
      ])
      const persistence = await withClient(async (client) => {
        const registrations = await client.query<{ id: string; first_name: string; email: string }>('select id, first_name, email from photographers_raw_data where tenant_id = $1 and organization_id = $2', [tenantId, organizationId])
        const processes = await client.query<{ id: string }>('select id from process_instances where tenant_id = $1 and organization_id = $2', [tenantId, organizationId])
        const proposals = await client.query<{ id: string; disposition: string }>('select id, disposition from agent_proposals where tenant_id = $1 and organization_id = $2', [tenantId, organizationId])
        const deliveries = await client.query<{ count: string }>('select count(*)::text as count from customer_interactions where tenant_id = $1 and organization_id = $2 and external_message_id is not null', [tenantId, organizationId])
        return { registrations: registrations.rows, processes: processes.rows, proposals: proposals.rows, outboundMessageLinks: Number(deliveries.rows[0].count) }
      })
      return { interactions, deal, workflowStatus: workflow?.status, processStatus: process?.status, processInput: process?.input, workflowContext: workflow?.context, persistence }
    }
    async function replayDecision(execution: DemoExecution) {
      if (!execution.proposalId) throw new Error('[internal] Completed demo proposal required')
      const registry = await import(pathToFileURL(targetRequire.resolve('@open-mercato/shared/lib/modules/registry')).href) as typeof import('@open-mercato/shared/lib/modules/registry')
      const worker = registry.getModules().find((module) => module.id === 'photographers')?.workers?.find((entry) => entry.id === 'photographers:demo-workflow')
      if (!worker) throw new Error('[internal] Discovered demo worker required')
      await worker.handler({ id: randomUUID(), payload: { kind: 'disposition', ...scope, proposalId: execution.proposalId } }, {})
    }
    return { token, adminToken, ...scope, userId, installed, inspect, replayDecision, cleanup }
  } catch (error) { await cleanup(); throw error }
}
