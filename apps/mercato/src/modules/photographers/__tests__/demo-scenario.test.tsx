/** @jest-environment jsdom */
import * as React from 'react'
import { TextEncoder } from 'node:util'
import { act, fireEvent, screen, waitFor } from '@testing-library/react'
import { renderWithProviders } from '@open-mercato/shared/lib/testing/renderWithProviders'
import { emitOrganizationScopeChanged } from '@open-mercato/shared/lib/frontend/organizationEvents'
import { readApiResultOrThrow } from '@open-mercato/ui/backend/utils/apiCall'
import DemoScenario from '../components/DemoScenario'
import en from '../i18n/en.json'

jest.mock('next/navigation', () => ({ useSearchParams: () => new URLSearchParams(window.location.search) }))
jest.mock('@open-mercato/ui/backend/forms', () => ({ FormHeader: ({ title }: { title: string }) => <h1>{title}</h1> }))
jest.mock('@open-mercato/ui/backend/utils/apiCall', () => ({ readApiResultOrThrow: jest.fn() }))
jest.mock('@open-mercato/ui/backend/injection/useGuardedMutation', () => ({ useGuardedMutation: () => ({ runMutation: ({ operation }: { operation: () => Promise<unknown> }) => operation(), retryLastMutation: jest.fn() }) }))

const id = '11111111-1111-4111-8111-111111111111'
const response = { requestId: id, executionId: id, workflowInstanceId: id, status: 'awaiting_review', registrationId: id, photographerId: id, personId: id, dealId: id, evaluationId: id, runIds: [], proposalId: id, materialRefs: {}, links: { person: `/backend/customers/people/${id}`, deal: `/backend/customers/deals/${id}`, proposal: `/backend/caseload/${id}` } }

beforeAll(() => { Object.defineProperty(globalThis, 'TextEncoder', { value: TextEncoder, configurable: true }) })
beforeEach(() => { jest.clearAllMocks(); window.history.replaceState(null, '', '/backend/photographers/demo') })

test('keeps an in-flight start when the initial organization scope arrives', async () => {
  emitOrganizationScopeChanged({ tenantId: null, organizationId: null })
  let finishStart: (value: unknown) => void = () => undefined
  const read = jest.mocked(readApiResultOrThrow)
  read.mockImplementationOnce(() => new Promise((resolve) => { finishStart = resolve }))
  renderWithProviders(<DemoScenario />, { dict: en })
  fireEvent.click(screen.getByRole('button', { name: 'Create a fictional photographer and start' }))
  act(() => { emitOrganizationScopeChanged({ tenantId: 'initial', organizationId: 'initial' }) })
  await act(async () => { finishStart(response) })
  await screen.findByRole('link', { name: 'Open decision in Caseload' })
  expect(read).toHaveBeenCalledTimes(1)
})

test('retries an uncertain start with the same request ID', async () => {
  const read = jest.mocked(readApiResultOrThrow)
  read.mockRejectedValueOnce(new Error('Connection interrupted')).mockResolvedValue(response)
  renderWithProviders(<DemoScenario />, { dict: en })
  fireEvent.click(screen.getByRole('button', { name: 'Create a fictional photographer and start' }))
  await screen.findByText('Connection interrupted')
  const firstBody = read.mock.calls[0][1]?.body
  fireEvent.click(screen.getByRole('button', { name: 'Continue this scenario' }))
  await screen.findByRole('link', { name: 'Open decision in Caseload' })
  const writes = read.mock.calls.filter((call) => call[1]?.method === 'POST')
  expect(writes).toHaveLength(2)
  expect(writes[1][1]?.body).toBe(firstBody)
  expect(new URLSearchParams(window.location.search).get('requestId')).toBeTruthy()
})

test('removes previous organization links and ignores a late refresh after scope change', async () => {
  emitOrganizationScopeChanged({ tenantId: 'original', organizationId: 'original' })
  window.history.replaceState(null, '', `/backend/photographers/demo?requestId=${id}`)
  let resolveOld: (value: unknown) => void = () => undefined
  const read = jest.mocked(readApiResultOrThrow)
  read.mockResolvedValueOnce(response).mockImplementationOnce(() => new Promise((resolve) => { resolveOld = resolve })).mockRejectedValue(new Error('Not found'))
  renderWithProviders(<DemoScenario />, { dict: en })
  await screen.findByRole('link', { name: 'Open decision in Caseload' })
  fireEvent.click(screen.getByRole('button', { name: 'Refresh status' }))
  await waitFor(() => expect(read).toHaveBeenCalledTimes(2))
  act(() => { emitOrganizationScopeChanged({ tenantId: 'other', organizationId: 'other' }) })
  expect(screen.queryByRole('link', { name: 'Open decision in Caseload' })).toBeNull()
  await act(async () => { resolveOld(response) })
  expect(screen.queryByRole('link', { name: 'Open decision in Caseload' })).toBeNull()
})

test('starts the selected registration and shows the O1 boundary without claiming evaluation completion', async () => {
  window.history.replaceState(null, '', `/backend/photographers/demo?registrationId=${id}`)
  const read = jest.mocked(readApiResultOrThrow)
  read.mockResolvedValue({ ...response, status: 'running', proposalId: null, links: { person: response.links.person, deal: response.links.deal }, o1: { status: 'completed', runId: id, tracesRef: id, nextStage: 'o2', sourcesAccepted: true } })
  renderWithProviders(<DemoScenario />, { dict: en })
  fireEvent.click(screen.getByRole('button', { name: 'Run O1 for this photographer' }))
  await waitFor(() => expect(screen.getAllByText('O1 saved — awaiting O2 integration').length).toBeGreaterThan(0))
  const sent = JSON.parse(String(read.mock.calls.find((call) => call[1]?.method === 'POST')?.[1]?.body))
  expect(sent.registrationId).toBe(id)
  expect(screen.queryByRole('link', { name: 'Open decision in Caseload' })).toBeNull()
  expect(await screen.findByText('Assessment in progress')).toBeTruthy()
})
