import { randomUUID } from 'node:crypto'
import { expect, test } from '@playwright/test'
import { apiRequest } from '@open-mercato/core/helpers/integration/api'
import { readJsonSafe } from '@open-mercato/core/helpers/integration/generalFixtures'
import { registrationCrmFixture } from './helpers/registrationCrmFixtures'
import { assessmentResponseSchema } from '../data/assessment-validators'
import en from '../i18n/en.json' with { type: 'json' }

export const integrationMeta = { dependsOnModules: ['photographers', 'customers', 'workflows'] }

test('TC-PHOTOGRAPHERS-027: scoped pending assessment, read-only page and forbidden refresh', async ({ request, page, baseURL }) => {
  const fixture = await registrationCrmFixture(request, ['workflows.instances.view'])
  try {
    const created = await apiRequest(request, 'POST', '/api/photographers/raw-data', {
      token: fixture.token, data: { firstName: 'Assessment', lastName: randomUUID(), email: `${randomUUID()}@example.invalid`, portfolioRaw: 'Controlled integration registration' },
    })
    expect(created.status()).toBe(201)
    const registration = await readJsonSafe<{ id: string }>(created)
    if (!registration || !baseURL) throw new Error('[internal] Missing registration or test base URL')
    const evaluationId = randomUUID()
    const endpoint = `/api/photographers/assessments/${evaluationId}?registrationId=${registration.id}`
    const response = await apiRequest(request, 'GET', endpoint, { token: fixture.token })
    expect(response.status(), await response.text()).toBe(200)
    expect(response.headers()['cache-control']).toBe('no-store')
    const data = assessmentResponseSchema.parse(await readJsonSafe(response))
    expect(data.process.status).toBe('pending')
    expect(data.materials.score).toMatchObject({ status: 'missing', data: null })
    expect(data.research).toEqual({ status: 'unavailable', reason: 'not_saved' })
    const wrongRegistration = await apiRequest(request, 'GET', `/api/photographers/assessments/${evaluationId}?registrationId=${randomUUID()}`, { token: fixture.token })
    expect(wrongRegistration.status()).toBe(404)
    await page.context().addCookies([
      { name: 'auth_token', value: fixture.token, url: baseURL, httpOnly: true },
      { name: 'om_selected_org', value: fixture.organizationId, url: baseURL },
      { name: 'om_selected_tenant', value: fixture.tenantId, url: baseURL },
      { name: 'locale', value: 'en', url: baseURL },
      { name: 'om_demo_notice_ack', value: 'ack', url: baseURL },
      { name: 'om_cookie_notice_ack', value: 'ack', url: baseURL },
      { name: 'om_feedback_suppress', value: '1', url: baseURL },
    ])
    const writes: string[] = []
    page.on('request', (incoming) => {
      if (incoming.url().includes('/api/photographers/') && incoming.method() !== 'GET') writes.push(incoming.method())
    })
    await page.goto(`/backend/photographers/assessment?evaluationId=${evaluationId}&registrationId=${registration.id}`)
    await expect(page.getByRole('region', { name: en['photographers.assessment.progress'] })).toContainText(en['photographers.assessment.status.pending'])
    await expect(page.getByRole('region', { name: en['photographers.assessment.score'], exact: true })).toContainText(en['photographers.assessment.material.missing'])
    await page.route(`**/api/photographers/assessments/${evaluationId}?*`, (route) => route.fulfill({ status: 403, contentType: 'application/json', body: '{}' }))
    await page.getByRole('button', { name: en['photographers.materials.refresh'], exact: true }).click()
    await expect(page.getByText(en['photographers.assessment.load.forbidden'], { exact: true })).toBeVisible()
    await expect(page.getByRole('region', { name: en['photographers.assessment.registration'] })).toHaveCount(0)
    expect(writes).toEqual([])
  } finally { await fixture.cleanup() }
})
