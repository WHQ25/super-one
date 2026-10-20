import { describe, expect, it, vi } from 'vitest'
import type { AuthenticatedClient } from '@superone/runtime/server'
import { createDesktopClaudeAccountMethods } from './desktop-claude-account-methods'

const account = {
  credentialDir: '/remote/a', loggedIn: true, isDefault: true, email: 'remote@example.com',
  identityKey: 'remote|org', orgId: 'org', orgName: 'Remote', subscriptionType: 'max', projectsDirectory: null,
}

function client(scopes: string[]): AuthenticatedClient {
  return { scopes } as AuthenticatedClient
}

describe('claude.listAccounts', () => {
  it('returns this desktop\'s accounts and refuses a client that cannot read the node', async () => {
    const listAccounts = vi.fn(async () => [account])
    const api = createDesktopClaudeAccountMethods(listAccounts)
    expect(api.methods.has('claude.listAccounts')).toBe(true)

    const allowed = await api.dispatch('claude.listAccounts', { force: true }, { client: client(['environment:read']) } as never)
    expect(listAccounts).toHaveBeenCalledWith(true)
    expect(allowed).toEqual({ result: [account] })

    const denied = await api.dispatch('claude.listAccounts', {}, { client: client([]) } as never)
    expect(denied).toMatchObject({ error: { code: 'forbidden' } })
    expect(await api.dispatch('provider.listCredentials', {}, { client: client(['environment:read']) } as never)).toBeNull()
  })
})
