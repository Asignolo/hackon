import path from 'node:path'
import { createRequire } from 'node:module'
import { pathToFileURL } from 'node:url'
import { randomUUID } from 'node:crypto'
import { expect, test } from '@playwright/test'
import type { CommandBus } from '@open-mercato/shared/lib/commands/command-bus'
import type { CommandRuntimeContext } from '@open-mercato/shared/lib/commands'
import { apiRequest, getAuthToken } from '@open-mercato/core/helpers/integration/api'
import { apiRequestWithSelectedOrg, createUserFixture } from '@open-mercato/core/helpers/integration/authFixtures'
import { createOrganizationInDb, setUserAclInDb, withClient } from '@open-mercato/core/helpers/integration/dbFixtures'
import { createPersonFixture } from '@open-mercato/core/helpers/integration/crmFixtures'
import { getTokenContext, readJsonSafe } from '@open-mercato/core/helpers/integration/generalFixtures'

const appRoot = path.resolve(process.env.OM_TEST_APP_ROOT?.trim() || path.resolve(process.cwd(), 'apps/mercato'))
type StoredRow = { body: string; checksum: string; updated_at: Date }

test.describe('TC-PHOTOGRAPHERS-016: durable encrypted material history', () => {
  const targetRequire = createRequire(path.join(appRoot, 'package.json'))
  let runtime: typeof import('@open-mercato/shared/lib/di/container')
  test.beforeAll(async () => {
    const bootstrap = await import(pathToFileURL(targetRequire.resolve('@open-mercato/shared/lib/bootstrap/dynamicLoader')).href) as typeof import('@open-mercato/shared/lib/bootstrap/dynamicLoader')
    runtime = await import(pathToFileURL(targetRequire.resolve('@open-mercato/shared/lib/di/container')).href) as typeof import('@open-mercato/shared/lib/di/container')
    await bootstrap.bootstrapFromAppRoot(appRoot)
  })

  test('real commands preserve an encrypted snapshot through replay and CRM edit, delete and undo', async ({ request }) => {
    const adminToken = await getAuthToken(request, 'superadmin')
    const { tenantId } = getTokenContext(adminToken)
    const organizationId = await createOrganizationInDb({ tenantId, name: `QA material ${randomUUID()}` })
    let userId: string | null = null
    try {
      for (const [entityId, fields] of [
        ['photographers:photographer_evaluation_material', ['body']],
        ['audit_logs:action_log', ['command_payload', 'snapshot_before', 'snapshot_after', 'changes_json', 'context_json']],
      ] as const) {
        const response = await apiRequestWithSelectedOrg(request, 'POST', '/api/entities/encryption', { token: adminToken, selectedOrgId: organizationId, data: { entityId, fields: fields.map((field) => ({ field })), isActive: true } })
        expect(response.status(), await response.text()).toBe(200)
      }
      const email = `qa-photographers-material-${randomUUID()}@example.com`
      const password = `QA-${randomUUID()}!`
      userId = await createUserFixture(request, adminToken, { email, password, organizationId, roles: [] })
      await setUserAclInDb({ userId, tenantId, features: ['photographers.*', 'customers.*', 'audit_logs.*'], organizations: [organizationId] })
      const token = await getAuthToken(request, email, password)
      const photographerId = await createPersonFixture(request, token, { firstName: 'Synthetic', lastName: 'Material', displayName: `QA Material ${randomUUID()}` })
      const detail = await apiRequest(request, 'GET', `/api/customers/people/${photographerId}`, { token })
      expect(detail.status()).toBe(200)
      const person = await readJsonSafe<{ profile: { id: string } }>(detail)
      const personId = person?.profile.id
      expect(personId).toBeTruthy()
      expect(personId).not.toBe(photographerId)
      const container = await runtime.createRequestContainer()
      const commandBus = container.resolve<CommandBus>('commandBus')
      const ctx: CommandRuntimeContext = { container, auth: { sub: userId, tenantId, orgId: organizationId }, selectedOrganizationId: organizationId, organizationIds: [organizationId], organizationScope: null }
      const requestId = randomUUID()
      const data = { schemaVersion: 1, photographerId, requestId, status: 'no_orders_confirmed', checkedAt: new Date().toISOString(), confirmedBy: userId, sourceRef: `synthetic-only-${randomUUID()}`, expiresAt: new Date(Date.now() + 86400000).toISOString() }
      const input = { operationId: randomUUID(), snapshot: { photographerId, personId, material: { kind: 'eligibility', data } } }
      const stored = await commandBus.execute<typeof input, { id: string }>('photographers.evaluation.store_material', { input, ctx })
      const materialId = stored.result.id
      const endpoint = `/api/photographers/evaluation-materials/${materialId}`
      const readStored = () => withClient(async (client) => {
        const result = await client.query<StoredRow>('select body, checksum, updated_at from photographers_evaluation_materials where id = $1 and tenant_id = $2 and organization_id = $3', [materialId, tenantId, organizationId])
        expect(result.rows).toHaveLength(1)
        return result.rows[0]
      })
      const originalRow = await readStored()
      expect(originalRow.body).toMatch(/:v1$/)
      expect(originalRow.body).not.toContain(data.sourceRef)
      const initial = await apiRequest(request, 'GET', endpoint, { token })
      expect(initial.status()).toBe(200)
      expect(initial.headers()['cache-control']).toContain('no-store')
      const originalResponse = await readJsonSafe<Record<string, unknown>>(initial)
      expect(originalResponse).toMatchObject({ id: materialId, evaluationId: requestId, schemaVersion: 1, photographerId, personId, kind: 'eligibility', data })
      expect(originalResponse).toHaveProperty('updatedAt')
      const replay = await commandBus.execute<typeof input, { id: string }>('photographers.evaluation.store_material', { input, ctx })
      expect(replay.result.id).toBe(materialId)
      expect(await readStored()).toEqual(originalRow)
      await expect(commandBus.execute('photographers.evaluation.store_material', { input: { ...input, snapshot: { ...input.snapshot, material: { ...input.snapshot.material, data: { ...data, sourceRef: 'changed' } } } }, ctx })).rejects.toMatchObject({ status: 409 })
      const interaction = await apiRequest(request, 'POST', '/api/customers/interactions', { token, data: { id: materialId, entityId: photographerId, interactionType: 'note', body: `material:${materialId}`, status: 'done', scheduledAt: null } })
      expect(interaction.status()).toBe(201)
      expect((await apiRequest(request, 'PUT', '/api/customers/interactions', { token, data: { id: materialId, body: 'Changed CRM reference' } })).status()).toBe(200)
      expect((await apiRequest(request, 'DELETE', `/api/customers/interactions?id=${materialId}`, { token })).status()).toBe(200)
      expect(await readStored()).toEqual(originalRow)
      expect(await readJsonSafe(await apiRequest(request, 'GET', endpoint, { token }))).toEqual(originalResponse)
      const deleted = await commandBus.execute('customers.people.delete', { input: { body: { id: photographerId } }, ctx })
      expect((await apiRequest(request, 'GET', endpoint, { token })).status()).toBe(404)
      expect(await readStored()).toEqual(originalRow)
      const undoToken = deleted.logEntry?.undoToken
      expect(undoToken).toBeTruthy()
      if (!undoToken) throw new Error('[internal] Person deletion did not produce an undo token')
      await commandBus.undo(undoToken, ctx)
      expect(await readJsonSafe(await apiRequest(request, 'GET', endpoint, { token }))).toEqual(originalResponse)
      expect(await readStored()).toEqual(originalRow)
      expect(stored.logEntry?.undoToken).toBeFalsy()
    } finally {
      await withClient(async (client) => {
        for (const table of ['photographers_evaluation_materials', 'customer_interactions', 'customer_people', 'customer_entities', 'entity_indexes', 'search_tokens', 'action_logs', 'access_logs', 'encryption_maps']) await client.query(`delete from ${table} where tenant_id = $1 and organization_id = $2`, [tenantId, organizationId])
        if (userId) {
          for (const table of ['sessions', 'user_acls', 'user_roles', 'password_resets', 'user_consents']) await client.query(`delete from ${table} where user_id = $1`, [userId])
          await client.query('delete from users where id = $1 and tenant_id = $2', [userId, tenantId])
        }
        await client.query('delete from organizations where id = $1 and tenant_id = $2', [organizationId, tenantId])
      })
    }
  })
})
