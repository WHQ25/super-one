import { describe, expect, it } from 'vitest'
import type { ChatMessage } from '@superone/shared/agent-types'
import {
  canSteerQueued,
  composerQueuedSendFields,
  queuedMessageText,
  shouldQueueComposerSend,
} from './queued-send'

describe('queued composer send', () => {
  it('queues the same harnesses the desktop composer parks mid-turn', () => {
    expect(shouldQueueComposerSend('streaming', 'claude')).toBe(true)
    expect(shouldQueueComposerSend('streaming', 'codex')).toBe(true)
    expect(shouldQueueComposerSend('streaming', 'acp-grok')).toBe(true)
    expect(shouldQueueComposerSend('streaming', 'acp-antigravity')).toBe(true)
    expect(shouldQueueComposerSend('streaming', 'opencode')).toBe(true)
    expect(shouldQueueComposerSend('streaming', 'dsh')).toBe(true)
    expect(shouldQueueComposerSend('streaming', 'cursor')).toBe(false)
    expect(shouldQueueComposerSend('idle', 'claude')).toBe(false)
  })

  it('tags a live send with a client id so the runtime can park the bubble', () => {
    expect(composerQueuedSendFields('streaming', 'acp-grok', 'send')).toEqual({
      queue: true, needsClientMessageId: true,
    })
    expect(composerQueuedSendFields('idle', 'acp-grok', 'send')).toEqual({
      queue: false, needsClientMessageId: false,
    })
    expect(composerQueuedSendFields('streaming', 'cursor', 'send')).toEqual({
      queue: false, needsClientMessageId: false,
    })
    expect(composerQueuedSendFields('streaming', 'claude', 'steer')).toEqual({
      queue: true, needsClientMessageId: true,
    })
  })

  it('offers steer on Claude, Codex, Grok and Antigravity', () => {
    expect(canSteerQueued('claude')).toBe(true)
    expect(canSteerQueued('codex')).toBe(true)
    expect(canSteerQueued('acp-grok')).toBe(true)
    expect(canSteerQueued('acp-antigravity')).toBe(true)
    expect(canSteerQueued('opencode')).toBe(false)
    expect(canSteerQueued('cursor')).toBe(false)
  })

  it('joins text blocks for the edit-back path', () => {
    const message = {
      id: 'q1',
      role: 'user',
      status: 'complete',
      content: [{ type: 'text', text: 'fix the ' }, { type: 'text', text: 'queue' }],
      createdAt: '',
      providerId: 'local',
    } as ChatMessage
    expect(queuedMessageText(message)).toBe('fix the queue')
  })

  it('enables steering when advertised by an OpenCode V2 session', () => {
    const runtime = { harnessId: 'opencode' as const, supportsQueuedSteer: true }
    expect(canSteerQueued('opencode', runtime)).toBe(true)
    expect(canSteerQueued('opencode', { ...runtime, harnessId: 'codex' })).toBe(false)
    expect(canSteerQueued('opencode')).toBe(false)
  })
})
