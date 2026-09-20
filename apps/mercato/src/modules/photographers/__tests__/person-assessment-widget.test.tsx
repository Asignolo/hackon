/** @jest-environment jsdom */
import * as React from 'react'
import { act, fireEvent, screen, waitFor } from '@testing-library/react'
import { renderWithProviders } from '@open-mercato/shared/lib/testing/renderWithProviders'
import { emitOrganizationScopeChanged } from '@open-mercato/shared/lib/frontend/organizationEvents'
import { apiCall } from '@open-mercato/ui/backend/utils/apiCall'
import PersonAssessmentWidget from '../widgets/injection/person-assessment/widget.client'
import en from '../i18n/en.json'

jest.mock('@open-mercato/ui/backend/utils/apiCall', () => ({ apiCall: jest.fn() }))
const personId = '11111111-1111-4111-8111-111111111111'
const evaluationId = '22222222-2222-4222-8222-222222222222'
const registrationId = '33333333-3333-4333-8333-333333333333'
const response = { ok: true, status: 200, result: { assessment: { evaluationId, registrationId } } }
const renderWidget = () => renderWithProviders(<PersonAssessmentWidget context={{ personId }} />, { dict: en })

beforeEach(() => { jest.resetAllMocks() })

test('opens the saved assessment without a mutation', async () => {
  jest.mocked(apiCall).mockResolvedValue(response as never)
  renderWidget()
  expect(await screen.findByRole('link', { name: 'Open latest assessment' })).toHaveAttribute('href', `/backend/photographers/assessment?evaluationId=${evaluationId}&registrationId=${registrationId}`)
  expect(apiCall).toHaveBeenCalledWith(`/api/photographers/people/${personId}/assessment`, expect.objectContaining({ cache: 'no-store', signal: expect.any(AbortSignal) }))
  expect(apiCall).toHaveBeenCalledTimes(1)
})

test('supports refreshing a missing assessment', async () => {
  jest.mocked(apiCall).mockResolvedValueOnce({ ...response, result: { assessment: null } } as never).mockResolvedValueOnce(response as never)
  renderWidget()
  expect(await screen.findByText(en['photographers.assessment.noAssessment'])).toBeVisible()
  fireEvent.click(screen.getByRole('button', { name: en['photographers.materials.refresh'] }))
  expect(await screen.findByRole('link', { name: 'Open latest assessment' })).toBeVisible()
})

test('does not show a link on forbidden or malformed responses', async () => {
  jest.mocked(apiCall).mockResolvedValue({ ok: false, status: 403 } as never)
  const rendered = renderWidget()
  expect(await screen.findByText(en['photographers.assessment.load.forbidden'])).toBeVisible()
  expect(screen.queryByRole('link')).toBeNull()
  rendered.unmount()
  jest.mocked(apiCall).mockResolvedValue({ ...response, result: { assessment: { evaluationId: 'invalid', registrationId } } } as never)
  renderWidget()
  expect(await screen.findByText(en['photographers.assessment.load.failed'])).toBeVisible()
  expect(screen.queryByRole('link')).toBeNull()
})

test('clears a previous organization link and ignores its pending response', async () => {
  let resolveOld: ((value: never) => void) | undefined
  jest.mocked(apiCall).mockImplementationOnce(() => new Promise((resolve) => { resolveOld = resolve }))
  jest.mocked(apiCall).mockResolvedValueOnce({ ...response, result: { assessment: null } } as never)
  renderWidget()
  await waitFor(() => expect(apiCall).toHaveBeenCalledTimes(1))
  act(() => emitOrganizationScopeChanged({ organizationId: registrationId, tenantId: personId }))
  expect(await screen.findByText(en['photographers.assessment.noAssessment'])).toBeVisible()
  await act(async () => { resolveOld?.(response as never) })
  expect(screen.queryByRole('link')).toBeNull()
})

test('does not query before the customer context is loaded', () => {
  renderWithProviders(<PersonAssessmentWidget context={{ personId: null }} />, { dict: en })
  expect(apiCall).not.toHaveBeenCalled()
})
