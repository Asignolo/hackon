import { expect, test } from '@playwright/test'
import { proposalReviewMaterialsResponseSchema } from '../data/proposal-review-validators'
import { demoExecutionSchema } from '../data/demo-api-validators'
import { prepareDemoScenarioFixture } from './helpers/demoScenarioFixtures'

export const integrationMeta = { dependsOnModules: ['photographers', 'customers', 'agent_orchestrator', 'workflows'] }

test.describe('TC-PHOTOGRAPHERS-023: fictional demo reaches a real Caseload decision', () => {
  let fixture: Awaited<ReturnType<typeof prepareDemoScenarioFixture>> | undefined
  test.beforeAll(async ({ request }) => { fixture = await prepareDemoScenarioFixture(request) })
  test.afterAll(async () => { await fixture?.cleanup() })

  for (const disposition of ['approved', 'rejected'] as const) test(`completes the ${disposition} decision with exactly one CRM interaction`, async ({ page, baseURL }, testInfo) => {
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
    const materials = proposalReviewMaterialsResponseSchema.parse(await preview.json())
    const message = materials.options[0].materials.find((material) => material.kind === 'message')
    if (!message || message.kind !== 'message') throw new Error('[internal] Review message missing')
    await expect(page.getByRole('region', { name: 'Evaluation materials', exact: true }).getByText(message.data.body, { exact: true })).toBeVisible()
    const disposePath = `/api/agent_orchestrator/proposals/${materials.proposalId}/dispose`
    if (disposition === 'rejected') {
      await page.getByRole('button', { name: 'Reject', exact: true }).click()
      await page.getByRole('textbox', { name: 'Reason', exact: true }).fill('Fictional scenario regression: remain under observation.')
    }
    const disposed = page.waitForResponse((entry) => entry.url().endsWith(disposePath) && entry.request().method() === 'POST')
    await page.getByRole('button', { name: disposition === 'approved' ? 'Approve' : 'Reject proposal', exact: true }).click()
    const decision = await disposed
    expect(decision.status(), await decision.text()).toBe(200)
    expect(await decision.json()).toMatchObject({ proposalId: materials.proposalId, disposition })
    const statusPath = `/api/photographers/demo-evaluations/${execution.requestId}`
    let completed = execution
    await expect.poll(async () => {
      const response = await page.request.get(statusPath)
      expect(response.status(), await response.text()).toBe(200)
      completed = demoExecutionSchema.parse(await response.json())
      return completed.status
    }).toBe(disposition === 'approved' ? 'completed' : 'rejected')
    const current = fixture
    await expect.poll(async () => (await current.inspect(completed)).processStatus).toBe('completed')
    const saved = await current.inspect(completed)
    expect(saved.workflowStatus).toBe('COMPLETED')
    expect(saved.interactions).toHaveLength(1)
    expect(saved.deal?.pipelineStageId).toBe(current.installed.stageIds[disposition === 'approved' ? 'contacted' : 'observed'])
    expect(saved.interactions[0].body).toBe(disposition === 'approved' ? message.data.body : 'Draft rejected')
    expect(saved.interactions[0].title).toBe(disposition === 'approved' ? 'Approved for sending' : 'Draft rejected')
    expect(saved.persistence.outboundMessageLinks).toBe(0)
    expect(JSON.stringify(saved.workflowContext)).not.toContain(message.data.body)
    expect(JSON.stringify(saved.processInput)).not.toContain(message.data.body)
    const resumed = await page.request.post(statusPath, { data: {} })
    expect(resumed.status(), await resumed.text()).toBe(200)
    await current.replayDecision(completed)
    expect((await current.inspect(completed)).interactions.map((entry) => entry.id)).toEqual(saved.interactions.map((entry) => entry.id))
    await page.goto(`/backend/photographers/demo?requestId=${execution.requestId}`, { waitUntil: 'domcontentloaded' })
    await expect(page.getByText(disposition === 'approved' ? 'Approved for sending' : 'Draft rejected', { exact: true })).toBeVisible()
    await page.screenshot({ path: testInfo.outputPath(`demo-${disposition}-completed.png`), fullPage: true })
  })
})
