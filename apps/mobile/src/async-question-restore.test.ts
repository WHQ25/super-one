import { expect, it } from 'vitest'
import { codexAsyncQuestionRequest } from '@superone/shared/codex-async-question'
import type { CodexAgentMessageItem } from '@superone/shared/agent-types'
import { ChatRuntime } from './runtime'
import { runtimeTestClient, sessionLoadFixture } from './runtime-test-client'

it('answers a restored async decision outside the loaded history and retains its question snapshot', async () => {
  const item: CodexAgentMessageItem = { id: 'q', type: 'agent_message', text: '', delivery: 'async', questions: [{ title: 'Environment?', options: ['Production'] }] }
  const client = runtimeTestClient()
  const dispatch = client.dispatch.getMockImplementation()!
  client.dispatch.mockImplementation(async cmd => cmd.method === 'session.load'
    ? sessionLoadFixture({ state: { sessionProvider: 'codex', pendingAsyncQuestions: [{ messageId: 'old-turn', item, request: codexAsyncQuestionRequest(item) }] } })
    : cmd.method === 'session.answerAsyncQuestion' ? { reply: 'Production' } : dispatch(cmd))
  const runtime = new ChatRuntime(client as never, () => {})
  try {
    await runtime.open('/project', 'session')
    expect(runtime.messages).toEqual([])
    await runtime.answerCodexAsyncQuestion('old-turn', 'q', ['Production'])
    expect(runtime.session.pendingAsyncQuestions).toEqual([])
    expect(runtime.messages[0]?.content).toEqual([{ type: 'text', text: 'Production', codexAsyncQuestions: item.questions }])
  } finally { runtime.dispose() }
})
