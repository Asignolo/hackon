/** @jest-environment jsdom */
import * as React from 'react'
import { TextEncoder } from 'node:util'
import { act, screen, waitFor } from '@testing-library/react'
import { renderWithProviders } from '@open-mercato/shared/lib/testing/renderWithProviders'
import { emitOrganizationScopeChanged } from '@open-mercato/shared/lib/frontend/organizationEvents'
import { readApiResultOrThrow } from '@open-mercato/ui/backend/utils/apiCall'
import ProposalMaterialsWidget from '../widgets/injection/proposal-materials/widget.client'
import en from '../i18n/en.json'

jest.mock('@open-mercato/ui/backend/utils/apiCall', () => ({ readApiResultOrThrow: jest.fn() }))

const proposalId = 'abcdefab-1111-4111-8111-111111111111'
const factsId = '33333333-3333-4333-8333-333333333333'
const messageId = '44444444-4444-4444-8444-444444444444'
const updatedAt = '2026-09-19T12:00:00.000Z'
const body = 'Private synthetic material from the first organization'
const common = { schemaVersion: 1, evaluationId: proposalId, updatedAt, photographerId: proposalId, personId: factsId, dealId: messageId }
const response = {
  proposalId, proposalUpdatedAt: updatedAt,
  options: [{ selectedOptionId: 'accept', label: 'Option', materials: [
    { ...common, id: factsId, kind: 'facts', data: { schemaVersion: 1, evaluationId: proposalId, evaluatedAt: updatedAt, facts: [], tracesRef: factsId } },
    { ...common, id: messageId, kind: 'message', data: { schemaVersion: 1, evaluationId: proposalId, recipientSource: 'registration', body, allowedEvidenceRefs: [], internalRationale: 'Synthetic fixture', createdAt: updatedAt, factsRef: factsId } },
  ] }],
}

beforeAll(() => { Object.defineProperty(globalThis, 'TextEncoder', { value: TextEncoder, configurable: true }) })

it('removes previous-scope material and ignores its late event-triggered refresh after organization switch', async () => {
  let finishOldRequest: (value: unknown) => void = () => undefined
  const request = jest.mocked(readApiResultOrThrow)
  request.mockResolvedValueOnce(response)
    .mockImplementationOnce(() => new Promise((resolve) => { finishOldRequest = resolve }))
    .mockResolvedValueOnce({ proposalId, proposalUpdatedAt: updatedAt, options: [] })
  emitOrganizationScopeChanged({ tenantId: 'first-tenant', organizationId: 'first-organization' })
  renderWithProviders(<ProposalMaterialsWidget context={{ path: `/backend/caseload/${proposalId.toUpperCase()}` }} />, { dict: en })
  await screen.findByText(body)
  expect(request).toHaveBeenLastCalledWith(`/api/photographers/proposals/${proposalId}/materials`, { cache: 'no-store' })
  act(() => {
    window.dispatchEvent(new CustomEvent('om:event', { detail: { id: 'agent_orchestrator.proposal.disposed', payload: { proposalId } } }))
  })
  await waitFor(() => expect(request).toHaveBeenCalledTimes(2))
  act(() => { emitOrganizationScopeChanged({ tenantId: 'second-tenant', organizationId: 'second-organization' }) })
  expect(screen.queryByText(body)).toBeNull()
  await waitFor(() => expect(request).toHaveBeenCalledTimes(3))
  await act(async () => { finishOldRequest(response) })
  expect(screen.queryByText(body)).toBeNull()
  expect(screen.queryByRole('region')).toBeNull()
})
