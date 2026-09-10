import { describe, expect, it, vi } from 'vitest'
import type { AgentEvent, ChatMessage, SendMessageRequest } from '@superone/shared/agent-types'
import type { CodexAsyncQuestionAnswerCommand } from '@superone/shared/codex-async-question'
import { ChatRuntime } from '../../../../mobile/src/runtime'
import { answerRemoteAsyncQuestion } from '../agent/remote-async-question'
import { Session } from './session'
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
  const session = new Session({ id: 'session', projectPath: '/project', cwd: '/project',
    providerId: 'codex', harnessId: 'codex', providerConfig: {}, backend: backend as unknown as SessionBackend, initialMessages })
  return { session, backend, emit: (event: AgentEvent) => emit(event) }
}

const answer = { kind: 'codex.steer' as const, input: 'Production', newAssistantMessageId: '',
  newUserMessageId: 'codex_async_answer:question', newUserText: 'Production' }

describe('Codex async answers across turn completion', () => {
  it('delivers a mobile answer after completion and restores its submitted state', async () => {
    const { session, backend } = fixture([{
      id: 'turn', role: 'assistant', status: 'complete', content: [], createdAt: '', providerId: 'codex',
      metadata: { codex: { threadId: 'thread', usage: null, items: [{ id: 'question', type: 'agent_message',
        text: '', delivery: 'async', questions: [{ title: 'Environment?', options: ['Production'] }] }] } },
    }])
    session.claim({ kind: 'remote', deviceId: 'phone' })
    session.subscribe('phone')
    const client = {
      startBuffering() {}, releaseBuffer: () => ({ epoch: 1, batches: [] }),
      async request(command: { type: string }) {
        if (command.type === 'load_session_messages') return { messages: session.snapshot.messages, provider: 'codex', hasMore: false }
        if (command.type === 'get_session_state') return { status: 'idle' }
        if (command.type === 'codex_async_question_answer') {
          return { ok: true, reply: await answerRemoteAsyncQuestion(session, command as CodexAsyncQuestionAnswerCommand) }
        }
        return { ok: true }
      },
    }
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
    const { session, backend } = fixture()
    session.claim({ kind: 'remote', deviceId: 'phone' })
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
    expect(backend.send).toHaveBeenCalledWith(expect.objectContaining({ content: 'Production', clientMessageId: answer.newUserMessageId, model: 'gpt-5.6-sol', effort: 'high' }))
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
    expect(backend.handleCommand).toHaveBeenCalledWith(answer)
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
