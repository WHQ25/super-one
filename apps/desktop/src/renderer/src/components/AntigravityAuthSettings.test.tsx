/** @vitest-environment jsdom */

import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import type {
  AntigravityAccountsSnapshot,
  AntigravityAuthRequest,
} from '@superone/shared/antigravity-auth'
import { AntigravityAuthSettings } from './AntigravityAuthSettings'

vi.mock('sonner', () => ({
  toast: { success: vi.fn(), error: vi.fn() },
}))

describe('AntigravityAuthSettings multi-account UI', () => {
  it('lists accounts, switches default, removes managed accounts, and submits code login', async () => {
    const accountsChanged = vi.fn()
    window.addEventListener('antigravity-accounts-changed', accountsChanged)

    let snapshot: AntigravityAccountsSnapshot = {
      runtimeAvailable: true,
      defaultAccountId: 'cli',
      accounts: [
        {
          id: 'cli',
          authMethod: 'oauth-personal',
          signedIn: true,
          isDefault: true,
          isCliDefault: true,
          email: 'host@example.com',
          hasApiKey: false,
        },
        {
          id: '11111111-1111-4111-8111-111111111111',
          label: 'Work Google',
          authMethod: 'oauth-personal',
          signedIn: false,
          isDefault: false,
          isCliDefault: false,
          hasApiKey: false,
        },
      ],
      activeLogin: null,
    }

    const calls: AntigravityAuthRequest[] = []
    const api = vi.fn(async (req: AntigravityAuthRequest): Promise<AntigravityAccountsSnapshot> => {
      calls.push(req)
      if (req.action === 'startLogin') {
        snapshot = {
          ...snapshot,
          activeLogin: {
            accountId: req.accountId,
            loginId: 'login-1',
            status: 'waiting',
            authMethod: 'oauth-personal',
            mode: 'code',
            authUrl: 'https://accounts.google.com/o/oauth2/auth?response_type=code&state=s1&redirect_uri=https%3A%2F%2Fantigravity.google%2Foauth-callback',
          },
        }
      } else if (req.action === 'submitLoginResponse') {
        snapshot = {
          ...snapshot,
          activeLogin: null,
          accounts: snapshot.accounts.map((a) =>
            a.id === '11111111-1111-4111-8111-111111111111' ? { ...a, signedIn: true } : a,
          ),
        }
      } else if (req.action === 'setDefault') {
        snapshot = {
          ...snapshot,
          defaultAccountId: req.accountId,
          accounts: snapshot.accounts.map((a) => ({ ...a, isDefault: a.id === req.accountId })),
        }
      } else if (req.action === 'remove') {
        snapshot = {
          ...snapshot,
          defaultAccountId: 'cli',
          accounts: snapshot.accounts
            .filter((a) => a.id !== req.accountId)
            .map((a) => ({ ...a, isDefault: a.id === 'cli' })),
        }
      }
      return snapshot
    })

    const user = userEvent.setup()
    render(<AntigravityAuthSettings api={api} />)

    expect(await screen.findByText('host@example.com')).toBeInTheDocument()
    expect(screen.getByText('Work Google')).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: /Sign In/i }))
    const codeInput = await screen.findByPlaceholderText(/4\/0A/i)
    await user.type(codeInput, '4/0Ab-test-code')
    await user.click(screen.getByRole('button', { name: /Complete Sign-in/i }))

    await waitFor(() => {
      expect(calls).toContainEqual({
        action: 'submitLoginResponse',
        loginId: 'login-1',
        response: '4/0Ab-test-code',
      })
    })

    await user.click(screen.getByRole('button', { name: /Set as Default/i }))
    expect(calls).toContainEqual({
      action: 'setDefault',
      accountId: '11111111-1111-4111-8111-111111111111',
    })

    await user.click(screen.getByRole('button', { name: /Remove/i }))
    await waitFor(() => {
      expect(screen.queryByText('Work Google')).toBeNull()
    })
    expect(accountsChanged).toHaveBeenCalled()

    window.removeEventListener('antigravity-accounts-changed', accountsChanged)
  })
})
