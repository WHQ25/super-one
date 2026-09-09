import { afterEach, describe, expect, it, vi } from 'vitest'
import type { ChatMessage } from '@superone/shared/agent-types'
import type { CodexAsyncQuestionAnswerCommand } from '@superone/shared/codex-async-question'
import { isCodexAsyncAnswer } from '@superone/shared/codex-async-question'
import { answerRemoteAsyncQuestion } from './agent/remote-async-question'
import { ChatRuntime } from '../../../mobile/src/runtime'

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
function host() {
  const messages = [question]
  return {
    snapshot: { harnessId: 'codex', messages },
    dispatchBackendCommand: vi.fn(async (cmd: { newUserMessageId: string; newUserText: string }) => {
      messages.push({ id: cmd.newUserMessageId, role: 'user', status: 'complete', providerId: 'codex', createdAt: '', content: [{ type: 'text', text: cmd.newUserText }] })
    }),
  }
}
afterEach(() => vi.useRealTimers())

describe('mobile async question answers', () => {
  it('steers once, persists the answer, and restores it without a duplicate user row', async () => {
    vi.useFakeTimers()
    const session = host()
    const client = {
      startBuffering() {}, releaseBuffer: () => ({ epoch: 1, batches: [] }),
      request: async (request: { type: string }) => {
        if (request.type === 'load_session_messages') return { messages: session.snapshot.messages, provider: 'codex', hasMore: false }
        if (request.type === 'get_session_state') return { status: 'streaming' }
        if (request.type === command.type) return { ok: true, reply: await answerRemoteAsyncQuestion(session as never, request as CodexAsyncQuestionAnswerCommand) }
        return { ok: true }
      },
    }
    const runtime = new ChatRuntime(client as never, vi.fn())
    await runtime.open('/project', 'session')
    await runtime.answerCodexAsyncQuestion('turn', 'question', ['Production'])
    await runtime.answerCodexAsyncQuestion('turn', 'question', ['Production'])
    expect(session.dispatchBackendCommand).toHaveBeenCalledTimes(1)
    expect(session.dispatchBackendCommand).toHaveBeenCalledWith({
      kind: 'codex.steer', input: 'Production', newAssistantMessageId: '',
      newUserMessageId: 'codex_async_answer:question', newUserText: 'Production',
    })
    await runtime.reopen()
    expect(runtime.messages.filter(isCodexAsyncAnswer)).toHaveLength(1)
    expect(runtime.messages.filter(message => !isCodexAsyncAnswer(message))).toEqual([question])
    runtime.dispose()
  })

  it('does not record a rejected answer and allows retry', async () => {
    const session = host()
    session.dispatchBackendCommand.mockRejectedValueOnce(new Error('No active turn'))
    await expect(answerRemoteAsyncQuestion(session as never, command)).rejects.toThrow('No active turn')
    expect(session.snapshot.messages).toEqual([question])
    await expect(answerRemoteAsyncQuestion(session as never, command)).resolves.toBe('Production')
  })

  it('rejects stale questions and missing answers before steering', async () => {
    const session = host()
    await expect(answerRemoteAsyncQuestion(session as never, { ...command, messageId: 'other-session' })).rejects.toThrow('not found')
    await expect(answerRemoteAsyncQuestion(session as never, { ...command, answers: [] })).rejects.toThrow('requires an answer')
    expect(session.dispatchBackendCommand).not.toHaveBeenCalled()
  })
})
