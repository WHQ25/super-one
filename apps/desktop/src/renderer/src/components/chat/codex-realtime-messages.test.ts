import { describe, expect, it } from 'vitest'
import type { ChatMessage } from '@superone/shared/agent-types'
import { EMPTY_CODEX_REALTIME_SESSION_VIEW } from '@/stores/codex-realtime-view'
import {
  isRealtimeDelegationMessage,
  isRealtimeVoiceMessage,
  mergeCodexRealtimeMessages,
  mergeCodexThreadMessages,
  realtimeSegmentsToMessage,
  selectRealtimeTranscript,
} from './codex-realtime-messages'

function message(id: string, role: ChatMessage['role'], text: string): ChatMessage {
  return { id, role, status: 'complete', content: [{ type: 'text', text }], createdAt: '', providerId: 'codex' }
}

function delegated(id: string, turnId: string, text: string, order: number): ChatMessage {
  return {
    ...message(id, 'assistant', text),
    metadata: {
      codex: { threadId: 'thread-1', turnId, usage: null, items: [] },
      codexTimeline: { provenance: 'realtime-delegated', turnId, localOrder: order },
    },
  }
}

describe('Codex realtime/thread separation', () => {
  it('keeps delegated Codex turns out of the foreground voice transcript', () => {
    const result = mergeCodexRealtimeMessages([delegated('work-1', 'turn-1', 'Fixed it', 30)], {
      ...EMPTY_CODEX_REALTIME_SESSION_VIEW,
      segments: [
        { id: 'user-1', realtimeSessionId: 'rt-1', role: 'user', text: 'Please fix it', localOrder: 10 },
        { id: 'assistant-1', realtimeSessionId: 'rt-1', role: 'assistant', text: 'On it', localOrder: 20 },
      ],
    })

    expect(result.map((item) => item.content[0])).toEqual([
      { type: 'text', text: 'Please fix it' },
      { type: 'text', text: 'On it' },
    ])
  })

  it('keeps voice items and delegation envelopes out of the backing thread', () => {
    const voice = {
      ...message('voice-1', 'assistant', 'On it'),
      metadata: { codexTimeline: { provenance: 'realtime-assistant', position: 2 } },
    } satisfies ChatMessage
    const envelope = message('delegate', 'user', '<realtime_delegation>\nfix it\n</realtime_delegation>')
    const work = delegated('work-1', 'turn-1', 'Fixed it', 30)

    expect(mergeCodexThreadMessages([voice, envelope, work], { threadMessages: [] })).toEqual([work])
    expect(isRealtimeDelegationMessage(envelope)).toBe(true)
  })

  it('keeps delegation prompts for the backing-thread view, which exists to show them', () => {
    const envelope = message('delegate', 'user', '<realtime_delegation>\nfix it\n</realtime_delegation>')
    const voice = {
      ...message('voice-1', 'assistant', 'On it'),
      metadata: { codexTimeline: { provenance: 'realtime-assistant', position: 2 } },
    } satisfies ChatMessage
    const work = delegated('work-1', 'turn-1', 'Fixed it', 30)

    const result = mergeCodexThreadMessages(
      [],
      { threadMessages: [voice, envelope, work] },
      { keepDelegationPrompts: true },
    )

    // The voice line stays out either way — only the machinery comes back.
    expect(result).toEqual([envelope, work])
  })

  it('overlays a restored Codex turn with its richer live copy', () => {
    const canonical = delegated('canonical', 'turn-1', 'Old', 30)
    const live = delegated('live', 'turn-1', 'Current', 30)
    const result = mergeCodexThreadMessages([live], { threadMessages: [canonical] })

    expect(result).toHaveLength(1)
    expect(result[0]?.id).toBe('canonical')
    expect(result[0]?.content).toEqual([{ type: 'text', text: 'Current' }])
  })

  it('renders only completed live items and replaces them by provider item id', () => {
    const realtime = {
      ...EMPTY_CODEX_REALTIME_SESSION_VIEW,
      segments: [{
        id: 'provider-user', sourceItemId: 'user-1', realtimeSessionId: 'rt-1',
        role: 'user', text: 'Canonical', position: 1,
      }],
      liveItems: [
        { itemId: 'user-1', realtimeSessionId: 'rt-1', role: 'user', text: 'Completed', done: true, localOrder: 1 },
        { itemId: 'assistant-1', realtimeSessionId: 'rt-1', role: 'assistant', text: 'Streaming', done: false, localOrder: 2 },
      ],
    } satisfies typeof EMPTY_CODEX_REALTIME_SESSION_VIEW

    expect(selectRealtimeTranscript(realtime).map((segment) => segment.text)).toEqual(['Completed'])
  })

  it('joins one speaker\'s consecutive realtime items into a single markdown block', () => {
    const result = realtimeSegmentsToMessage([
      { id: 'a-1', sourceItemId: 'item-1', realtimeSessionId: 'rt-1', role: 'assistant', text: 'On it. ', position: 2 },
      { id: 'a-2', sourceItemId: 'item-2', realtimeSessionId: 'rt-1', role: 'assistant', text: 'Done.', position: 3 },
    ])

    expect(result.content).toEqual([{ type: 'text', text: 'On it.\n\nDone.' }])
    // Identity follows the first item so a later item arriving does not remount the block.
    expect(result.id).toBe('codex-realtime-item-1')
    expect(result.metadata?.codexTimeline?.position).toBe(2)
    expect(isRealtimeVoiceMessage(result)).toBe(true)
  })
})
