/** @vitest-environment jsdom */
import { cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, expect, it, vi } from 'vitest'
import type { GrokAuthState } from '@superone/shared/grok-auth'
import { GrokAuthSettings, type GrokAuthApi } from './GrokAuthSettings'
import { requestOpenExternalLink } from '@/lib/external-link'
vi.mock('@/lib/external-link', () => ({ requestOpenExternalLink: vi.fn() }))
afterEach(cleanup)

it('uses a dedicated browser action and optional code, then cancels on unmount', async () => {
  const user = userEvent.setup()
  let state: GrokAuthState = { status: 'signed_out' }
  const api = vi.fn<GrokAuthApi>(async (request) => {
    if (request.action === 'start') state = { status: 'waiting', loginId: 'attempt', authUrl: 'https://grok.com/login' }
    if (request.action === 'submit') state = { ...state, status: 'verifying' }
    return state
  })
  const view = render(<GrokAuthSettings api={api} />)
  await user.click(await screen.findByRole('button', { name: 'Sign In' }))
  await user.click(await screen.findByRole('button', { name: 'Open Browser' }))
  expect(requestOpenExternalLink).toHaveBeenCalledWith('https://grok.com/login')
  expect(screen.queryByRole('textbox')).not.toBeInTheDocument()
  await user.click(screen.getByRole('button', { name: 'Have a Login Code?' }))
  await user.type(screen.getByRole('textbox'), 'abcd-1234')
  await user.click(screen.getByRole('button', { name: 'Submit Code' }))
  expect(api).toHaveBeenCalledWith({ action: 'submit', loginId: 'attempt', code: 'abcd-1234' })
  await screen.findByText('Verifying Your Account…')
  view.unmount()
  expect(api).toHaveBeenCalledWith({ action: 'cancel', loginId: 'attempt' })
})
it('shows cached CLI credentials without asking for another login', async () => {
  render(<GrokAuthSettings api={async () => ({ status: 'signed_in', email: 'account@example.com' })} />)
  await screen.findByText('account@example.com')
  expect(screen.queryByRole('button', { name: 'Sign In' })).not.toBeInTheDocument()
})
it('shows IPC failures with a retryable refresh action', async () => {
  render(<GrokAuthSettings api={async () => { throw new Error('CLI unavailable') }} />)
  expect(await screen.findByRole('alert')).toHaveTextContent('CLI unavailable')
  await waitFor(() => expect(screen.getByRole('button', { name: 'Refresh' })).toBeEnabled())
})
