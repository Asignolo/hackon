import { randomUUID } from 'node:crypto'
import { expect, test } from '@playwright/test'
import { apiRequest } from '@open-mercato/core/helpers/integration/api'
import { withClient } from '@open-mercato/core/helpers/integration/dbFixtures'
import { readJsonSafe } from '@open-mercato/core/helpers/integration/generalFixtures'
import { registrationCrmFixture } from './helpers/registrationCrmFixtures'
import { registrationCrmResponseSchema } from '../data/registration-crm-validators'
import en from '../i18n/en.json' with { type: 'json' }

export const integrationMeta = { dependsOnModules: ['photographers', 'customers', 'workflows'] }

test('TC-PHOTOGRAPHERS-028: photographer card reopens the latest saved assessment without starting research', async ({ request, page, baseURL }, testInfo) => {
  const fixture = await registrationCrmFixture(request, ['workflows.*'])
  try {
    const created = await apiRequest(request, 'POST', '/api/photographers/raw-data', {
      token: fixture.token,
      data: { firstName: 'Assessment', lastName: randomUUID(), email: `${randomUUID()}@example.invalid`, portfolioRaw: 'Controlled integration registration' },
    })
    expect(created.status(), await created.text()).toBe(201)
    const registration = await readJsonSafe<{ id: string }>(created)
    if (!registration || !baseURL) throw new Error('[internal] Missing registration or test base URL')
    const prepared = await apiRequest(request, 'POST', `/api/photographers/registrations/${registration.id}/crm`, { token: fixture.token, data: {} })
    expect(prepared.status(), await prepared.text()).toBe(200)
    const crm = registrationCrmResponseSchema.parse(await readJsonSafe(prepared))
    if (!crm.photographerId || !crm.links) throw new Error('[internal] Missing CRM person')
    const endpoint = `/api/photographers/people/${crm.photographerId}/assessment`
    const empty = await apiRequest(request, 'GET', endpoint, { token: fixture.token })
    expect(empty.status(), await empty.text()).toBe(200)
    expect(await readJsonSafe(empty)).toEqual({ assessment: null })
    await page.context().addCookies([
      { name: 'auth_token', value: fixture.token, url: baseURL, httpOnly: true },
      { name: 'om_selected_org', value: fixture.organizationId, url: baseURL },
      { name: 'om_selected_tenant', value: fixture.tenantId, url: baseURL },
      { name: 'locale', value: 'en', url: baseURL },
      { name: 'om_demo_notice_ack', value: 'ack', url: baseURL },
      { name: 'om_cookie_notice_ack', value: 'ack', url: baseURL },
      { name: 'om_feedback_suppress', value: '1', url: baseURL },
    ])
    await page.goto(crm.links.person)
    await expect(page.getByText(en['photographers.assessment.noAssessment'], { exact: true })).toBeVisible()
    const workflowId = `qa-assessment-${randomUUID()}`
    const definition = await apiRequest(request, 'POST', '/api/workflows/definitions', {
      token: fixture.token,
      data: {
        workflowId, workflowName: 'QA saved assessment', version: 1,
        definition: {
          steps: [{ stepId: 'start', stepName: 'Start', stepType: 'START' }, { stepId: 'end', stepName: 'End', stepType: 'END' }],
          transitions: [{ transitionId: 'finish', fromStepId: 'start', toStepId: 'end', trigger: 'auto' }],
        },
      },
    })
    expect(definition.status(), await definition.text()).toBe(201)
    const evaluationIds = [randomUUID(), randomUUID()]
    for (const evaluationId of evaluationIds) {
      const instance = await apiRequest(request, 'POST', '/api/workflows/instances', {
        token: fixture.token,
        data: { workflowId, initialContext: { evaluationId, registrationId: registration.id } },
      })
      expect(instance.status(), await instance.text()).toBe(201)
    }
    const latest = await apiRequest(request, 'GET', endpoint, { token: fixture.token })
    expect(latest.status(), await latest.text()).toBe(200)
    expect(latest.headers()['cache-control']).toBe('no-store')
    expect(await readJsonSafe(latest)).toEqual({ assessment: { evaluationId: evaluationIds[1], registrationId: registration.id } })
    const writes: string[] = []
    page.on('request', (incoming) => {
      if (/\/api\/(photographers|workflows)\//.test(incoming.url()) && incoming.method() !== 'GET') writes.push(incoming.url())
    })
    await page.reload()
    const assessmentLink = page.getByRole('link', { name: en['photographers.assessment.openLatest'], exact: true })
    await expect(assessmentLink).toBeVisible()
    const cardScreenshot = testInfo.outputPath('photographer-card-assessment-link.png')
    await page.screenshot({ path: cardScreenshot, fullPage: true })
    await testInfo.attach('photographer-card-assessment-link', { path: cardScreenshot, contentType: 'image/png' })
    await assessmentLink.click()
    await expect(page).toHaveURL(new RegExp(`/backend/photographers/assessment\\?evaluationId=${evaluationIds[1]}&registrationId=${registration.id}$`))
    await expect(page.getByRole('region', { name: en['photographers.assessment.registration'] })).toBeVisible()
    await page.reload()
    await expect(page.getByRole('region', { name: en['photographers.assessment.registration'] })).toBeVisible()
    expect(writes).toEqual([])
    const assessmentScreenshot = testInfo.outputPath('reopened-assessment.png')
    await page.screenshot({ path: assessmentScreenshot, fullPage: true })
    await testInfo.attach('reopened-assessment', { path: assessmentScreenshot, contentType: 'image/png' })
  } finally {
    try {
      await withClient(async (client) => {
        for (const table of ['workflow_events', 'step_instances', 'workflow_branch_instances', 'workflow_instances', 'workflow_definitions']) {
          await client.query(`delete from ${table} where tenant_id=$1 and organization_id=$2`, [fixture.tenantId, fixture.organizationId])
        }
      })
    } finally { await fixture.cleanup() }
  }
})
