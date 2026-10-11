import { describe, expect, it } from 'vitest'
import type { ChatMessage } from './agent-types'
import { applySuggestedTaskUpdate, findSuggestedTask, suggestedTaskIdFromResult } from './suggested-task'

const TASK_ID = '0b9f3c1e-2a4d-4e5f-8a6b-7c8d9e0f1a2b'
const INPUT = { title: 'Fix the flaky login test', tldr: 'It times out on CI.', prompt: '## Task\nFix it.' }
const RESULT = JSON.stringify({ taskId: TASK_ID, status: 'pending' })
/** Claude reports an MCP result as its serialized reply envelope. */
const CLAUDE_ENVELOPE = JSON.stringify({ content: [{ type: 'text', text: RESULT }] })

function claudeTranscript(summary = CLAUDE_ENVELOPE): ChatMessage[] {
  return [
    {
      id: 'a1',
      role: 'assistant',
      content: [
        { type: 'text', text: 'Noting a side issue.' },
        { type: 'tool_use', toolName: 'mcp__superone__session_suggest_task', toolUseId: 'call-1', input: JSON.stringify(INPUT) },
      ],
    },
    // The result arrives in a later message than its call.
    { id: 'a2', role: 'assistant', content: [{ type: 'tool_result', toolUseId: 'call-1', summary }] },
  ] as ChatMessage[]
}

function codexTranscript(): ChatMessage[] {
  return [{
    id: 'c1',
    role: 'assistant',
    content: [],
    metadata: {
      codex: {
        items: [{
          id: 'item-1',
          type: 'mcp_tool_call',
          server: 'superone',
          tool: 'session_suggest_task',
          arguments: INPUT,
          status: 'completed',
          result: { content: [{ type: 'text', text: RESULT }], structuredContent: null },
        }],
      },
    },
  }] as unknown as ChatMessage[]
}

describe('suggested tasks', () => {
  it('reads the card id from a plain, enveloped, or truncated result', () => {
    expect(suggestedTaskIdFromResult(RESULT)).toBe(TASK_ID)
    expect(suggestedTaskIdFromResult(CLAUDE_ENVELOPE)).toBe(TASK_ID)
    expect(suggestedTaskIdFromResult(`${RESULT.slice(0, 60)}…`)).toBe(TASK_ID)
    expect(suggestedTaskIdFromResult('[Error] title is required.')).toBeNull()
  })

  it('finds a pending card from its result and records its outcome on the call row', () => {
    const messages = claudeTranscript()
    expect(findSuggestedTask(messages, TASK_ID)).toEqual({ input: INPUT })

    const next = applySuggestedTaskUpdate(messages, TASK_ID, { status: 'launched', sessionId: 's-2' })
    expect(next[0].content[1]).toMatchObject({ toolUseId: 'call-1', suggestedTask: { status: 'launched', sessionId: 's-2' } })
    // The result the model saw is untouched.
    expect(next[1]).toBe(messages[1])
    expect(findSuggestedTask(next, TASK_ID)?.state).toEqual({ status: 'launched', sessionId: 's-2' })
  })

  it('records the outcome on a Codex mcp_tool_call item', () => {
    const next = applySuggestedTaskUpdate(codexTranscript(), TASK_ID, { status: 'dismissed', by: 'agent', reason: 'Fixed it' })
    expect(findSuggestedTask(next, TASK_ID)).toEqual({
      input: INPUT,
      state: { status: 'dismissed', by: 'agent', reason: 'Fixed it' },
    })
  })

  it('leaves a card that already has an outcome as it is', () => {
    const launched = applySuggestedTaskUpdate(claudeTranscript(), TASK_ID, { status: 'launched', sessionId: 's-2' })
    expect(applySuggestedTaskUpdate(launched, TASK_ID, { status: 'dismissed', by: 'user' })).toBe(launched)
  })

  it('ignores unknown ids and other tools whose rows mention the id', () => {
    const messages = claudeTranscript()
    expect(findSuggestedTask(messages, 'missing')).toBeNull()
    expect(applySuggestedTaskUpdate(messages, 'missing', { status: 'dismissed', by: 'user' })).toBe(messages)
    const dismissCall = [{
      id: 'a3',
      role: 'assistant',
      content: [
        { type: 'tool_use', toolName: 'mcp__superone__session_dismiss_task', toolUseId: 'call-2', input: JSON.stringify({ taskId: TASK_ID }) },
        { type: 'tool_result', toolUseId: 'call-2', summary: JSON.stringify({ taskId: TASK_ID, status: 'dismissed' }) },
      ],
    }] as ChatMessage[]
    expect(findSuggestedTask(dismissCall, TASK_ID)).toBeNull()
    expect(findSuggestedTask([...messages, ...dismissCall], TASK_ID)).toEqual({ input: INPUT })
  })
})
