import { randomUUID } from 'node:crypto'
import { expect, test } from '@playwright/test'
import { apiRequest, withCredentialIsolatedRequest } from '@open-mercato/core/helpers/integration/api'
import { readJsonSafe } from '@open-mercato/core/helpers/integration/generalFixtures'
import { withClient } from '@open-mercato/core/helpers/integration/dbFixtures'
import { registrationCrmFixture } from './helpers/registrationCrmFixtures'
import type { RegistrationCrmResult } from '../data/registration-crm-validators'

export const integrationMeta = { dependsOnModules: ['photographers', 'customers'] }
let cleanupFixture: (() => Promise<void>) | undefined

test.afterEach(async () => {
  await cleanupFixture?.()
  cleanupFixture = undefined
})

test('TC-PHOTOGRAPHERS-002: registration creates one scoped CRM person and deal and stops before evaluation', async ({ request }) => {
  const fixture = await registrationCrmFixture(request)
  cleanupFixture = fixture.cleanup
  const { token, tenantId, organizationId } = fixture
  const input = { firstName: ' QA ', lastName: 'Photographer', email: `QA.${randomUUID()}@example.invalid`, portfolioRaw: '  @original_portfolio  ' }
    const save = async (data = input) => {
      const response = await apiRequest(request, 'POST', '/api/photographers/raw-data', { token, data })
      expect(response.status(), await response.text()).toBe(201)
      return (await readJsonSafe<{ id: string }>(response))!.id
    }
    const registrationId = await save()
    const endpoint = `/api/photographers/registrations/${registrationId}/crm`
    const preparations = await Promise.all([1, 2].map(() => apiRequest(request, 'POST', endpoint, { token, data: {} })))
    for (const response of preparations) expect(response.status(), await response.text()).toBe(200)
    const first = (await readJsonSafe<RegistrationCrmResult>(preparations[0]))!
    expect(first.status).toBe('ready')
    expect(await readJsonSafe(preparations[1])).toEqual(first)
    expect(first.photographerId).not.toBe(first.personId)
    const read = await apiRequest(request, 'GET', endpoint, { token })
    expect(read.headers()['cache-control']).toBe('no-store')
    expect(await readJsonSafe(read)).toEqual(first)
    for (const url of [`/api/customers/people/${first.photographerId}`, `/api/customers/deals/${first.dealId}`]) {
      const record = await apiRequest(request, 'GET', url, { token })
      expect(record.status(), await record.text()).toBe(200)
    }
    const repeatedId = await save()
    const repeated = await apiRequest(request, 'POST', `/api/photographers/registrations/${repeatedId}/crm`, { token, data: {} })
    expect(repeated.status(), await repeated.text()).toBe(200)
    expect(await readJsonSafe(repeated)).toMatchObject({ photographerId: first.photographerId, dealId: first.dealId })
    const conflictId = await save({ ...input, lastName: 'Different' })
    const conflict = await apiRequest(request, 'POST', `/api/photographers/registrations/${conflictId}/crm`, { token, data: {} })
    expect(conflict.status()).toBe(409)
    const foreign = await apiRequest(request, 'GET', `/api/photographers/registrations/${randomUUID()}/crm`, { token })
    expect(foreign.status()).toBe(404)
    await withCredentialIsolatedRequest(async (anonymous) => {
      expect((await anonymous.get(endpoint)).status()).toBe(401)
      expect((await anonymous.post(endpoint, { data: {} })).status()).toBe(401)
    })
    await withClient(async (client) => {
      const count = async (table: string) => (await client.query<{ count: string }>(`select count(*) from ${table} where tenant_id=$1 and organization_id=$2`, [tenantId, organizationId])).rows[0].count
      expect(await count('customer_entities')).toBe('1')
      expect(await count('customer_deals')).toBe('1')
      expect(await count('workflow_instances')).toBe('0')
      const rows = (await client.query<{ email: string; portfolio_raw: string }>('select email,portfolio_raw from photographers_raw_data where id=$1 and tenant_id=$2 and organization_id=$3', [registrationId, tenantId, organizationId])).rows
      expect(rows[0].email).not.toBe(input.email)
      expect(rows[0].portfolio_raw).not.toBe(input.portfolioRaw)
    })
})

test('TC-PHOTOGRAPHERS-002: simulator exposes CRM cards and reload keeps the same records', async ({ request, page, baseURL }) => {
  const fixture = await registrationCrmFixture(request)
  cleanupFixture = fixture.cleanup
    const login = await page.request.post('/api/auth/login', { form: { email: fixture.email, password: fixture.password } })
    expect(login.ok()).toBeTruthy()
    await page.context().addCookies([{ name: 'om_cookie_notice_ack', value: 'ack', url: baseURL! }])
    await page.goto('/backend/photographers/simulator')
    await expect(page.getByRole('heading', { name: 'Registration simulator', exact: true })).toBeVisible()
    const fields = page.getByRole('textbox')
    await fields.nth(0).fill('QA')
    await fields.nth(1).fill('Photographer')
    await fields.nth(2).fill(`ui-${randomUUID()}@example.invalid`)
    await fields.nth(3).fill('@original_portfolio')
    await page.getByRole('button', { name: 'Simulate registration', exact: true }).first().click()
    const personLink = page.getByRole('link', { name: 'Open photographer', exact: true })
    const dealLink = page.getByRole('link', { name: 'Open Hidden Potential opportunity', exact: true })
    await expect(personLink).toBeVisible()
    await expect(dealLink).toBeVisible()
    await expect(page.getByText('No research or evaluation has started.', { exact: false })).toBeVisible()
    const personHref = await personLink.getAttribute('href')
    const dealHref = await dealLink.getAttribute('href')
    const savedUrl = page.url()
    expect(new URL(savedUrl).searchParams.get('registrationId')).toBeTruthy()
    await page.reload()
    await expect(personLink).toHaveAttribute('href', personHref!)
    await expect(dealLink).toHaveAttribute('href', dealHref!)
    await page.screenshot({ path: '.ai/runs/2026-09-19-photographer-hidden-potential/evidence/registration-crm-ready.png', fullPage: true })
    await personLink.click()
    await expect(page).toHaveURL(new RegExp(`${personHref}$`))
    await expect(page.getByRole('button', { name: 'QA Photographer', exact: true })).toBeVisible()
    await page.goto(savedUrl)
    await page.getByRole('link', { name: 'Open Hidden Potential opportunity', exact: true }).click()
    await expect(page).toHaveURL(new RegExp(`${dealHref}$`))
    await expect(page.getByText('Hidden potential — QA Photographer', { exact: true }).first()).toBeVisible()
})

test('TC-PHOTOGRAPHERS-002: durable registration subscriber prepares CRM without the simulator', async ({ request }) => {
  const fixture = await registrationCrmFixture(request)
  cleanupFixture = fixture.cleanup
    const submitted = await apiRequest(request, 'POST', '/api/photographers/raw-data', {
      token: fixture.token,
      data: { firstName: 'Event', lastName: 'Photographer', email: `event-${randomUUID()}@example.invalid`, portfolioRaw: 'none' },
    })
    expect(submitted.status()).toBe(201)
    const id = (await readJsonSafe<{ id: string }>(submitted))!.id
    await expect.poll(async () => {
      const response = await apiRequest(request, 'GET', `/api/photographers/registrations/${id}/crm`, { token: fixture.token })
      expect(response.status()).toBe(200)
      return (await readJsonSafe<RegistrationCrmResult>(response))?.status
    }).toBe('ready')
})
