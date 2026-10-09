import { describe, it, expect } from 'vitest'
import { claudeAccountCredentialDir, claudeAccountProviderId } from '@superone/shared/agent-types'
import { dedupeAccounts } from './claude-account-parse'

describe('dedupeAccounts', () => {
  const at = (credentialDir: string | null, identityKey: string | null): Parameters<typeof dedupeAccounts>[0][number] =>
    ({ credentialDir, loggedIn: identityKey != null, identityKey, email: null, orgId: null, orgName: null, subscriptionType: null, projectsDirectory: null })

  it('keeps the default domain when a managed dir holds the same identity', () => {
    const out = dedupeAccounts([at(null, 'me@example.com|org-a'), at('/accounts/dup', 'me@example.com|org-a')])

    expect(out).toHaveLength(1)
    expect(out[0].credentialDir).toBeNull()
  })

  it('keeps distinct identities, including two orgs under one email', () => {
    const out = dedupeAccounts([at(null, 'me@example.com|org-a'), at('/accounts/work', 'me@example.com|org-b')])

    expect(out.map((a) => a.credentialDir)).toEqual([null, '/accounts/work'])
  })

  it('never merges unidentifiable accounts, since they are not known to be the same', () => {
    const out = dedupeAccounts([at('/accounts/a', null), at('/accounts/b', null)])

    expect(out).toHaveLength(2)
  })

  it('preserves input order for identities that survive', () => {
    const out = dedupeAccounts([at(null, 'a|1'), at('/accounts/x', 'b|1'), at('/accounts/y', 'c|1')])

    expect(out.map((a) => a.identityKey)).toEqual(['a|1', 'b|1', 'c|1'])
  })
})

describe('claude account apiProviderId codec', () => {
  it('round-trips a credential domain', () => {
    const dir = '/Users/me/.superone/claude-accounts/abc-123'
    expect(claudeAccountCredentialDir(claudeAccountProviderId(dir))).toBe(dir)
  })

  it('gives the external CLI a selectable identity while accepting legacy null', () => {
    expect(claudeAccountProviderId(null)).toBe('claude-account:cli')
    expect(claudeAccountCredentialDir('claude-account:cli')).toBeNull()
    expect(claudeAccountCredentialDir(null)).toBeNull()
  })

  it('does not claim a third-party credential id', () => {
    expect(claudeAccountCredentialDir('cred_01H8XYZ')).toBeNull()
    expect(claudeAccountCredentialDir(undefined)).toBeNull()
  })

  it('treats a prefix with an empty payload as no account', () => {
    expect(claudeAccountCredentialDir('claude-account:')).toBeNull()
  })
})
