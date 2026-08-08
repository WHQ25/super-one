/** @vitest-environment jsdom */

import { describe, it, expect, vi } from 'vitest'
import type { AgentEvent, ChatMessage } from '@superone/shared/agent-types'

vi.mock('@/stores/app', () => ({
  useAppStore: { getState: () => ({ sandboxCapability: null }) },
}))
vi.mock('@/stores/activity-view-state', () => ({
  useActivityViewStateStore: { getState: () => ({}) },
}))
vi.stubGlobal('window', {
  agent: new Proxy({}, { get: () => () => Promise.resolve(undefined) }),
  app: { trace: vi.fn(), getAppSettings: vi.fn().mockResolvedValue({ agentPreference: {} }) },
})

await import('../index')
const { createDefaultPerSessionState } = await import('../defaults')
const { reduceSlash } = await import('./slash')

function makeMessage(id: string, overrides: Partial<ChatMessage> = {}): ChatMessage {
  return {
    id,
    role: 'user',
    status: 'complete',
    content: [],
    createdAt: '',
    providerId: 'claude',
    ...overrides,
  }
}

describe('reduceSlash: prompt_suggestion', () => {
  it('writes the suggestion onto promptSuggestion', () => {
    const session = createDefaultPerSessionState()
    const patch = reduceSlash(session, {
      type: 'prompt_suggestion',
      suggestion: 'hello world',
    } as Extract<AgentEvent, { type: 'prompt_suggestion' }>)
    expect(patch).toEqual({ promptSuggestion: 'hello world' })
  })
})

describe('reduceSlash: turn_summary / session_recap', () => {
  it('attaches turn_summary onto the last assistant message metadata', () => {
    const session = createDefaultPerSessionState()
    session.messages = [
      makeMessage('u1', { role: 'user' }),
      makeMessage('a1', { role: 'assistant' }),
    ]
    const patch = reduceSlash(session, {
      type: 'turn_summary',
      summary: '  parser race fixed  ',
      promptId: 'p1',
    } as never)
    const msgs = patch.messages!
    expect(msgs).toHaveLength(2)
    expect(msgs[1].id).toBe('a1')
    expect(msgs[1].metadata?.turnSummary).toBe('parser race fixed')
    expect(msgs.some((m) => m.providerId === 'system')).toBe(false)
  })

  it('attaches turn_summary to the messageId when provided', () => {
    const session = createDefaultPerSessionState()
    session.messages = [
      makeMessage('a1', { role: 'assistant' }),
      makeMessage('a2', { role: 'assistant' }),
    ]
    const patch = reduceSlash(session, {
      type: 'turn_summary',
      summary: 'older turn',
      messageId: 'a1',
    } as never)
    expect(patch.messages![0].metadata?.turnSummary).toBe('older turn')
    expect(patch.messages![1].metadata?.turnSummary).toBeUndefined()
  })

  it('falls back to a system marker when no assistant message exists', () => {
    const session = createDefaultPerSessionState()
    session.messages = [makeMessage('u1', { role: 'user' })]
    const patch = reduceSlash(session, {
      type: 'turn_summary',
      summary: 'orphan summary',
    } as never)
    const meta = patch.messages!.at(-1)!
    expect(meta.providerId).toBe('system')
    const text = (meta.content[0] as { text: string }).text
    expect(JSON.parse(text.slice('__turn_meta__:'.length))).toEqual({
      kind: 'summary',
      text: 'orphan summary',
    })
  })

  it('ignores empty turn_summary', () => {
    const session = createDefaultPerSessionState()
    session.messages = [makeMessage('a1', { role: 'assistant' })]
    expect(reduceSlash(session, { type: 'turn_summary', summary: '  ' } as never)).toEqual({})
  })

  it('appends a session_recap system marker', () => {
    const session = createDefaultPerSessionState()
    session.messages = [makeMessage('a1', { role: 'assistant' })]
    const patch = reduceSlash(session, {
      type: 'session_recap',
      summary: 'You fixed the parser.',
      auto: true,
    } as never)
    const meta = patch.messages!.at(-1)!
    expect(meta.providerId).toBe('system')
    const text = (meta.content[0] as { text: string }).text
    expect(JSON.parse(text.slice('__turn_meta__:'.length))).toEqual({
      kind: 'recap',
      text: 'You fixed the parser.',
      auto: true,
    })
  })
})

describe('reduceSlash: compact_boundary', () => {
  it('inserts a __compact__ assistant message before the last user message when no _pendingCompactUserId is set', () => {
    const session = createDefaultPerSessionState()
    session.messages = [
      makeMessage('u1', { role: 'user' }),
      makeMessage('a1', { role: 'assistant' }),
      makeMessage('u2', { role: 'user' }),
    ]

    const patch = reduceSlash(session, {
      type: 'compact_boundary',
      trigger: 'auto',
      preTokens: 1234,
    } as never)

    const msgs = patch.messages!
    // Should insert before the last user message (u2)
    const compactIdx = msgs.findIndex((m) => m.role === 'assistant' && m.providerId === 'system')
    const u2Idx = msgs.findIndex((m) => m.id === 'u2')
    expect(compactIdx).toBeGreaterThanOrEqual(0)
    expect(compactIdx).toBe(u2Idx - 1)
    expect((msgs[compactIdx].content[0] as { text: string }).text).toContain('__compact__:auto:1234')
    expect(patch.isCompacting).toBe(false)
    expect(patch._pendingCompactUserId).toBe('')
  })

  it('strips the pending compact user message and re-emits __compact__ when _pendingCompactUserId is set', () => {
    const session = createDefaultPerSessionState()
    session._pendingCompactUserId = 'u-pending'
    session.messages = [
      makeMessage('u-pending', { role: 'user' }),
      makeMessage('u1', { role: 'user' }),
    ]

    const patch = reduceSlash(session, {
      type: 'compact_boundary',
      trigger: 'manual',
      preTokens: 5000,
    } as never)

    const msgs = patch.messages!
    expect(msgs.some((m) => m.id === 'u-pending')).toBe(false)
    expect(msgs.some((m) => m.providerId === 'system')).toBe(true)
    expect(patch._pendingSlashCommand).toBe('')
  })
})

describe('reduceSlash: slash_command_output', () => {
  it("strips the source assistant message and removes the trailing user message for the /compact slash flow", () => {
    const session = createDefaultPerSessionState()
    session._pendingSlashCommand = 'compact'
    session.messages = [
      makeMessage('u-compact', { role: 'user' }),
      makeMessage('source', { role: 'assistant' }),
    ]

    const patch = reduceSlash(session, {
      type: 'slash_command_output',
      messageId: 'source',
      content: '',
    } as never)

    const ids = patch.messages!.map((m) => m.id)
    expect(ids).not.toContain('source')
    expect(ids).not.toContain('u-compact')
    expect(patch._pendingSlashCommand).toBe('')
    expect(patch._pendingCompactUserId).toBe('')
  })

  it('produces a slashCommandOutput popup + hint assistant message for the default slash flow', () => {
    const session = createDefaultPerSessionState()
    session._pendingSlashCommand = 'doctor'
    session.messages = [
      makeMessage('source', { role: 'assistant' }),
    ]

    const patch = reduceSlash(session, {
      type: 'slash_command_output',
      messageId: 'source',
      content: 'all good',
    } as never)

    expect(patch.slashCommandOutput).toEqual({ command: 'doctor', content: 'all good' })
    expect(patch._pendingSlashCommand).toBe('')
    expect(patch.messages?.some((m) => m.id === 'source')).toBe(false)
    expect(patch.messages?.some((m) => (m.content[0] as { text: string }).text.includes('/doctor'))).toBe(true)
  })
})

describe('reduceSlash: checkpoint_captured', () => {
  it('writes checkpointId + resumePointId onto the target user message', () => {
    const session = createDefaultPerSessionState()
    session.messages = [
      makeMessage('u1', { role: 'user' }),
      makeMessage('a1', { role: 'assistant' }),
    ]

    const patch = reduceSlash(session, {
      type: 'checkpoint_captured',
      messageId: 'a1',
      checkpointId: 'cp-1',
      resumePointId: 'rp-1',
    } as never)

    const u1 = patch.messages?.find((m) => m.id === 'u1')
    expect(u1?.checkpointId).toBe('cp-1')
    expect(u1?.resumePointId).toBe('rp-1')
  })

  it('returns {} when no checkpoint target is found', () => {
    const session = createDefaultPerSessionState()
    session.messages = []
    const patch = reduceSlash(session, {
      type: 'checkpoint_captured',
      messageId: 'ghost',
      checkpointId: 'cp-1',
      resumePointId: 'rp-1',
    } as never)
    expect(patch).toEqual({})
  })

  it('walks forward to the next user message without checkpointId when the target already has one', () => {
    const session = createDefaultPerSessionState()
    session.messages = [
      makeMessage('u1', { role: 'user', checkpointId: 'existing' }),
      makeMessage('a1', { role: 'assistant' }),
      makeMessage('u2', { role: 'user' }),
    ]

    const patch = reduceSlash(session, {
      type: 'checkpoint_captured',
      messageId: 'a1',
      checkpointId: 'cp-2',
      resumePointId: 'rp-2',
    } as never)

    const u2 = patch.messages?.find((m) => m.id === 'u2')
    expect(u2?.checkpointId).toBe('cp-2')
    // u1 unchanged
    expect(patch.messages?.find((m) => m.id === 'u1')?.checkpointId).toBe('existing')
  })
})
