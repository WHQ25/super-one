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

  it('drops turn_summary when no assistant message exists (no system marker mint)', () => {
    const session = createDefaultPerSessionState()
    session.messages = [makeMessage('u1', { role: 'user' })]
    expect(reduceSlash(session, {
      type: 'turn_summary',
      summary: 'orphan summary',
    } as never)).toEqual({})
    // Pre-existing legacy markers are left alone (not promoted without an assistant).
    session.messages = [
      makeMessage('u1', { role: 'user' }),
      makeMessage('turn_summary_old', {
        role: 'assistant',
        providerId: 'system',
        content: [{ type: 'text', text: '__turn_meta__:' + JSON.stringify({ kind: 'summary', text: 'orphan summary' }) }],
      }),
    ]
    expect(reduceSlash(session, {
      type: 'turn_summary',
      summary: 'orphan summary',
    } as never)).toEqual({})
  })

  it('promotes a legacy system marker onto assistant metadata and drops the marker', () => {
    const session = createDefaultPerSessionState()
    session.messages = [
      makeMessage('u1', { role: 'user' }),
      makeMessage('a1', { role: 'assistant' }),
      makeMessage('turn_summary_dup', {
        role: 'assistant',
        providerId: 'system',
        content: [{ type: 'text', text: '__turn_meta__:' + JSON.stringify({ kind: 'summary', text: 'parser race fixed' }) }],
      }),
    ]
    const patch = reduceSlash(session, {
      type: 'turn_summary',
      summary: 'parser race fixed',
    } as never)
    const msgs = patch.messages!
    expect(msgs).toHaveLength(2)
    expect(msgs.map((m) => m.id)).toEqual(['u1', 'a1'])
    expect(msgs[1].metadata?.turnSummary).toBe('parser race fixed')
    expect(msgs.some((m) => m.providerId === 'system')).toBe(false)
  })

  it('strips a redundant system marker when metadata already has the same turnSummary', () => {
    const session = createDefaultPerSessionState()
    session.messages = [
      makeMessage('a1', {
        role: 'assistant',
        metadata: { turnSummary: 'already attached' },
      }),
      makeMessage('turn_summary_dup', {
        role: 'assistant',
        providerId: 'system',
        content: [{ type: 'text', text: '__turn_meta__:' + JSON.stringify({ kind: 'summary', text: 'already attached' }) }],
      }),
    ]
    const patch = reduceSlash(session, {
      type: 'turn_summary',
      summary: 'already attached',
    } as never)
    expect(patch.messages).toHaveLength(1)
    expect(patch.messages![0].id).toBe('a1')
    expect(patch.messages![0].metadata?.turnSummary).toBe('already attached')
  })

  it('leaves recap system markers untouched when attaching turn_summary', () => {
    const session = createDefaultPerSessionState()
    session.messages = [
      makeMessage('a1', { role: 'assistant' }),
      makeMessage('session_recap_1', {
        role: 'assistant',
        providerId: 'system',
        content: [{ type: 'text', text: '__turn_meta__:' + JSON.stringify({ kind: 'recap', text: 'You fixed the parser.', auto: true }) }],
      }),
    ]
    const patch = reduceSlash(session, {
      type: 'turn_summary',
      summary: 'parser race fixed',
    } as never)
    const msgs = patch.messages!
    expect(msgs).toHaveLength(2)
    expect(msgs[0].metadata?.turnSummary).toBe('parser race fixed')
    expect(msgs[1].id).toBe('session_recap_1')
  })

  it('ignores empty turn_summary', () => {
    const session = createDefaultPerSessionState()
    session.messages = [makeMessage('a1', { role: 'assistant' })]
    expect(reduceSlash(session, { type: 'turn_summary', summary: '  ' } as never)).toEqual({})
  })

  it('appends a session_recap system marker and clears isRecapping', () => {
    const session = createDefaultPerSessionState()
    session.messages = [makeMessage('a1', { role: 'assistant' })]
    session.isRecapping = true
    const patch = reduceSlash(session, {
      type: 'session_recap',
      summary: 'You fixed the parser.',
      auto: true,
    } as never)
    expect(patch.isRecapping).toBe(false)
    const meta = patch.messages!.at(-1)!
    expect(meta.providerId).toBe('system')
    const text = (meta.content[0] as { text: string }).text
    expect(JSON.parse(text.slice('__turn_meta__:'.length))).toEqual({
      kind: 'recap',
      text: 'You fixed the parser.',
      auto: true,
    })
  })

  it('clears isRecapping on session_recap_unavailable', () => {
    const session = createDefaultPerSessionState()
    session.isRecapping = true
    expect(reduceSlash(session, { type: 'session_recap_unavailable' } as never)).toEqual({
      isRecapping: false,
    })
  })
})

describe('reduceSlash: compact_boundary', () => {
  it('appends the boundary at the event position when there is no live reply', () => {
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
    const compactIdx = msgs.findIndex((m) => m.role === 'assistant' && m.providerId === 'system')
    expect(compactIdx).toBeGreaterThanOrEqual(0)
    expect(compactIdx).toBe(msgs.length - 1)
    expect((msgs[compactIdx].content[0] as { text: string }).text).toContain('__compact__:auto:1234')
    expect(patch.isCompacting).toBe(false)
    expect(patch._pendingCompactUserId).toBe('')
  })

  it('places the boundary after all completed goal turns and before the live continuation', () => {
    const session = createDefaultPerSessionState()
    session.messages = [
      makeMessage('u1', { role: 'user' }),
      makeMessage('a1', { role: 'assistant', status: 'complete' }),
      makeMessage('a2', { role: 'assistant', status: 'complete' }),
      makeMessage('a3', { role: 'assistant', status: 'streaming' }),
    ]

    const patch = reduceSlash(session, {
      type: 'compact_boundary',
      trigger: 'auto',
      preTokens: 1234,
    } as never)

    const ids = patch.messages!.map((m) => m.id)
    const compactIdx = patch.messages!.findIndex((m) => m.providerId === 'system')
    expect(ids.slice(0, compactIdx)).toEqual(['u1', 'a1', 'a2'])
    expect(ids.slice(compactIdx + 1)).toEqual(['a3'])
  })

  it('stays immediately above the streaming reply when a mid-turn steer follows it', () => {
    const session = createDefaultPerSessionState()
    session.messages = [
      makeMessage('u1', { role: 'user' }),
      makeMessage('a1', { role: 'assistant', status: 'streaming' }),
      makeMessage('u-steer', { role: 'user' }),
    ]

    const patch = reduceSlash(session, {
      type: 'compact_boundary',
      trigger: 'auto',
      preTokens: 1234,
    } as never)

    const msgs = patch.messages!
    const compactIdx = msgs.findIndex((m) => m.providerId === 'system')
    expect(compactIdx).toBe(msgs.findIndex((m) => m.id === 'a1') - 1)
    expect(msgs.findLast((m) => m.role === 'assistant')!.id).toBe('a1')
  })

  it('anchors on the streaming reply when no user message precedes it', () => {
    const session = createDefaultPerSessionState()
    session.messages = [
      makeMessage('a1', { role: 'assistant', status: 'streaming' }),
      makeMessage('u-wake', { role: 'user' }),
    ]

    const patch = reduceSlash(session, {
      type: 'compact_boundary',
      trigger: 'auto',
      preTokens: 10,
    } as never)

    const msgs = patch.messages!
    expect(msgs.findIndex((m) => m.providerId === 'system')).toBe(0)
    expect(msgs.findLast((m) => m.role === 'assistant')!.id).toBe('a1')
  })

  it('strips the pending compact user message and re-emits __compact__ when _pendingCompactUserId is set', () => {
    const session = createDefaultPerSessionState()
    session._pendingCompactUserId = 'u-pending'
    session.messages = [
      makeMessage('u-pending', { role: 'user' }),
      makeMessage('compact-assistant', { role: 'assistant', providerId: 'codex' }),
      makeMessage('u1', { role: 'user' }),
    ]

    const patch = reduceSlash(session, {
      type: 'compact_boundary',
      trigger: 'manual',
      preTokens: 5000,
      messageId: 'compact-assistant',
    } as never)

    const msgs = patch.messages!
    expect(msgs.some((m) => m.id === 'u-pending')).toBe(false)
    expect(msgs.some((m) => m.id === 'compact-assistant')).toBe(false)
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

  /**
   * `/code-review` returns its whole report as local-command stdout. The default
   * treatment drops the message and leaves only "Command /code-review executed.",
   * so the review the user waited minutes for never reaches the transcript.
   */
  it('keeps the report in the transcript for a report-producing command', () => {
    const session = createDefaultPerSessionState()
    session._pendingSlashCommand = 'code-review'
    session.messages = [makeMessage('source', { role: 'assistant' })]

    const patch = reduceSlash(session, {
      type: 'slash_command_output',
      messageId: 'source',
      content: '**Findings**\n\n- `execute.ts:330` falls back to screen centre',
    } as never)

    const texts = patch.messages!.map((m) => (m.content[0] as { text: string }).text)
    expect(texts.some((t) => t.includes('`execute.ts:330` falls back to screen centre'))).toBe(true)
    expect(texts.some((t) => t.includes('executed'))).toBe(false)
  })

  it('leaves the report as plain markdown so it renders, not as a fenced block', () => {
    const session = createDefaultPerSessionState()
    session._pendingSlashCommand = 'security-review'
    session.messages = [makeMessage('source', { role: 'assistant' })]

    const patch = reduceSlash(session, {
      type: 'slash_command_output', messageId: 'source', content: '**Findings**\n\n- one',
    } as never)

    const report = patch.messages!.at(-1)!
    expect((report.content[0] as { text: string }).text).toBe('**Findings**\n\n- one')
  })

  it('still hides output for commands that render elsewhere', () => {
    const session = createDefaultPerSessionState()
    session._pendingSlashCommand = 'doctor'
    session.messages = [makeMessage('source', { role: 'assistant' })]

    const patch = reduceSlash(session, {
      type: 'slash_command_output', messageId: 'source', content: 'all good',
    } as never)

    expect(patch.slashCommandOutput).toEqual({ command: 'doctor', content: 'all good' })
  })

  it('does not mint an empty report message when stdout is blank', () => {
    const session = createDefaultPerSessionState()
    session._pendingSlashCommand = 'code-review'
    session.messages = [makeMessage('source', { role: 'assistant' })]

    const patch = reduceSlash(session, {
      type: 'slash_command_output', messageId: 'source', content: '   ',
    } as never)

    expect(patch.messages?.some((m) => (m.content[0] as { text: string }).text.trim() === '')).toBe(false)
  })
})

/**
 * A long local command (`/code-review`) emits no content for minutes, so the
 * transcript and the status bar are both empty and the app looks hung.
 * `command_lifecycle` is the only signal that something is running.
 */
describe('reduceSlash: slash_command_lifecycle', () => {
  it('marks the pending command as running when it starts', () => {
    const session = createDefaultPerSessionState()
    session._pendingSlashCommand = 'code-review'

    const patch = reduceSlash(session, {
      type: 'slash_command_lifecycle', state: 'started',
    } as never)

    expect(patch.runningSlashCommand).toMatchObject({ command: 'code-review' })
    expect(patch.runningSlashCommand!.startedAt).toBeGreaterThan(0)
  })

  it('clears the running marker when the command completes', () => {
    const session = createDefaultPerSessionState()
    session.runningSlashCommand = { command: 'code-review', startedAt: 1 }

    expect(reduceSlash(session, { type: 'slash_command_lifecycle', state: 'completed' } as never)
      .runningSlashCommand).toBeNull()
  })

  it('clears the running marker when the command is cancelled', () => {
    const session = createDefaultPerSessionState()
    session.runningSlashCommand = { command: 'code-review', startedAt: 1 }

    expect(reduceSlash(session, { type: 'slash_command_lifecycle', state: 'cancelled' } as never)
      .runningSlashCommand).toBeNull()
  })

  it('clears the running marker when the command is refused', () => {
    // SDK 0.3.238 terminal state: the receive-side policy declined a peer
    // message. Without it the marker survives to the turn-end fallback.
    const session = createDefaultPerSessionState()
    session.runningSlashCommand = { command: 'code-review', startedAt: 1 }

    expect(reduceSlash(session, { type: 'slash_command_lifecycle', state: 'refused' } as never)
      .runningSlashCommand).toBeNull()
  })

  it('does not mark anything running for a plain prompt', () => {
    const session = createDefaultPerSessionState()
    session._pendingSlashCommand = ''

    expect(reduceSlash(session, { type: 'slash_command_lifecycle', state: 'started' } as never)
      .runningSlashCommand).toBeUndefined()
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
