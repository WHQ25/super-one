import { controlLeaseAuthority, acquirePhoneControl } from '../control-lease.test-fixtures'
import { describe, expect, it, vi } from 'vitest'
import type { AgentEvent, ChatMessage, SendMessageRequest } from '@superone/shared/agent-types'
import { nativeAsyncAnswerClient } from './native-async-answer-client.test-fixtures'
import { ChatRuntime } from '../../../../mobile/src/runtime'
import { answerRemoteAsyncQuestion } from '../agent/remote-async-question'
import { Session } from './session'
import { transcriptSegments } from '@superone/shared/transcript-segments'
import type { SessionBackend } from './types'

vi.mock('../logger', () => ({ default: { info: vi.fn(), warn: vi.fn(), debug: vi.fn(), error: vi.fn() } }))

function fixture(initialMessages: ChatMessage[] = []) {
  let emit!: (event: AgentEvent) => void
  const backend = {
    kind: 'codex', start: vi.fn(async () => {}), send: vi.fn(async (_request: SendMessageRequest) => {}),
    handleCommand: vi.fn(async () => {}),
    onEvent: (listener: typeof emit) => { emit = listener; return () => {} },
    onProviderSessionId: () => () => {}, onPermissionModeApplied: () => () => {},
  }
  const authority = controlLeaseAuthority()
  const session = new Session({ leaseAuthority: authority, id: 'session', projectPath: '/project', cwd: '/project',
    providerId: 'codex', harnessId: 'codex', providerConfig: {}, backend: backend as unknown as SessionBackend, initialMessages })
  return { session, backend, authority, emit: (event: AgentEvent) => emit(event) }
}

/** A completed Codex reply, as its content stream sends it. */
const reply = (id: string, text: string): AgentEvent => ({ type: 'content_delta', messageId: 'turn', delta: { type: 'text', id, text } })

const answer = { kind: 'codex.steer' as const, input: 'Production', newAssistantMessageId: '',
  newUserMessageId: 'codex_async_answer:question', newUserText: 'Production' }

describe('Codex async answers across turn completion', () => {
  it('keeps text arriving during and after answer acceptance in its original block', async () => {
    const { session, backend, emit } = fixture()
    emit({ type: 'status_change', status: 'streaming' })
    emit({ type: 'message_start', message: { id: 'turn', role: 'assistant', status: 'streaming', content: [], createdAt: '', providerId: 'codex' } })
    emit(reply('reply', 'Found the “'))
    backend.handleCommand.mockImplementationOnce(async () => { emit(reply('reply', 'earlier part')) })
    await session.dispatchBackendCommand(answer)
    emit(reply('reply', '” hint.'))
    emit({ type: 'content_delta', messageId: 'turn', delta: { type: 'thinking', id: 'reasoning', thinking: 'Check the next block.' } })
    emit(reply('next', 'The hint will be removed.'))
    for (const messages of [session.snapshot.messages, JSON.parse(JSON.stringify(session.snapshot.messages))]) {
      const segments = transcriptSegments(messages)
      expect(segments.map(segment => segment.id)).toEqual(['turn', answer.newUserMessageId, `turn:after:${answer.newUserMessageId}`, 'turn:segment:text::1'])
      expect(segments[0].message.content).toMatchObject([{ type: 'text', text: 'Found the “earlier part” hint.' }])
      expect(segments[2].message.content).toMatchObject([{ type: 'thinking', thinking: 'Check the next block.' }])
      expect(segments[3].message.content).toMatchObject([{ type: 'text', text: 'The hint will be removed.' }])
    }
  })

  it('persists and broadcasts both exact compaction cursors in a continuing provider message', () => {
    const { session, emit } = fixture()
    const outbound: AgentEvent[] = []
    session.on(event => outbound.push(event))
    emit({ type: 'message_start', message: { id: 'turn', role: 'assistant', status: 'streaming', content: [], createdAt: '', providerId: 'codex' } })
    for (const [item, boundary] of [['before', 'first'], ['middle', 'second']] as const) {
      emit(reply(item, item))
      emit({ type: 'compact_boundary', id: boundary, trigger: 'auto', preTokens: 100 })
    }
    emit(reply('after', 'after'))
    const rows = session.snapshot.messages
    const boundaries = outbound.filter(event => event.type === 'compact_boundary')
    expect(boundaries).toHaveLength(2)
    expect(boundaries.map(event => event.boundary)).toEqual(['first', 'second'].map(id => rows.find(row => row.id === id)?.metadata?.transcriptBoundary))
    expect(transcriptSegments(JSON.parse(JSON.stringify(rows))).map(segment => segment.id))
      .toEqual(['turn', 'first', 'turn:after:first', 'second', 'turn:after:second'])
  })

  it('persists the accepted-answer cursor before continuation items arrive', async () => {
    const { session, backend, emit } = fixture()
    emit({ type: 'status_change', status: 'streaming' })
    emit({ type: 'message_start', message: { id: 'turn', role: 'assistant', status: 'streaming', content: [], createdAt: '', providerId: 'codex' } })
    emit(reply('before', 'Before the answer'))
    backend.handleCommand.mockImplementationOnce(async () => {
      emit(reply('after', 'After the answer'))
    })
    await session.dispatchBackendCommand(answer)
    const accepted = session.snapshot.messages.find(message => message.id === answer.newUserMessageId)!
    expect(accepted.metadata?.transcriptBoundary).toMatchObject({ messageId: 'turn', content: { 'text::0': 17 } })
    expect(transcriptSegments(session.snapshot.messages).at(-1)?.id).toBe(`turn:after:${answer.newUserMessageId}`)
    const restored = JSON.parse(JSON.stringify(session.snapshot.messages))
    const segments = transcriptSegments(restored)
    expect(segments.map(segment => segment.id)).toEqual(['turn', answer.newUserMessageId, `turn:after:${answer.newUserMessageId}`])
    expect(segments.at(-1)?.message.content).toMatchObject([{ type: 'text', text: 'After the answer' }])
  })
  it('persists the question with the answer so the user bubble survives standalone history loading', async () => {
    const questions = [{ title: 'Environment?', options: ['Production'] }]
    const { session } = fixture([{
      id: 'turn', role: 'assistant', status: 'complete', content: [], createdAt: '', providerId: 'codex',
      metadata: { codex: { threadId: 'thread', usage: null, items: [{
        id: 'question', type: 'agent_message', text: '', delivery: 'async', questions,
      }] } },
    }])
    await session.dispatchBackendCommand(answer)
    expect(session.snapshot.messages.find(message => message.id === answer.newUserMessageId)?.content)
      .toEqual([{ type: 'text', text: 'Production', codexAsyncQuestions: questions }])
  })
  it('delivers a mobile answer after completion and restores its submitted state', async () => {
    const { session, backend, authority } = fixture([{
      id: 'turn', role: 'assistant', status: 'complete', content: [], createdAt: '', providerId: 'codex',
      metadata: { codex: { threadId: 'thread', usage: null, items: [{ id: 'question', type: 'agent_message',
        text: '', delivery: 'async', questions: [{ title: 'Environment?', options: ['Production'] }] }] } },
    }])
    const client = nativeAsyncAnswerClient(session, authority)
    const runtime = new ChatRuntime(client as never, () => {})
    await runtime.open('/project', 'session')
    await runtime.answerCodexAsyncQuestion('turn', 'question', ['Production'])
    await vi.waitFor(() => expect(backend.send).toHaveBeenCalledTimes(1))
    await runtime.answerCodexAsyncQuestion('turn', 'question', ['Production'])
    await runtime.reopen()
    expect(runtime.messages.filter(message => message.id === answer.newUserMessageId)).toHaveLength(1)
    expect(backend.handleCommand).not.toHaveBeenCalled()
    expect(backend.send).toHaveBeenCalledTimes(1)
    runtime.dispose()
  })

  it('keeps desktop send ownership checks when answering after completion', async () => {
    const { session, backend, authority } = fixture()
    acquirePhoneControl(authority, session.id, 'phone')
    await expect(session.dispatchBackendCommand(answer)).rejects.toThrow(/controlled by remote/)
    expect(backend.send).not.toHaveBeenCalled()
    expect(session.snapshot.messages).toHaveLength(0)
  })

  it('starts a normal turn when the question is answered after completion', async () => {
    const { session, backend } = fixture()
    session.setSelectedSettings({ model: 'gpt-5.6-sol', effort: 'high' })
    await session.dispatchBackendCommand(answer)
    await vi.waitFor(() => expect(backend.send).toHaveBeenCalledTimes(1))
    expect(backend.handleCommand).not.toHaveBeenCalled()
    expect(backend.send).toHaveBeenCalledWith(expect.objectContaining({ content: 'Production', clientMessageId: answer.newUserMessageId, model: 'gpt-5.6-sol', effort: 'high' }), expect.anything())
    expect(session.snapshot.messages.filter(message => message.id === answer.newUserMessageId)).toHaveLength(1)
  })

  it('acknowledges a normal send before the new turn finishes and deduplicates retries', async () => {
    const { session, backend } = fixture()
    let finish!: () => void
    backend.send.mockImplementationOnce(() => new Promise<void>(resolve => { finish = resolve }))
    await session.dispatchBackendCommand(answer)
    await vi.waitFor(() => expect(finish).toBeTypeOf('function'))
    expect(session.isStreaming()).toBe(true)
    await session.dispatchBackendCommand(answer)
    expect(backend.send).toHaveBeenCalledTimes(1)
    expect(backend.handleCommand).not.toHaveBeenCalled()
    finish()
  })

  it('steers an active turn without starting another one', async () => {
    const { session, backend, emit } = fixture()
    emit({ type: 'status_change', status: 'streaming' })
    await session.dispatchBackendCommand(answer)
    expect(backend.handleCommand).toHaveBeenCalledWith(answer, expect.any(Function))
    expect(backend.send).not.toHaveBeenCalled()
  })

  it('sends normally if the turn ends between checking its state and steering', async () => {
    const { session, backend, emit } = fixture()
    emit({ type: 'status_change', status: 'streaming' })
    backend.handleCommand.mockImplementationOnce(async () => {
      emit({ type: 'status_change', status: 'idle' })
      throw new Error('No active Codex turn to steer')
    })
    await session.dispatchBackendCommand(answer)
    await vi.waitFor(() => expect(backend.send).toHaveBeenCalledTimes(1))
    expect(session.snapshot.messages.filter(message => message.id === answer.newUserMessageId)).toHaveLength(1)
  })

  it('does not turn an unrelated steer failure into a duplicate normal send', async () => {
    const { session, backend, emit } = fixture()
    emit({ type: 'status_change', status: 'streaming' })
    backend.handleCommand.mockRejectedValueOnce(new Error('Connection lost'))
    await expect(session.dispatchBackendCommand(answer)).rejects.toThrow('Connection lost')
    expect(backend.send).not.toHaveBeenCalled()
    expect(session.snapshot.messages).toHaveLength(0)
  })
})
