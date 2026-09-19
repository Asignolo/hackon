import { randomUUID } from 'node:crypto'
import { expect, test } from '@playwright/test'
import { apiRequest, getAuthToken, withCredentialIsolatedRequest } from '@open-mercato/core/helpers/integration/api'
import { apiRequestWithSelectedOrg, createUserFixture } from '@open-mercato/core/helpers/integration/authFixtures'
import { createOrganizationInDb, setUserAclInDb, withClient } from '@open-mercato/core/helpers/integration/dbFixtures'
import { expectId, getTokenContext, readJsonSafe } from '@open-mercato/core/helpers/integration/generalFixtures'

const endpoint = '/api/photographers/raw-data'
const entityId = 'photographers:photographer_raw_data'
const encryptedFields = ['first_name', 'last_name', 'email', 'portfolio_raw']

test('TC-PHOTOGRAPHERS-001: immutable encrypted submissions respect access and organization scope', async ({ request, page }) => {
  const adminToken = await getAuthToken(request, 'superadmin')
  const { tenantId } = getTokenContext(adminToken)
  const organizationIds: string[] = []
  const userIds: string[] = []
  const customerIds: string[] = []
  const stamp = randomUUID()
  const source = {
    firstName: '  Jan ',
    lastName: 'Kowalski ',
    email: `QA.${stamp}@Example.com`,
    portfolioRaw: '  Instagram: @OriginalCase — nie mam strony  ',
    submittedAt: '2025-04-03T12:34:56+02:00',
  }

  try {
    const tokens: string[] = []
    for (const label of ['owner', 'other']) {
      const organizationId = await createOrganizationInDb({ tenantId, name: `QA photographers ${label} ${stamp}` })
      organizationIds.push(organizationId)
      const mapResponse = await apiRequestWithSelectedOrg(request, 'POST', '/api/entities/encryption', {
        token: adminToken,
        selectedOrgId: organizationId,
        data: { entityId, fields: encryptedFields.map((field) => ({ field })), isActive: true },
      })
      expect(mapResponse.status()).toBe(200)
      const email = `qa-photographers-${label}-${stamp}@example.com`
      const password = `QA-${randomUUID()}!`
      const userId = await createUserFixture(request, adminToken, { email, password, organizationId, roles: [] })
      userIds.push(userId)
      await setUserAclInDb({ userId, tenantId, features: ['photographers.view', 'photographers.create'], organizations: [organizationId] })
      tokens.push(await getAuthToken(request, email, password))
      if (label === 'owner') {
        const loginResponse = await page.request.post('/api/auth/login', { form: { email, password } })
        expect(loginResponse.ok()).toBeTruthy()
      }
      const customerId = randomUUID()
      customerIds.push(customerId)
      await withClient(async (client) => {
        await client.query(
          `insert into customer_entities (id, tenant_id, organization_id, kind, display_name, is_active, created_at, updated_at)
           values ($1, $2, $3, 'person', $4, true, now(), now())`,
          [customerId, tenantId, organizationId, `QA photographer ${label} ${stamp}`],
        )
      })
    }
    const [ownerToken, otherToken] = tokens
    const submitted = await apiRequest(request, 'POST', endpoint, {
      token: ownerToken,
      data: { ...source, customerEntityId: customerIds[0] },
    })
    expect(submitted.status(), await submitted.text()).toBe(201)
    const body = await readJsonSafe<{ id?: string }>(submitted)
    const id = expectId(body?.id, 'Submission response includes its id')
    const read = await apiRequest(request, 'GET', `${endpoint}?id=${id}`, { token: ownerToken })
    expect(read.status()).toBe(200)
    const result = await readJsonSafe<{ items: Array<Record<string, unknown>>; total: number }>(read)
    expect(result?.total).toBe(1)
    expect(result?.items).toHaveLength(1)
    expect(result?.items[0]).toMatchObject({
      id, firstName: source.firstName, lastName: source.lastName,
      email: source.email, portfolioRaw: source.portfolioRaw, customerEntityId: customerIds[0],
    })
    expect(new Date(String(result?.items[0].submittedAt)).toISOString()).toBe(new Date(source.submittedAt).toISOString())
    expect(new Date(String(result?.items[0].updatedAt)).getTime()).toBeGreaterThan(new Date(source.submittedAt).getTime())

    await withClient(async (client) => {
      const rows = await client.query<Record<string, string>>('select * from photographers_raw_data where id = $1', [id])
      expect(rows.rows).toHaveLength(1)
      expect(rows.rows[0]).toMatchObject({ tenant_id: tenantId, organization_id: organizationIds[0] })
      for (const [field, original] of Object.entries({ first_name: source.firstName, last_name: source.lastName, email: source.email, portfolio_raw: source.portfolioRaw })) {
        expect(rows.rows[0][field]).not.toBe(original)
        expect(rows.rows[0][field]).toMatch(/^[A-Za-z0-9+/=]+:[A-Za-z0-9+/=]+:[A-Za-z0-9+/=]+:v1$/)
      }
      const logs = await client.query<{ command_payload: unknown }>('select command_payload from action_logs where resource_kind = $1 and resource_id = $2', [entityId, id])
      expect(logs.rows.length).toBeGreaterThan(0)
      for (const log of logs.rows) {
        const serialized = JSON.stringify(log.command_payload)
        for (const original of [source.firstName, source.lastName, source.email, source.portfolioRaw]) expect(serialized).not.toContain(original)
      }
    })

    for (const method of ['PUT', 'PATCH', 'DELETE']) {
      const mutation = await apiRequest(request, method, `${endpoint}?id=${id}`, { token: ownerToken, data: { id, firstName: 'Changed' } })
      expect(mutation.status()).toBe(404)
    }
    for (const invalid of [{ portfolioRaw: 'x'.repeat(2049) }, { tenantId: randomUUID() }, { organizationId: organizationIds[1] }, { customerEntityId: customerIds[1] }]) {
      const rejected = await apiRequest(request, 'POST', endpoint, { token: ownerToken, data: { ...source, ...invalid } })
      expect('tenantId' in invalid || 'organizationId' in invalid ? [400, 403] : [400]).toContain(rejected.status())
    }
    const invalidPage = await apiRequest(request, 'GET', `${endpoint}?pageSize=101`, { token: ownerToken })
    expect(invalidPage.status()).toBe(400)
    const otherRead = await apiRequest(request, 'GET', `${endpoint}?id=${id}`, { token: otherToken })
    expect(otherRead.status()).toBe(200)
    expect((await readJsonSafe<{ items: unknown[] }>(otherRead))?.items).toEqual([])
    await withCredentialIsolatedRequest(async (anonymous) => {
      expect((await anonymous.get(endpoint)).status()).toBe(401)
      expect((await anonymous.post(endpoint, { data: source })).status()).toBe(401)
    })
    const deniedEmail = `qa-photographers-denied-${stamp}@example.com`
    const deniedPassword = `QA-${randomUUID()}!`
    const deniedId = await createUserFixture(request, adminToken, { email: deniedEmail, password: deniedPassword, organizationId: organizationIds[0], roles: [] })
    userIds.push(deniedId)
    await setUserAclInDb({ userId: deniedId, tenantId, features: [], organizations: [organizationIds[0]] })
    const deniedToken = await getAuthToken(request, deniedEmail, deniedPassword)
    expect((await apiRequest(request, 'GET', endpoint, { token: deniedToken })).status()).toBe(403)
    expect((await apiRequest(request, 'POST', endpoint, { token: deniedToken, data: source })).status()).toBe(403)
    const unchanged = await apiRequest(request, 'GET', `${endpoint}?id=${id}`, { token: ownerToken })
    expect((await readJsonSafe<{ items: Array<{ firstName: string }> }>(unchanged))?.items[0].firstName).toBe(source.firstName)
    await withClient(async (client) => {
      const count = await client.query<{ count: string }>('select count(*)::text as count from photographers_raw_data where organization_id = any($1::uuid[])', [organizationIds])
      expect(count.rows[0].count).toBe('1')
    })
    await page.goto('/backend/photographers/simulator')
    await expect(page.locator('[data-crud-field-id="firstName"] input')).toBeVisible()
    await page.locator('[data-crud-field-id="firstName"] input').fill(source.firstName)
    await page.locator('[data-crud-field-id="lastName"] input').fill(source.lastName)
    await page.locator('[data-crud-field-id="portfolioRaw"] textarea').fill(source.portfolioRaw)
    await page.locator('[data-crud-field-id="email"] input').fill('invalid-email')
    await page.getByRole('button', { name: /Simulate registration|Symuluj rejestrację/ }).first().click()
    await expect(page.getByText(/Enter a valid email address|Podaj poprawny adres e-mail/).first()).toBeVisible()
    await page.reload()
    await page.locator('[data-crud-field-id="firstName"] input').fill(source.firstName)
    await page.locator('[data-crud-field-id="lastName"] input').fill(source.lastName)
    await page.locator('[data-crud-field-id="email"] input').fill(source.email)
    await page.locator('[data-crud-field-id="portfolioRaw"] textarea').fill(source.portfolioRaw)
    const savedResponse = page.waitForResponse((response) => new URL(response.url()).pathname === endpoint && response.request().method() === 'POST')
    await page.getByRole('button', { name: /Simulate registration|Symuluj rejestrację/ }).first().click()
    const saved = await savedResponse
    expect(saved.status(), await saved.text()).toBe(201)
    const savedBody: { id: string } = JSON.parse(await saved.text())
    const savedId = expectId(savedBody?.id, 'Simulator saves a registration')
    await expect(page.getByRole('alert').filter({ hasText: savedId })).toBeVisible()
    const simulatedRead = await apiRequest(request, 'GET', `${endpoint}?id=${savedId}`, { token: ownerToken })
    expect((await readJsonSafe<{ items: Array<Record<string, unknown>> }>(simulatedRead))?.items[0]).toMatchObject({
      firstName: source.firstName, lastName: source.lastName, email: source.email, portfolioRaw: source.portfolioRaw,
    })
    await page.getByRole('button', { name: /Register another photographer|Zarejestruj kolejnego fotografa/ }).click()
    await expect(page.locator('[data-crud-field-id="firstName"] input')).toHaveValue('')
    await expect(page.locator('[data-crud-field-id="portfolioRaw"] textarea')).toHaveValue('')
    await page.locator('[data-crud-field-id="firstName"] input').fill(source.firstName)
    await page.locator('[data-crud-field-id="lastName"] input').fill(source.lastName)
    await page.locator('[data-crud-field-id="email"] input').fill(source.email)
    for (const portfolio of ['', '   ']) {
      await page.locator('[data-crud-field-id="portfolioRaw"] textarea').fill(portfolio)
      await page.getByRole('button', { name: /Simulate registration|Symuluj rejestrację/ }).first().click()
      await expect(page.locator('[data-crud-field-id="portfolioRaw"]')).toContainText(/required|wymagane|Uzupełnij/i)
      await expect(page.getByRole('button', { name: /Register another photographer|Zarejestruj kolejnego fotografa/ })).toHaveCount(0)
    }
  } finally {
    await withClient(async (client) => {
      const fixtureUsers = await client.query<{ id: string }>('select id from users where organization_id = any($1::uuid[])', [organizationIds])
      const allUserIds = [...new Set([...userIds, ...fixtureUsers.rows.map((user) => user.id)])]
      for (const table of ['entity_indexes', 'search_tokens']) await client.query(`delete from ${table} where organization_id = any($1::uuid[])`, [organizationIds])
      for (const table of ['action_logs', 'access_logs']) await client.query(`delete from ${table} where organization_id = any($1::uuid[]) or resource_id = any($2::text[])`, [organizationIds, [...allUserIds, ...customerIds]])
      await client.query('delete from photographers_raw_data where organization_id = any($1::uuid[])', [organizationIds])
      await client.query('delete from customer_entities where id = any($1::uuid[])', [customerIds])
      await client.query('delete from encryption_maps where entity_id = $1 and organization_id = any($2::uuid[])', [entityId, organizationIds])
      for (const table of ['sessions', 'user_acls', 'user_roles', 'password_resets', 'user_consents']) await client.query(`delete from ${table} where user_id = any($1::uuid[])`, [allUserIds])
      await client.query('delete from users where id = any($1::uuid[])', [allUserIds])
      await client.query('delete from organizations where id = any($1::uuid[])', [organizationIds])
    })
  }
})
