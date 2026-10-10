import { describe, expect, it } from 'vitest'
import { applyEventToSession, createDefaultChatCoreSession, createStreamingToolInputStore, defaultChatCorePorts } from '@superone/chat-core'
import type { ChatMessage, ContentBlock } from '@superone/shared/agent-types'
import { catchUpEvents } from './routed-catch-up'

const message = (id: string, content: ContentBlock[], status: ChatMessage['status'] = 'complete', role: ChatMessage['role'] = 'assistant'): ChatMessage =>
  ({ id, role, status, providerId: 'claude', createdAt: new Date(0).toISOString(), content })

function replay(have: ChatMessage[], want: ChatMessage[]): ChatMessage[] {
  const events = catchUpEvents(have, want)
  expect(events).not.toBeNull()
  const ports = { ...defaultChatCorePorts, streaming: createStreamingToolInputStore() }
  let state = { ...createDefaultChatCoreSession(), messages: have }
  for (const event of events!) state = { ...state, ...applyEventToSession(state, event, ports) }
  return state.messages
}

/** What a reader sees; the reducer also stamps block timings. */
const content = (messages: ChatMessage[]) => messages.map((m) => [m.id, m.status, m.content.map(({ startedAt: _s, endedAt: _e, ...block }: ContentBlock & { startedAt?: number; endedAt?: number }) => block)])

describe('catchUpEvents', () => {
  it("brings a phone's messages to the snapshot through its own reducer", () => {
    const have = [message('u', [{ type: 'text', text: 'hi' }], 'complete', 'user'), message('a', [{ type: 'thinking', thinking: 'Let' }], 'streaming')]
    const want = [
      have[0]!,
      message('a', [{ type: 'thinking', thinking: 'Let me look' }, { type: 'tool_use', toolName: 'Read', toolUseId: 't', input: '{}' }, { type: 'text', text: 'Done' }]),
      message('b', [{ type: 'text', text: 'Next' }], 'streaming'),
    ]
    expect(content(replay(have, want))).toEqual(content(want))
  })

  it('needs nothing when the phone is current', () => {
    const have = [message('a', [{ type: 'text', text: 'same' }])]
    expect(catchUpEvents(have, have)).toEqual([])
  })

  it('gives up when the phone holds what the snapshot does not', () => {
    expect(catchUpEvents([message('a', [{ type: 'text', text: 'one' }, { type: 'text', text: 'two' }])], [message('a', [{ type: 'text', text: 'one' }])])).toBeNull()
    expect(catchUpEvents([message('a', [{ type: 'text', text: 'abc' }], 'streaming')], [message('a', [{ type: 'text', text: 'xyz' }])])).toBeNull()
  })
})
