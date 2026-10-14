import { describe, expect, it, vi } from 'vitest'
import type { AgentEvent, ChatMessage, SendMessageRequest } from '@superone/shared/agent-types'
import { parseTurnMetaMarker } from '@superone/shared/transcript-markers'
import { Session } from './session'
import type { SessionBackend } from './types'

vi.mock('../logger', () => ({ default: { info: vi.fn(), warn: vi.fn(), debug: vi.fn(), error: vi.fn() } }))

function fixture(initialMessages: ChatMessage[]) {
  let emit!: (event: AgentEvent) => void
  const backend = {
    kind: 'claude', start: vi.fn(async () => {}), send: vi.fn(async (_request: SendMessageRequest) => {}),
    onEvent: (listener: typeof emit) => { emit = listener; return () => {} },
    onProviderSessionId: () => () => {}, onPermissionModeApplied: () => () => {},
  }
  const onStateChange = vi.fn()
  const session = new Session({ id: 'session', projectPath: '/project', cwd: '/project',
    providerId: 'claude', harnessId: 'claude', providerConfig: {}, backend: backend as unknown as SessionBackend,
    initialMessages, onStateChange })
  return { session, onStateChange, emit: (event: AgentEvent) => emit(event) }
}

function msg(id: string, role: 'user' | 'assistant', over: Partial<ChatMessage> = {}): ChatMessage {
  return { id, role, status: 'complete', content: [], createdAt: '', providerId: 'claude', ...over }
}

describe('local-command /recap transcript row', () => {
  it('persists the recap row in place of the "/recap" bubble and its blank reply', async () => {
    const { session, emit, onStateChange } = fixture([msg('u1', 'user'), msg('a1', 'assistant')])
    const sending = session.send({ content: '/recap', assistantMessageId: 'a-recap' })
    await vi.waitFor(() => expect(session.snapshot.messages).toHaveLength(3))
    emit({ type: 'message_start', message: msg('a-recap', 'assistant', { status: 'streaming' }) })
    emit({ type: 'slash_command_output', messageId: 'a-recap', content: 'Shipped; next is push.', command: 'recap' })
    emit({ type: 'message_complete', messageId: 'a-recap' })
    await sending

    const messages = session.snapshot.messages
    expect(messages.slice(0, 2).map((m) => m.id)).toEqual(['u1', 'a1'])
    expect(messages).toHaveLength(3)
    expect(parseTurnMetaMarker(messages[2])).toEqual({ kind: 'recap', text: 'Shipped; next is push.', auto: false })
    expect(onStateChange).toHaveBeenCalledWith(expect.objectContaining({ messagePersistMode: { kind: 'full' } }))
  })

  it('leaves other commands\' stdout out of the transcript', () => {
    const { session, emit } = fixture([msg('u1', 'user'), msg('a1', 'assistant')])
    emit({ type: 'slash_command_output', messageId: 'a1', content: 'Total cost: $0.42', command: 'cost' })
    expect(session.snapshot.messages.map((m) => m.id)).toEqual(['u1', 'a1'])
  })
})
