import { afterEach, describe, expect, it, vi } from 'vitest'
import type { AgentEvent, ChatMessage } from '@superone/shared/agent-types'
import { Session } from './session/session'
import type { SessionBackend } from './session/types'
import type { CodexAsyncQuestionAnswerCommand } from '@superone/shared/codex-async-question'
import { isCodexAsyncAnswer } from '@superone/shared/codex-async-question'
import { answerRemoteAsyncQuestion } from './agent/remote-async-question'
import { ChatRuntime } from '../../../mobile/src/runtime'

vi.mock('./logger', () => ({ default: { info: vi.fn(), warn: vi.fn(), debug: vi.fn(), error: vi.fn() } }))

const command: CodexAsyncQuestionAnswerCommand = {
  type: 'codex_async_question_answer', requestId: 'request', projectPath: '/project', sessionId: 'session',
  messageId: 'turn', itemId: 'question', answers: ['Production'],
}
const question: ChatMessage = {
  id: 'turn', role: 'assistant', status: 'streaming', content: [], createdAt: '', providerId: 'codex',
  metadata: { codex: { threadId: 'thread', usage: null, items: [{
    id: 'question', type: 'agent_message', text: '', delivery: 'async',
    questions: [{ title: 'Which environment?', options: ['Staging', 'Production'] }],
  }] } },
}
function host(handleCommand = vi.fn(async () => {})) {
  const backend = {
    kind: 'codex', handleCommand,
    onEvent: () => () => {},
    onProviderSessionId: () => () => {}, onPermissionModeApplied: () => () => {},
  } as unknown as SessionBackend
  const session = new Session({
    id: 'session', projectPath: '/project', cwd: '/project', providerId: 'codex-base',
    harnessId: 'codex', providerConfig: {}, backend, initialMessages: [question],
  })
  vi.spyOn(session, 'dispatchBackendCommand')
  session.emitHostEvent({ type: 'status_change', status: 'streaming' })
  return session
}
afterEach(() => vi.useRealTimers())

describe('mobile async question answers', () => {
  it('broadcasts the accepted reply once to live desktop and mobile subscribers', async () => {
    const session = host()
    const events: AgentEvent[] = []
    session.on(event => events.push(event))
    await answerRemoteAsyncQuestion(session, command)
    await answerRemoteAsyncQuestion(session, command)
    expect(events.filter(event => event.type === 'user_message_appended')).toEqual([
      expect.objectContaining({
        type: 'user_message_appended', projectPath: '/project', sessionId: 'session',
        message: expect.objectContaining({ id: 'codex_async_answer:question', content: [{ type: 'text', text: 'Production' }] }),
      }),
    ])
  })
  it('steers once, persists the answer, and restores it without a duplicate user row', async () => {
    vi.useFakeTimers()
    const session = host()
    const client = {
      startBuffering() {}, releaseBuffer: () => ({ epoch: 1, batches: [] }),
      request: async (request: { type: string }) => {
        if (request.type === 'load_session_messages') return { messages: session.snapshot.messages, provider: 'codex', hasMore: false }
        if (request.type === 'get_session_state') return { status: 'streaming' }
        if (request.type === command.type) return { ok: true, reply: await answerRemoteAsyncQuestion(session, request as CodexAsyncQuestionAnswerCommand) }
        return { ok: true }
      },
    }
    const runtime = new ChatRuntime(client as never, vi.fn())
    await runtime.open('/project', 'session')
    const unsubscribe = session.on(event => runtime.ingest([event], 1))
    await runtime.answerCodexAsyncQuestion('turn', 'question', ['Production'])
    await runtime.answerCodexAsyncQuestion('turn', 'question', ['Production'])
    expect(session.dispatchBackendCommand).toHaveBeenCalledTimes(1)
    expect(session.dispatchBackendCommand).toHaveBeenCalledWith({
      kind: 'codex.steer', input: 'Production', newAssistantMessageId: '',
      newUserMessageId: 'codex_async_answer:question', newUserText: 'Production',
      providerOrigin: 'remote',
    })
    expect(runtime.messages.filter(isCodexAsyncAnswer)).toHaveLength(1)
    await runtime.reopen()
    expect(runtime.messages.filter(isCodexAsyncAnswer)).toHaveLength(1)
    expect(runtime.messages.filter(message => !isCodexAsyncAnswer(message))).toEqual([question])
    unsubscribe()
    runtime.dispose()
  })

  it('does not record a rejected answer and allows retry', async () => {
    const handleCommand = vi.fn(async () => {}).mockRejectedValueOnce(new Error('No active turn'))
    const session = host(handleCommand)
    const events: AgentEvent[] = []
    session.on(event => events.push(event))
    await expect(answerRemoteAsyncQuestion(session, command)).rejects.toThrow('No active turn')
    expect(session.snapshot.messages).toEqual([question])
    expect(events.filter(event => event.type === 'user_message_appended')).toHaveLength(0)
    await expect(answerRemoteAsyncQuestion(session, command)).resolves.toBe('Production')
  })

  it('rejects stale questions and missing answers before steering', async () => {
    const session = host()
    await expect(answerRemoteAsyncQuestion(session, { ...command, messageId: 'other-session' })).rejects.toThrow('not found')
    await expect(answerRemoteAsyncQuestion(session, { ...command, answers: [] })).rejects.toThrow('requires an answer')
    expect(session.dispatchBackendCommand).not.toHaveBeenCalled()
  })
})
