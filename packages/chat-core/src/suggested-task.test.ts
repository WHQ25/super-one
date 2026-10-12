import { expect, it } from 'vitest'
import type { AgentEvent, ChatMessage, CodexMcpToolCallItem } from '@superone/shared/agent-types'
import { findSuggestedTask } from '@superone/shared/suggested-task'
import { codexContentEvents } from '@superone/shared/test-fixtures/codex-content'
import { createDefaultChatCoreSession } from './defaults'
import { applyEventToSession } from './reducer'

const TASK_ID = '0b9f3c1e-2a4d-4e5f-8a6b-7c8d9e0f1a2b'
const INPUT = { title: 'Fix the flaky login test', tldr: 'Times out on CI.', prompt: 'Fix it.' }

it('keeps a card launched mid-turn through the Codex turn completion', () => {
  const item: CodexMcpToolCallItem = {
    id: 'call',
    type: 'mcp_tool_call',
    server: 'superone',
    tool: 'session_suggest_task',
    arguments: INPUT,
    status: 'completed',
    result: { content: [{ type: 'text', text: JSON.stringify({ taskId: TASK_ID, status: 'pending' }) }], structuredContent: null },
  }
  const message: ChatMessage = {
    id: 'm', role: 'assistant', status: 'streaming', createdAt: '', providerId: 'codex', content: [],
    metadata: { codex: { threadId: 'thread', usage: null, items: [] } },
  }
  let session = { ...createDefaultChatCoreSession(), messages: [message] }
  const apply = (event: AgentEvent) => { session = { ...session, ...applyEventToSession(session, event) } }

  codexContentEvents('m', item).forEach(apply)
  apply({ type: 'suggested_task_updated', taskId: TASK_ID, state: { status: 'launched', sessionId: 'child' } })
  apply({ type: 'message_complete', messageId: 'm', metadata: { codex: { finalResponse: 'done', threadId: 'thread', usage: null, items: [] } } })

  expect(findSuggestedTask(session.messages, TASK_ID)?.state).toEqual({ status: 'launched', sessionId: 'child' })
})
