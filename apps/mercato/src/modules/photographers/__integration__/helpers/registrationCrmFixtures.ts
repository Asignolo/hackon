import { randomUUID } from 'node:crypto'
import { expect, type APIRequestContext } from '@playwright/test'
import { apiRequest, getAuthToken } from '@open-mercato/core/helpers/integration/api'
import { apiRequestWithSelectedOrg, createUserFixture } from '@open-mercato/core/helpers/integration/authFixtures'
import { createOrganizationInDb, setUserAclInDb, withClient } from '@open-mercato/core/helpers/integration/dbFixtures'
import { getTokenContext, readJsonSafe } from '@open-mercato/core/helpers/integration/generalFixtures'

export async function registrationCrmFixture(request: APIRequestContext, additionalFeatures: string[] = []) {
  const admin = await getAuthToken(request, 'superadmin')
  const { tenantId } = getTokenContext(admin)
  const organizationId = await createOrganizationInDb({ tenantId, name: `QA registration CRM ${randomUUID()}` })
  const email = `qa-crm-${randomUUID()}@example.invalid`
  const password = `QA-${randomUUID()}!`
  let userId: string | undefined
  async function cleanup() {
    await withClient(async (client) => {
      for (const table of ['customer_deal_people', 'customer_deal_companies']) await client.query(`delete from ${table} where deal_id in (select id from customer_deals where tenant_id = $1 and organization_id = $2)`, [tenantId, organizationId])
      for (const table of ['customer_deal_stage_transitions', 'photographers_raw_data', 'customer_deals', 'customer_people', 'customer_entities', 'customer_pipeline_stages', 'customer_pipelines', 'customer_dictionary_entries', 'entity_indexes', 'search_tokens', 'action_logs', 'access_logs', 'module_configs', 'encryption_maps']) await client.query(`delete from ${table} where tenant_id = $1 and organization_id = $2`, [tenantId, organizationId])
      if (userId) {
        for (const table of ['sessions', 'user_acls', 'user_roles', 'password_resets', 'user_consents']) await client.query(`delete from ${table} where user_id = $1`, [userId])
        await client.query('delete from users where id = $1 and tenant_id = $2', [userId, tenantId])
      }
      await client.query('delete from organizations where id = $1 and tenant_id = $2', [organizationId, tenantId])
    })
  }
  try {
    for (const [entityId, fields] of [
      ['photographers:photographer_raw_data', ['first_name', 'last_name', 'email', 'portfolio_raw']],
      ['customers:customer_entity', ['display_name', 'primary_email']],
      ['customers:customer_person_profile', ['first_name', 'last_name']],
      ['customers:customer_deal', ['title']],
      ['audit_logs:action_log', ['command_id', 'command_payload', 'snapshot_before', 'snapshot_after', 'changes_json', 'context_json']],
    ] as const) {
      const response = await apiRequestWithSelectedOrg(request, 'POST', '/api/entities/encryption', { token: admin, selectedOrgId: organizationId, data: { entityId, fields: fields.map((field) => ({ field })), isActive: true } })
      expect(response.status(), await response.text()).toBe(200)
    }
    userId = await createUserFixture(request, admin, { email, password, organizationId, roles: [] })
    await setUserAclInDb({ userId, tenantId, features: ['photographers.*', 'customers.*', ...additionalFeatures], organizations: [organizationId] })
    const token = await getAuthToken(request, email, password)
    const pipeline = await apiRequest(request, 'POST', '/api/customers/pipelines', { token, data: { name: `Hidden Potential ${randomUUID()}`, isDefault: false } })
    expect(pipeline.status(), await pipeline.text()).toBe(201)
    const pipelineId = (await readJsonSafe<{ id: string }>(pipeline))!.id
    const stage = await apiRequest(request, 'POST', '/api/customers/pipeline-stages', { token, data: { pipelineId, label: 'New', order: 0 } })
    expect(stage.status(), await stage.text()).toBe(201)
    const stageId = (await readJsonSafe<{ id: string }>(stage))!.id
    await withClient(async (client) => {
      await client.query('insert into module_configs (id,module_id,name,value_json,tenant_id,organization_id,created_at,updated_at) values ($1,$2,$3,$4::jsonb,$5,$6,now(),now())', [randomUUID(), 'photographers', `hidden_potential_installation_${organizationId}`, JSON.stringify({ schemaVersion: 1, pipelineId, stageIds: { new: stageId } }), tenantId, organizationId])
    })
    return { token, email, password, userId, tenantId, organizationId, pipelineId, stageId, cleanup }
  } catch (error) {
    await cleanup()
    throw error
  }
}
