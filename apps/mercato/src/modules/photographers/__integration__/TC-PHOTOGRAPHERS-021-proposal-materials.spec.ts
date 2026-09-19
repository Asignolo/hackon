import { expect, test } from '@playwright/test'
import { apiRequest, getAuthToken } from '@open-mercato/core/helpers/integration/api'
import { getTokenScope, readJsonSafe } from '@open-mercato/core/helpers/integration/generalFixtures'
import { proposalReviewMaterialsResponseSchema } from '../data/proposal-review-validators'
import { prepareProposalReviewFixture } from './helpers/proposalReviewFixtures'

export const integrationMeta = { dependsOnModules: ['photographers', 'customers', 'agent_orchestrator'] }

test.describe('TC-PHOTOGRAPHERS-021: encrypted proposal materials in native Caseload', () => {
  let fixture: Awaited<ReturnType<typeof prepareProposalReviewFixture>> | undefined
  let token: string

  test.beforeAll(async ({ request }) => {
    token = await getAuthToken(request, 'superadmin')
    fixture = await prepareProposalReviewFixture(getTokenScope(token))
  })

  test.afterAll(async () => { await fixture?.cleanup() })

  test('requires material access, renders the complete message and preserves native rejection', async ({ page, baseURL }, testInfo) => {
    if (!fixture || !baseURL) throw new Error('[internal] Proposal fixture and runner base URL required')
    const current = fixture
    const scope = getTokenScope(token)
    await page.context().addCookies([
      { name: 'auth_token', value: token, url: baseURL, httpOnly: true },
      { name: 'om_selected_org', value: scope.organizationId, url: baseURL },
      { name: 'om_selected_tenant', value: scope.tenantId, url: baseURL },
      { name: 'om_demo_notice_ack', value: 'ack', url: baseURL },
      { name: 'om_cookie_notice_ack', value: 'ack', url: baseURL },
      { name: 'om_feedback_suppress', value: '1', url: baseURL },
    ])
    expect(await current.accessEvidence()).toHaveLength(0)
    const disposePath = `/api/agent_orchestrator/proposals/${current.proposalId}/dispose`
    const blocked = await apiRequest(page.request, 'POST', disposePath, {
      token, data: { disposition: 'approved', selectedOptionId: 'accept' },
      headers: { 'x-om-ext-optimistic-lock-expected-updated-at': current.updatedAt },
    })
    expect(blocked.status(), await blocked.text()).toBe(409)
    expect(await readJsonSafe(blocked)).toEqual({ error: 'Open the current full materials before approving this proposal.' })
    const proposal = await apiRequest(page.request, 'GET', `/api/agent_orchestrator/proposals?id=${current.proposalId}`, { token })
    expect(proposal.status()).toBe(200)
    expect(await proposal.text()).not.toContain('Synthetic review message.')
    expect(await proposal.text()).not.toContain(current.sourceRef)

    const materialPath = `/api/photographers/proposals/${current.proposalId}/materials`
    const previewResponse = page.waitForResponse((response) => response.url().endsWith(materialPath))
    await page.goto(`/backend/caseload/${current.proposalId}`, { waitUntil: 'domcontentloaded' })
    const preview = await previewResponse
    expect(preview.status(), await preview.text()).toBe(200)
    expect(preview.headers()['cache-control']).toContain('no-store')
    const materials = proposalReviewMaterialsResponseSchema.parse(await preview.json())
    expect(materials.options.map((option) => option.selectedOptionId)).toEqual(['accept'])
    const region = page.getByRole('region', { name: 'Evaluation materials', exact: true })
    await expect(region.getByRole('term')).toHaveText('Own domain')
    await expect(region.getByRole('definition')).toHaveText(['Yes', `Source: ${current.sourceRef}`])
    await expect(region.getByText(current.body, { exact: true })).toBeVisible()
    await expect(region.getByText('Synthetic reasoning for a browser proof.', { exact: true })).toBeVisible()
    const evidence = await current.accessEvidence()
    expect(evidence).toHaveLength(1)
    expect(JSON.stringify(evidence[0].contextJson)).not.toContain('Synthetic review message.')
    expect(JSON.stringify(evidence[0].contextJson)).not.toContain(current.sourceRef)

    const refreshResponse = page.waitForResponse((response) => response.url().endsWith(materialPath))
    await region.getByRole('button', { name: 'Refresh materials', exact: true }).click()
    expect((await refreshResponse).status()).toBe(200)
    await expect(region.getByText(current.body, { exact: true })).toBeVisible()
    await page.screenshot({ path: testInfo.outputPath('full-proposal-materials.png'), fullPage: true })
    await page.getByRole('button', { name: 'Reject', exact: true }).click()
    await page.getByRole('textbox', { name: 'Reason', exact: true }).fill('Synthetic review proof: reject without sending.')
    const rejectionResponse = page.waitForResponse((response) => response.url().endsWith(disposePath) && response.request().method() === 'POST')
    await page.getByRole('button', { name: 'Reject proposal', exact: true }).click()
    const rejected = await rejectionResponse
    expect(rejected.status(), await rejected.text()).toBe(200)
    expect(await rejected.json()).toMatchObject({ proposalId: current.proposalId, disposition: 'rejected' })
  })
})
