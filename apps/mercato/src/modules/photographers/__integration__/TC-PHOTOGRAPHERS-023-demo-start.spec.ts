import { expect, test } from '@playwright/test'
import { demoExecutionSchema } from '../data/demo-api-validators'
import { prepareDemoScenarioFixture } from './helpers/demoScenarioFixtures'

export const integrationMeta = { dependsOnModules: ['photographers', 'customers', 'agent_orchestrator', 'workflows'] }

test.describe('TC-PHOTOGRAPHERS-023: fictional demo reaches a real Caseload decision', () => {
  let fixture: Awaited<ReturnType<typeof prepareDemoScenarioFixture>> | undefined
  test.beforeAll(async ({ request }) => { fixture = await prepareDemoScenarioFixture(request) })
  test.afterAll(async () => { await fixture?.cleanup() })

  test('starts from the demo page and exposes full materials for a pending human decision', async ({ page, baseURL }, testInfo) => {
    test.slow()
    if (!fixture || !baseURL) throw new Error('[internal] Demo fixture and runner base URL required')
    await page.context().addCookies([
      { name: 'auth_token', value: fixture.token, url: baseURL, httpOnly: true },
      { name: 'om_selected_org', value: fixture.organizationId, url: baseURL },
      { name: 'om_selected_tenant', value: fixture.tenantId, url: baseURL },
      { name: 'om_demo_notice_ack', value: 'ack', url: baseURL },
      { name: 'om_cookie_notice_ack', value: 'ack', url: baseURL },
      { name: 'om_feedback_suppress', value: '1', url: baseURL },
    ])
    await page.goto('/backend/photographers/demo', { waitUntil: 'domcontentloaded' })
    await expect(page.getByRole('heading', { name: 'Demonstration scenario', exact: true })).toBeVisible()
    const started = page.waitForResponse((response) => response.url().endsWith('/api/photographers/demo-evaluations') && response.request().method() === 'POST')
    await page.getByRole('button', { name: 'Create a fictional photographer and start', exact: true }).click()
    const response = await started
    expect(response.status(), await response.text()).toBe(202)
    const execution = demoExecutionSchema.parse(await response.json())
    expect(execution.registrationId).toBeTruthy()
    await expect(page.getByRole('link', { name: 'Open decision in Caseload', exact: true })).toBeVisible()
    const previewResponse = page.waitForResponse((entry) => /\/api\/photographers\/proposals\/[^/]+\/materials$/.test(entry.url()))
    await page.getByRole('link', { name: 'Open decision in Caseload', exact: true }).click()
    const preview = await previewResponse
    expect(preview.status(), await preview.text()).toBe(200)
    await expect(page.getByRole('region', { name: 'Evaluation materials', exact: true })).toBeVisible()
    await expect(page.getByRole('button', { name: 'Approve', exact: true })).toBeVisible()
    await expect(page.getByRole('button', { name: 'Reject', exact: true })).toBeVisible()
    await page.screenshot({ path: testInfo.outputPath('demo-awaiting-human-review.png'), fullPage: true })
  })
})
