/** @jest-environment jsdom */

import * as React from 'react'
import { act, screen, waitFor } from '@testing-library/react'
import { renderWithProviders } from '@open-mercato/shared/lib/testing/renderWithProviders'
import { apiCall } from '@open-mercato/ui/backend/utils/apiCall'
import ProcessDetailPage from '../backend/processes/[id]/page'
import { mapProcessDetailProjection, mapProcessProjection } from '../components/processTypes'
import en from '../i18n/en.json'

jest.mock('@open-mercato/ui/backend/detail', () => ({
  ...jest.requireActual('@open-mercato/ui/backend/detail/LoadingMessage'),
  ...jest.requireActual('@open-mercato/ui/backend/detail/ErrorMessage'),
}))

jest.mock('next/navigation', () => ({ useRouter: () => ({ push: jest.fn(), back: jest.fn() }) }))
jest.mock('@open-mercato/ui/backend/utils/apiCall', () => ({ apiCall: jest.fn() }))

const executionId = '11111111-1111-4111-8111-111111111111'
const workflowId = '22222222-2222-4222-8222-222222222222'
const execution = { id: executionId, workflowInstanceId: null, subjectTitle: 'Photographer assessment', status: 'running' }

function respondWith(row: Record<string, unknown>) {
  jest.mocked(apiCall).mockImplementation(async (url) => ({
    ok: true,
    status: 200,
    result: String(url).includes('/executions/') ? { execution: row, milestones: [], outcome: null } : { items: [] },
    response: {} as Response,
    cacheStatus: null,
  }))
}

beforeEach(() => jest.clearAllMocks())
afterEach(() => jest.useRealTimers())

it('keeps execution identity separate while the workflow has not been created', () => {
  expect(mapProcessDetailProjection(execution)).toMatchObject({ executionId, workflowInstanceId: null, status: 'running' })
  expect(mapProcessProjection(execution)).toBeNull()
})

it('renders a queued execution without asking for proposals under its execution id', async () => {
  respondWith(execution)
  renderWithProviders(<ProcessDetailPage params={{ id: executionId }} />, { dict: en })
  await screen.findByText('Photographer assessment')
  expect(screen.getByText(en['agent_orchestrator.evalRuns.status.queued'])).toBeTruthy()
  expect(screen.queryByText(en['agent_orchestrator.process.detail.error'])).toBeNull()
  expect(apiCall).toHaveBeenCalledTimes(1)
})

it('shows failure before a workflow exists and does not poll or request proposals', async () => {
  jest.useFakeTimers()
  respondWith({ ...execution, status: 'failed', failureReason: 'Required encryption map is unavailable' })
  renderWithProviders(<ProcessDetailPage params={{ id: executionId }} />, { dict: en })
  await screen.findByText('Required encryption map is unavailable')
  expect(screen.getByText(en['agent_orchestrator.process.status.failed'])).toBeTruthy()
  await act(async () => { jest.advanceTimersByTime(4000) })
  expect(apiCall).toHaveBeenCalledTimes(1)
})

it('resolves the workflow id before requesting proposals for a linked execution', async () => {
  respondWith({ ...execution, workflowInstanceId: workflowId })
  renderWithProviders(<ProcessDetailPage params={{ id: executionId }} />, { dict: en })
  await screen.findByText('Photographer assessment')
  expect(apiCall).toHaveBeenNthCalledWith(2,
    `/api/agent_orchestrator/proposals?workflowInstanceId=${workflowId}&pageSize=100&sortField=createdAt&sortDir=asc`,
    undefined, { fallback: { items: [] } },
  )
})

it('refreshes a pending execution until the worker links its workflow', async () => {
  jest.useFakeTimers()
  respondWith(execution)
  renderWithProviders(<ProcessDetailPage params={{ id: executionId }} />, { dict: en })
  await screen.findByText(en['agent_orchestrator.evalRuns.status.queued'])
  respondWith({ ...execution, workflowInstanceId: workflowId })
  await act(async () => { jest.advanceTimersByTime(2000) })
  await waitFor(() => expect(apiCall).toHaveBeenCalledTimes(3))
  expect(screen.queryByText(en['agent_orchestrator.evalRuns.status.queued'])).toBeNull()
})
