import { describe, expect, it } from 'vitest'
import type { ChatMessage } from '@superone/shared/agent-types'
import {
  canSteerQueued,
  canSteerQueuedSoon,
  composerQueuedSendFields,
  queuedMessageText,
  shouldQueueComposerSend,
} from './queued-send'

describe('queued composer send', () => {
  it('queues the same harnesses the desktop composer parks mid-turn', () => {
    expect(shouldQueueComposerSend('streaming', 'claude')).toBe(true)
    expect(shouldQueueComposerSend('streaming', 'codex')).toBe(true)
    expect(shouldQueueComposerSend('streaming', 'acp')).toBe(true)
    expect(shouldQueueComposerSend('streaming', 'opencode')).toBe(true)
    expect(shouldQueueComposerSend('streaming', 'cursor')).toBe(false)
    expect(shouldQueueComposerSend('idle', 'claude')).toBe(false)
  })

  it('tags a live send with a client id so the runtime can park the bubble', () => {
    expect(composerQueuedSendFields('streaming', 'acp', 'send')).toEqual({
      queue: true, needsClientMessageId: true,
    })
    expect(composerQueuedSendFields('idle', 'acp', 'send')).toEqual({
      queue: false, needsClientMessageId: false,
    })
    expect(composerQueuedSendFields('streaming', 'cursor', 'send')).toEqual({
      queue: false, needsClientMessageId: false,
    })
    expect(composerQueuedSendFields('streaming', 'claude', 'steer')).toEqual({
      queue: true, needsClientMessageId: true,
    })
  })

  it('offers steer on Claude, Codex and Grok, and soon on Claude and Grok', () => {
    expect(canSteerQueued('claude')).toBe(true)
    expect(canSteerQueued('codex')).toBe(true)
    expect(canSteerQueued('acp')).toBe(true)
    expect(canSteerQueued('opencode')).toBe(false)
    expect(canSteerQueuedSoon('claude')).toBe(true)
    expect(canSteerQueuedSoon('acp')).toBe(false)
    expect(canSteerQueuedSoon('acp', 'grok-build')).toBe(true)
    expect(canSteerQueuedSoon('acp', 'custom-agent')).toBe(false)
    expect(canSteerQueuedSoon('codex')).toBe(false)
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
})
