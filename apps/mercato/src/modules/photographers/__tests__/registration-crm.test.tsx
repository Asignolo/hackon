/** @jest-environment jsdom */
import * as React from 'react'
import { TextEncoder } from 'node:util'
import { act, fireEvent, screen, waitFor } from '@testing-library/react'
import { renderWithProviders } from '@open-mercato/shared/lib/testing/renderWithProviders'
import { emitOrganizationScopeChanged } from '@open-mercato/shared/lib/frontend/organizationEvents'
import { readApiResultOrThrow } from '@open-mercato/ui/backend/utils/apiCall'
import RegistrationCrm from '../components/RegistrationCrm'
import Simulator from '../backend/photographers/simulator/page'
import en from '../i18n/en.json'

jest.mock('next/navigation', () => ({ useSearchParams: () => new URLSearchParams(window.location.search) }))
jest.mock('@open-mercato/ui/backend/utils/apiCall', () => ({ readApiResultOrThrow: jest.fn() }))
jest.mock('@open-mercato/ui/backend/utils/crud', () => ({ createCrud: jest.fn() }))
jest.mock('@open-mercato/ui/backend/FlashMessages', () => ({ flash: jest.fn() }))
jest.mock('@open-mercato/ui/backend/CrudForm', () => ({ CrudForm: () => <div>Registration form</div> }))
jest.mock('@open-mercato/ui/backend/injection/useGuardedMutation', () => ({ useGuardedMutation: () => ({ runMutation: ({ operation }: { operation: () => Promise<unknown> }) => operation(), retryLastMutation: jest.fn() }) }))

const id = '11111111-1111-4111-8111-111111111111'
const photographerId = '22222222-2222-4222-8222-222222222222'
const ready = { registrationId: id, status: 'ready', photographerId, personId: id, dealId: id }
const pending = { registrationId: id, status: 'pending' }

beforeAll(() => { Object.defineProperty(globalThis, 'TextEncoder', { value: TextEncoder, configurable: true }) })
beforeEach(() => { jest.clearAllMocks(); window.history.replaceState(null, '', '/backend/photographers/simulator') })

test('prepares a pending registration and shows real CRM links and ready state without order confirmation', async () => {
  const read = jest.mocked(readApiResultOrThrow)
  read.mockResolvedValueOnce(pending).mockResolvedValueOnce(ready)
  renderWithProviders(<RegistrationCrm registrationId={id} />, { dict: en })
  const person = await screen.findByRole('link', { name: 'Open photographer' })
  expect(person.getAttribute('href')).toBe(`/backend/customers/people/${photographerId}`)
  expect(screen.getByText(en['photographers.simulator.crmReadyDescription'])).toBeTruthy()
  expect(read.mock.calls[1][1]?.method).toBe('POST')
  expect(read).toHaveBeenCalledTimes(2)
})

test('recovers completed preparation from URL without writing again', async () => {
  window.history.replaceState(null, '', `/backend/photographers/simulator?registrationId=${id}`)
  const read = jest.mocked(readApiResultOrThrow)
  read.mockResolvedValue(ready)
  renderWithProviders(<Simulator />, { dict: en })
  await screen.findByRole('link', { name: 'Open photographer' })
  expect(read).toHaveBeenCalledTimes(1)
  expect(read.mock.calls[0][1]?.method).toBeUndefined()
})

test('retries an uncertain preparation by reading before another write', async () => {
  const read = jest.mocked(readApiResultOrThrow)
  read.mockResolvedValueOnce(pending).mockRejectedValueOnce(new Error('Connection interrupted')).mockResolvedValueOnce(ready)
  renderWithProviders(<RegistrationCrm registrationId={id} />, { dict: en })
  await screen.findByText('Connection interrupted')
  fireEvent.click(screen.getByRole('button', { name: 'Retry CRM preparation' }))
  await screen.findByRole('link', { name: 'Open photographer' })
  expect(read.mock.calls.filter((call) => call[1]?.method === 'POST')).toHaveLength(1)
})

test('scope change removes saved ID and ignores the previous pending read', async () => {
  emitOrganizationScopeChanged({ tenantId: 'original', organizationId: 'original' })
  window.history.replaceState(null, '', `/backend/photographers/simulator?registrationId=${id}`)
  let finish: (value: unknown) => void = () => undefined
  const read = jest.mocked(readApiResultOrThrow)
  read.mockImplementationOnce(() => new Promise((resolve) => { finish = resolve }))
  renderWithProviders(<Simulator />, { dict: en })
  await waitFor(() => expect(read).toHaveBeenCalledTimes(1))
  act(() => { emitOrganizationScopeChanged({ tenantId: 'other', organizationId: 'other' }) })
  await act(async () => { finish(pending) })
  expect(screen.queryByRole('link', { name: 'Open photographer' })).toBeNull()
  expect(screen.getByText('Registration form')).toBeTruthy()
  expect(window.location.search).toBe('')
  expect(read).toHaveBeenCalledTimes(1)
})

test('rejects a response for another registration without preparing CRM', async () => {
  const read = jest.mocked(readApiResultOrThrow)
  read.mockResolvedValue({ ...pending, registrationId: photographerId })
  renderWithProviders(<RegistrationCrm registrationId={id} />, { dict: en })
  await screen.findByText(en['photographers.simulator.crmFailed'])
  expect(screen.queryByRole('link', { name: 'Open photographer' })).toBeNull()
  expect(read).toHaveBeenCalledTimes(1)
})
