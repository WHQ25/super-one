/** @vitest-environment jsdom */

import { describe, it, expect } from 'vitest'
import type { ClaudeAccount } from '@superone/shared/agent-types'
import { claudeAccountKeyName } from './useSelectorProviders'

function account(email: string | null, orgName: string | null, credentialDir: string | null = null): ClaudeAccount {
  return {
    credentialDir,
    loggedIn: true,
    identityKey: email && orgName ? `${email}|${orgName}` : null,
    email,
    orgId: orgName,
    orgName,
    subscriptionType: 'max',
    projectsDirectory: null,
  }
}

describe('claudeAccountKeyName — the key column of a provider row', () => {
  it('uses the email alone when it is unique in the list', () => {
    const rows = [account('me@example.com', 'Personal'), account('work@acme.com', 'Acme')]

    expect(claudeAccountKeyName(rows[0], rows)).toBe('me@example.com')
  })

  it('appends the org when one email appears under two orgs', () => {
    // Plans are org-scoped, so these are two separate usage pools. Without the org the two rows
    // would render identically and be unpickable.
    const rows = [account('me@example.com', 'Personal'), account('me@example.com', 'Acme Inc')]

    expect(claudeAccountKeyName(rows[0], rows)).toBe('me@example.com · Personal')
    expect(claudeAccountKeyName(rows[1], rows)).toBe('me@example.com · Acme Inc')
  })

  it('falls back to the org when there is no email', () => {
    const rows = [account(null, 'Acme Inc')]

    expect(claudeAccountKeyName(rows[0], rows)).toBe('Acme Inc')
  })

  it('is undefined when nothing identifies the account, so the row shows no key column', () => {
    const rows = [account(null, null)]

    expect(claudeAccountKeyName(rows[0], rows)).toBeUndefined()
  })

  it('ignores surrounding whitespace when deciding whether an email is ambiguous', () => {
    const rows = [account('me@example.com', 'Personal'), account('  me@example.com  ', 'Acme Inc')]

    expect(claudeAccountKeyName(rows[0], rows)).toBe('me@example.com · Personal')
  })
})
