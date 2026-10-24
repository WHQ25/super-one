import { describe, expect, it } from 'vitest'
import { mapRemoteSessionRow } from './remote-session-row'

describe('mapRemoteSessionRow', () => {
  it('keeps every harness id, including cursor and deepseek', () => {
    for (const harnessId of ['claude', 'codex', 'acp', 'opencode', 'cursor', 'dsh'] as const) {
      expect(mapRemoteSessionRow({ sessionId: harnessId, harnessId }).provider).toBe(harnessId)
    }
    expect(mapRemoteSessionRow({ sessionId: 'x', harnessId: 'pi' }).provider).toBe('claude')
  })

  it('names grok from the acp-grok catalog id and keeps a session agent ahead of that default', () => {
    expect(mapRemoteSessionRow({ sessionId: 'g', harnessId: 'acp-grok' })).toMatchObject({
      provider: 'acp',
      acpAgentId: 'grok-build',
    })
    expect(mapRemoteSessionRow({ sessionId: 'g', harnessId: 'acp-grok', acpAgentId: 'custom' })).toMatchObject({
      provider: 'acp',
      acpAgentId: 'custom',
    })
    expect(mapRemoteSessionRow({ sessionId: 'g', harnessId: 'acp' })).not.toHaveProperty('acpAgentId')
    expect(mapRemoteSessionRow({ sessionId: 'g', harnessId: 'acp', acpAgentId: ' grok-build ' }).acpAgentId).toBe('grok-build')
  })

  it('keeps an explicit unread and treats a missing flag as read', () => {
    expect(mapRemoteSessionRow({ sessionId: 's', harnessId: 'claude', unread: true }).unread).toBe(true)
    expect(mapRemoteSessionRow({ sessionId: 's', harnessId: 'claude' })).not.toHaveProperty('unread')
  })

  it('keeps the bare provider session id, tags, and spawn parent', () => {
    expect(mapRemoteSessionRow({
      sessionId: 's',
      harnessId: 'cursor',
      providerResume: 'thread:t-abc',
      tags: '["oauth"]',
      parentSessionId: 'parent',
    })).toMatchObject({
      provider: 'cursor',
      providerSessionId: 't-abc',
      tags: ['oauth'],
      parentSessionId: 'parent',
    })
  })
})
