import { describe, expect, it } from 'vitest'
import { BASE_SESSION_PROVIDERS } from '@superone/shared/session-provider-definitions'
import { MESSAGE_DIALECT_BY_HARNESS, messageDialectFor } from './message-dialect'

describe('message dialect registry', () => {
  // The type system already forces a new HarnessId to declare a dialect; this
  // guards the runtime side (a stale map surviving a type-only edit).
  it('registers every harness id', () => {
    const harnessIds = Object.keys(BASE_SESSION_PROVIDERS)
    expect(Object.keys(MESSAGE_DIALECT_BY_HARNESS).sort()).toEqual(harnessIds.sort())
  })

  it('routes codex to the codex reducer and everything else to claude', () => {
    expect(messageDialectFor('codex')).toBe('codex')
    expect(messageDialectFor('claude')).toBe('claude')
    expect(messageDialectFor('acp')).toBe('claude')
    expect(messageDialectFor('cursor')).toBe('claude')
    expect(messageDialectFor('opencode')).toBe('claude')
    // dsh emits message_start → content_delta* → message_complete.
    expect(messageDialectFor('dsh')).toBe('claude')
  })
})
