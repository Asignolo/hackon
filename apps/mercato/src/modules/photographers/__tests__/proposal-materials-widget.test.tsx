/** @jest-environment jsdom */
import * as React from 'react'
import { TextEncoder } from 'node:util'
import { act, fireEvent, screen, waitFor } from '@testing-library/react'
import { renderWithProviders } from '@open-mercato/shared/lib/testing/renderWithProviders'
import { readApiResultOrThrow } from '@open-mercato/ui/backend/utils/apiCall'
import ProposalMaterialsWidget from '../widgets/injection/proposal-materials/widget.client'
import en from '../i18n/en.json'

jest.mock('@open-mercato/ui/backend/utils/apiCall', () => ({ readApiResultOrThrow: jest.fn() }))

const proposalId = '11111111-1111-4111-8111-111111111111'
const nextProposalId = '22222222-2222-4222-8222-222222222222'
const factsId = '33333333-3333-4333-8333-333333333333'
const messageId = '44444444-4444-4444-8444-444444444444'
const updatedAt = '2026-09-19T12:00:00.000Z'
const body = 'Hello!\nThis is the complete proposed message.\nNo text is truncated.'
const common = { schemaVersion: 1, evaluationId: proposalId, updatedAt, photographerId: proposalId, personId: factsId, dealId: messageId }
function response(id = proposalId) {
  return {
    proposalId: id, proposalUpdatedAt: updatedAt,
    options: [{
      selectedOptionId: 'accept', label: 'Approve the proposed message',
      materials: [
        { ...common, id: factsId, kind: 'facts', data: { schemaVersion: 1, evaluationId: proposalId, evaluatedAt: updatedAt, facts: [], tracesRef: factsId } },
        { ...common, id: messageId, kind: 'message', data: { schemaVersion: 1, evaluationId: proposalId, recipientSource: 'registration', body, allowedEvidenceRefs: [], internalRationale: 'A synthetic fixture for the review.', createdAt: updatedAt, factsRef: factsId } },
      ],
    }],
  }
}
const request = jest.mocked(readApiResultOrThrow)
const view = (id: string) => <ProposalMaterialsWidget context={{ path: `/backend/caseload/${id}` }} />

beforeAll(() => { Object.defineProperty(globalThis, 'TextEncoder', { value: TextEncoder, configurable: true }) })
beforeEach(() => jest.resetAllMocks())

it('shows the complete message on the existing detail page without adding decision controls', async () => {
  request.mockResolvedValue(response())
  renderWithProviders(view(proposalId), { dict: en })
  await waitFor(() => expect(screen.getByText(/This is the complete proposed message/).textContent).toBe(body))
  expect(screen.getByText('Approve the proposed message')).toBeTruthy()
  expect(request).toHaveBeenCalledWith(`/api/photographers/proposals/${proposalId}/materials`, { cache: 'no-store' })
  expect(screen.getAllByRole('button')).toHaveLength(1)
})

it('does not request data on other pages or expose a late result after navigating to another proposal', async () => {
  let finish: (value: unknown) => void = () => undefined
  request.mockImplementationOnce(() => new Promise((resolve) => { finish = resolve }))
    .mockResolvedValueOnce({ proposalId: nextProposalId, proposalUpdatedAt: updatedAt, options: [] })
  const rendered = renderWithProviders(<ProposalMaterialsWidget context={{ path: '/backend/caseload' }} />, { dict: en })
  expect(request).not.toHaveBeenCalled()
  rendered.rerender(view(proposalId))
  rendered.rerender(view(nextProposalId))
  await waitFor(() => expect(request).toHaveBeenCalledTimes(2))
  await act(async () => { finish(response()) })
  expect(screen.queryByText(/This is the complete proposed message/)).toBeNull()
})

it('shows failure and supports retry without rendering unvalidated materials', async () => {
  request.mockResolvedValueOnce({ ...response(), proposalId: nextProposalId }).mockResolvedValueOnce(response())
  renderWithProviders(view(proposalId), { dict: en })
  await screen.findByText(en['photographers.materials.unavailable'])
  expect(screen.queryByText(/This is the complete proposed message/)).toBeNull()
  fireEvent.click(screen.getByRole('button', { name: en['photographers.materials.refresh'] }))
  await screen.findByText(/This is the complete proposed message/)
})
