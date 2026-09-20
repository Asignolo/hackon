/** @jest-environment jsdom */
import * as React from 'react'
import { act, fireEvent, screen, waitFor, within } from '@testing-library/react'
import { renderWithProviders } from '@open-mercato/shared/lib/testing/renderWithProviders'
import { emitOrganizationScopeChanged } from '@open-mercato/shared/lib/frontend/organizationEvents'
import AssessmentDetails from '../components/AssessmentDetails'
import AssessmentPage from '../components/AssessmentPage'
import { loadAssessment, type AssessmentLoadResult } from '../lib/assessment-view'
import en from '../i18n/en.json'
import { assessmentFixture as withMaterials, emptyAssessmentFixture as fixture } from './assessment-fixture'

jest.mock('next/navigation', () => ({ useSearchParams: () => new URLSearchParams(window.location.search) }))
jest.mock('@open-mercato/ui/backend/forms', () => ({ FormHeader: ({ title, statusBadge }: { title: string; statusBadge: React.ReactNode }) => <header><h1>{title}</h1>{statusBadge}</header> }))
jest.mock('../lib/assessment-view', () => ({ ...jest.requireActual('../lib/assessment-view'), loadAssessment: jest.fn() }))
const evaluationId = '11111111-1111-4111-8111-111111111111'
const registrationId = '22222222-2222-4222-8222-222222222222'
const label = (key: string) => (en as Record<string, string>)[key] ?? key
const assessmentLabel = (key: string) => label(`photographers.assessment.${key}`)
beforeEach(() => {
  jest.resetAllMocks()
  window.history.replaceState(null, '', `/backend/photographers/assessment?evaluationId=${evaluationId}&registrationId=${registrationId}`)
})

it('keeps a registered photographer and existing workflow pending without claiming success', () => {
  renderWithProviders(<AssessmentDetails assessment={fixture()} />, { dict: en })
  expect(screen.getByRole('heading', { name: 'Anna Photo' })).toBeTruthy()
  expect(screen.getByText('anna@example.test')).toBeTruthy()
  expect(screen.getByRole('link', { name: label('photographers.simulator.openPerson') }).getAttribute('href')).toBe(`/backend/customers/people/${evaluationId}`)
  expect(within(screen.getByRole('region', { name: assessmentLabel('progress') })).getByText(assessmentLabel('status.pending'))).toBeTruthy()
  expect(screen.queryByText(assessmentLabel('status.completed'))).toBeNull()
})

it('links the CRM customer entity rather than its profile and ignores supplied arbitrary links', () => {
  const data = fixture()
  data.owners = { photographerId: evaluationId, personId: '33333333-3333-4333-8333-333333333333', dealId: registrationId, links: { person: 'javascript:alert(1)', deal: 'https://unrelated.example.test' } }
  renderWithProviders(<AssessmentDetails assessment={data} />, { dict: en })
  expect(screen.getByRole('link', { name: label('photographers.simulator.openPerson') }).getAttribute('href')).toBe(`/backend/customers/people/${evaluationId}`)
  expect(screen.getByRole('link', { name: label('photographers.simulator.openDeal') }).getAttribute('href')).toBe(`/backend/customers/deals/${registrationId}`)
})

it('shows partial saved evidence, safe source links, category, points and missing facts', () => {
  const data = withMaterials()
  data.process.status = 'partial'
  data.researchView = { status: 'partial', summary: 'Two sources read; one timed out', sources: [{ url: 'https://research.example.test', status: 'timeout', summary: 'Request timed out' }] }
  renderWithProviders(<AssessmentDetails assessment={data} />, { dict: en })
  expect(screen.getByText('Saved discovery evidence')).toBeTruthy()
  expect(screen.getByText('Saved category evidence')).toBeTruthy()
  expect(screen.getByText('Two sources read; one timed out')).toBeTruthy()
  expect(screen.getByText('Request timed out')).toBeTruthy()
  expect(screen.getByText('javascript:alert(1)').closest('a')).toBeNull()
  expect(screen.getByRole('link', { name: 'https://research.example.test' }).getAttribute('rel')).toBe('noopener noreferrer')
  const score = within(screen.getByRole('region', { name: assessmentLabel('score') }))
  expect(score.getByText(/rules-test-v1/)).toBeTruthy()
  expect(score.getByText(/saved-rule/)).toBeTruthy()
  expect(score.getByText(label('photographers.materials.facts.instagramFollowers'))).toBeTruthy()
})

it('renders completed status only when persisted and keeps absent o2 visibly unavailable', () => {
  const data = withMaterials()
  data.process.status = 'completed'
  renderWithProviders(<AssessmentDetails assessment={data} />, { dict: en })
  expect(within(screen.getByRole('region', { name: assessmentLabel('progress') })).getByText(assessmentLabel('status.completed'))).toBeTruthy()
  expect(screen.getByText(assessmentLabel('researchUnavailable'))).toBeTruthy()
})

it('shows process failure and failed o2 while preserving partial evidence', () => {
  const data = withMaterials()
  data.process.status = 'failed'
  data.researchView.status = 'failed'
  renderWithProviders(<AssessmentDetails assessment={data} />, { dict: en })
  expect(screen.getByText(assessmentLabel('processFailed'))).toBeTruthy()
  expect(screen.getByText(assessmentLabel('researchFailed'))).toBeTruthy()
  expect(screen.getByText('Saved discovery evidence')).toBeTruthy()
})

it('never renders demo fixture materials as real findings', () => {
  const data = withMaterials()
  data.source = 'demo_fixture'
  renderWithProviders(<AssessmentDetails assessment={data} />, { dict: en })
  expect(screen.getByText(assessmentLabel('source.demo_fixture'))).toBeTruthy()
  expect(screen.queryByText('Saved discovery evidence')).toBeNull()
  expect(screen.queryByRole('region', { name: assessmentLabel('score') })).toBeNull()
})

it.each(['forbidden', 'failed', 'invalid', 'notFound'] as const)('shows the %s load state without private record content', async (state) => {
  jest.mocked(loadAssessment).mockResolvedValue({ state })
  renderWithProviders(<AssessmentPage />, { dict: en })
  await screen.findByText(assessmentLabel(state === 'notFound' ? 'notFound' : `load.${state}`))
  expect(screen.queryByText('anna@example.test')).toBeNull()
})

it('converts a rejected request into a readable error', async () => {
  jest.mocked(loadAssessment).mockRejectedValue(new Error('offline'))
  renderWithProviders(<AssessmentPage />, { dict: en })
  await screen.findByText(assessmentLabel('load.failed'))
})

it('clears old organization data and ignores a late previous-scope refresh', async () => {
  let finishOld: (value: AssessmentLoadResult) => void = () => undefined
  const request = jest.mocked(loadAssessment)
  request.mockResolvedValueOnce({ state: 'ready', data: fixture() })
    .mockImplementationOnce(() => new Promise((resolve) => { finishOld = resolve }))
    .mockResolvedValueOnce({ state: 'forbidden' })
  emitOrganizationScopeChanged({ tenantId: 'first', organizationId: 'first' })
  renderWithProviders(<AssessmentPage />, { dict: en })
  await screen.findByText('anna@example.test')
  fireEvent.click(screen.getByRole('button', { name: label('photographers.materials.refresh') }))
  await waitFor(() => expect(request).toHaveBeenCalledTimes(2))
  const oldSignal = request.mock.calls[1][1]
  act(() => { emitOrganizationScopeChanged({ tenantId: 'second', organizationId: 'second' }) })
  expect(screen.queryByText('anna@example.test')).toBeNull()
  await screen.findByText(assessmentLabel('load.forbidden'))
  expect(oldSignal?.aborted).toBe(true)
  await act(async () => { finishOld({ state: 'ready', data: fixture() }) })
  expect(screen.queryByText('anna@example.test')).toBeNull()
})
