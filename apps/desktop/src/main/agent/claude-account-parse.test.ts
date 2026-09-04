import { describe, it, expect } from 'vitest'
import { parseAuthStatus, accountIdentityKey, dedupeAccounts } from './claude-account-parse'

const SIGNED_IN = JSON.stringify({
  loggedIn: true,
  authMethod: 'claude.ai',
  apiProvider: 'firstParty',
  projectsDirectory: '/Users/me/.claude/projects',
  email: 'Me@Example.com',
  orgId: 'A988580C-3315',
  orgName: "me's Organization",
  subscriptionType: 'max',
})

describe('parseAuthStatus (claude auth status --json → ClaudeAccount)', () => {
  it('maps a signed-in account and lowercases the identity key', () => {
    expect(parseAuthStatus(SIGNED_IN, null)).toEqual({
      credentialDir: null,
      loggedIn: true,
      identityKey: 'me@example.com|a988580c-3315',
      email: 'Me@Example.com',
      orgId: 'A988580C-3315',
      orgName: "me's Organization",
      subscriptionType: 'max',
      projectsDirectory: '/Users/me/.claude/projects',
    })
  })

  it('carries the credential dir through so the caller can key accounts by domain', () => {
    expect(parseAuthStatus(SIGNED_IN, '/accounts/work')?.credentialDir).toBe('/accounts/work')
  })

  it('maps a signed-out domain with no identity rather than dropping it', () => {
    const out = parseAuthStatus(
      JSON.stringify({ loggedIn: false, authMethod: 'none', projectsDirectory: '/Users/me/.claude/projects' }),
      '/accounts/stale',
    )

    expect(out).toEqual({
      credentialDir: '/accounts/stale',
      loggedIn: false,
      identityKey: null,
      email: null,
      orgId: null,
      orgName: null,
      subscriptionType: null,
      projectsDirectory: '/Users/me/.claude/projects',
    })
  })

  it('treats a signed-in account missing an org as unidentifiable', () => {
    const out = parseAuthStatus(JSON.stringify({ loggedIn: true, email: 'me@example.com' }), null)

    expect(out?.loggedIn).toBe(true)
    expect(out?.identityKey).toBeNull()
  })

  it('returns null for output that is not JSON, or is JSON but not an object', () => {
    expect(parseAuthStatus('Not logged in · Please run /login', null)).toBeNull()
    expect(parseAuthStatus('', null)).toBeNull()
    expect(parseAuthStatus('[1,2]', null)).toBeNull()
  })

  it('tolerates log lines printed before the JSON body', () => {
    expect(parseAuthStatus(`warning: something\n${SIGNED_IN}`, null)?.email).toBe('Me@Example.com')
  })
})

describe('accountIdentityKey', () => {
  it('joins email and org so two orgs under one email stay distinct', () => {
    expect(accountIdentityKey('me@example.com', 'org-a')).toBe('me@example.com|org-a')
    expect(accountIdentityKey('me@example.com', 'org-b')).not.toBe(accountIdentityKey('me@example.com', 'org-a'))
  })

  it('is null unless both parts are present and non-blank', () => {
    expect(accountIdentityKey('me@example.com', null)).toBeNull()
    expect(accountIdentityKey(null, 'org-a')).toBeNull()
    expect(accountIdentityKey('  ', 'org-a')).toBeNull()
  })
})

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
