/** @vitest-environment jsdom */

import { describe, it, expect, vi } from 'vitest'
import type { ChatMessage, ContentBlock } from '@superone/shared/agent-types'

vi.mock('@/stores/app', () => ({ useAppStore: { getState: () => ({ sandboxCapability: null }) } }))
vi.mock('@/stores/activity-view-state', () => ({ useActivityViewStateStore: { getState: () => ({}) } }))
vi.stubGlobal('window', {
  agent: new Proxy({}, { get: () => () => Promise.resolve(undefined) }),
  app: { trace: vi.fn(), getAppSettings: vi.fn().mockResolvedValue({ agentPreference: {} }) },
})

await import('../index')
const { createDefaultPerSessionState } = await import('../defaults')
const { reduceContentDelta } = await import('./content')

function makeAssistant(id: string, blocks: ContentBlock[] = []): ChatMessage {
  return {
    id, role: 'assistant', status: 'streaming', content: blocks, createdAt: '', providerId: 'claude',
  }
}

describe('reduceContentDelta: text deltas', () => {
  it('applies a text delta onto the active assistant message', () => {
    const session = createDefaultPerSessionState()
    session.messages = [makeAssistant('m1')]
    const patch = reduceContentDelta(session, {
      type: 'content_delta', messageId: 'm1',
      delta: { type: 'text', text: 'hello' },
    } as never)
    const block = patch.messages?.[0].content[0] as { type: 'text'; text: string }
    expect(block.type).toBe('text')
    expect(block.text).toBe('hello')
  })

  it('is a tick-only patch when the event is a replay for the target', () => {
    const session = createDefaultPerSessionState()
    session.messages = [{ ...makeAssistant('m1'), _lastAppliedSeq: 10 } as ChatMessage]
    const patch = reduceContentDelta(session, {
      type: 'content_delta', messageId: 'm1',
      delta: { type: 'text', text: 'late' }, seq: 5,
    } as never)
    expect(patch.messages).toBeUndefined()
    expect(patch.lastEventAt).toBeGreaterThan(0)
  })

  it('clears session.apiRetry when present (recovered from retry)', () => {
    const session = createDefaultPerSessionState()
    session.messages = [makeAssistant('m1')]
    session.apiRetry = { attempt: 1, maxRetries: 3, delayMs: 100 }
    const patch = reduceContentDelta(session, {
      type: 'content_delta', messageId: 'm1', delta: { type: 'text', text: 'x' },
    } as never)
    expect(patch.apiRetry).toBeNull()
  })
})

describe('reduceContentDelta: TodoWrite tool result', () => {
  it('replaces the entire todo list when TodoWrite resolves', () => {
    const session = createDefaultPerSessionState()
    const todoInput = JSON.stringify({
      todos: [
        { content: 'first', status: 'completed', activeForm: 'doing first' },
        { content: 'second', status: 'pending' },
      ],
    })
    session.messages = [makeAssistant('m1', [
      { type: 'tool_use', toolUseId: 'tw-1', toolName: 'TodoWrite', input: todoInput } as ContentBlock,
    ])]

    const patch = reduceContentDelta(session, {
      type: 'content_delta', messageId: 'm1',
      delta: { type: 'tool_result', toolUseId: 'tw-1', summary: '' },
    } as never)
    expect(Object.keys(patch.todos ?? {})).toEqual(['1', '2'])
    expect(patch.todos?.['1']).toMatchObject({ subject: 'first', status: 'completed', activeForm: 'doing first' })
    expect(patch._nextTodoId).toBe(3)
    expect(patch.showTodos).toBe(true)
  })

  it('does not auto-show todos when user dismissed earlier', () => {
    const session = createDefaultPerSessionState()
    session._todosUserDismissed = true
    session.messages = [makeAssistant('m1', [
      { type: 'tool_use', toolUseId: 'tw-1', toolName: 'TodoWrite', input: '{"todos":[{"content":"a","status":"pending"}]}' } as ContentBlock,
    ])]
    const patch = reduceContentDelta(session, {
      type: 'content_delta', messageId: 'm1',
      delta: { type: 'tool_result', toolUseId: 'tw-1' },
    } as never)
    expect(patch.showTodos).toBeUndefined()
  })
})

describe('reduceContentDelta: TaskCreate tool result', () => {
  it('appends a new task with auto-incremented id when no toolTodos override is supplied', () => {
    const session = createDefaultPerSessionState()
    session._nextTodoId = 7
    session.messages = [makeAssistant('m1', [
      { type: 'tool_use', toolUseId: 'tc-1', toolName: 'TaskCreate', input: '{"subject":"do it","description":"now"}' } as ContentBlock,
    ])]
    const patch = reduceContentDelta(session, {
      type: 'content_delta', messageId: 'm1',
      delta: { type: 'tool_result', toolUseId: 'tc-1' },
    } as never)
    expect(patch.todos?.['7']).toMatchObject({ subject: 'do it', description: 'now', status: 'pending' })
    expect(patch._nextTodoId).toBe(8)
  })

  it('honors the toolTodos[0].taskId override and skips _nextTodoId bump', () => {
    const session = createDefaultPerSessionState()
    session._nextTodoId = 7
    session.messages = [makeAssistant('m1', [
      { type: 'tool_use', toolUseId: 'tc-1', toolName: 'TaskCreate', input: '{"subject":"alpha"}' } as ContentBlock,
    ])]
    const patch = reduceContentDelta(session, {
      type: 'content_delta', messageId: 'm1',
      delta: { type: 'tool_result', toolUseId: 'tc-1', toolTodos: [{ taskId: 'task-abc' }] as never },
    } as never)
    expect(patch.todos?.['task-abc']).toMatchObject({ subject: 'alpha' })
    expect(patch._nextTodoId).toBeUndefined()
  })

  it('does not create a phantom todo when the TaskCreate call failed validation (isError)', () => {
    const session = createDefaultPerSessionState()
    session._nextTodoId = 1
    session.messages = [makeAssistant('m1', [
      { type: 'tool_use', toolUseId: 'tc-1', toolName: 'TaskCreate', input: '{"tasks":[{"content":"x"}]}' } as ContentBlock,
    ])]
    const patch = reduceContentDelta(session, {
      type: 'content_delta', messageId: 'm1',
      delta: { type: 'tool_result', toolUseId: 'tc-1', isError: true },
    } as never)
    expect(patch.todos).toBeUndefined()
    expect(patch._nextTodoId).toBeUndefined()
    expect(patch.showTodos).toBeUndefined()
  })
})

describe('reduceContentDelta: TaskUpdate tool result', () => {
  it("deletes the task when input.status === 'deleted'", () => {
    const session = createDefaultPerSessionState()
    session.todos = { '5': { id: '5', subject: 'x', status: 'pending' } as never }
    session.messages = [makeAssistant('m1', [
      { type: 'tool_use', toolUseId: 'tu-1', toolName: 'TaskUpdate', input: '{"taskId":"5","status":"deleted"}' } as ContentBlock,
    ])]
    const patch = reduceContentDelta(session, {
      type: 'content_delta', messageId: 'm1',
      delta: { type: 'tool_result', toolUseId: 'tu-1' },
    } as never)
    expect(patch.todos).toEqual({})
  })

  it('merges status/subject + dedupes addBlockedBy + addBlocks lists', () => {
    const session = createDefaultPerSessionState()
    session.todos = { '5': { id: '5', subject: 'x', status: 'pending', blockedBy: ['1'], blocks: ['2'] } as never }
    session.messages = [makeAssistant('m1', [
      { type: 'tool_use', toolUseId: 'tu-1', toolName: 'TaskUpdate', input: JSON.stringify({
        taskId: '5', status: 'in_progress', subject: 'updated',
        addBlockedBy: ['1', '3'], addBlocks: ['4'],
      }) } as ContentBlock,
    ])]
    const patch = reduceContentDelta(session, {
      type: 'content_delta', messageId: 'm1',
      delta: { type: 'tool_result', toolUseId: 'tu-1' },
    } as never)
    expect(patch.todos?.['5']).toMatchObject({
      status: 'in_progress', subject: 'updated', blockedBy: ['1', '3'], blocks: ['2', '4'],
    })
  })

  it('is a no-op when the target taskId is unknown', () => {
    const session = createDefaultPerSessionState()
    session.todos = {}
    session.messages = [makeAssistant('m1', [
      { type: 'tool_use', toolUseId: 'tu-1', toolName: 'TaskUpdate', input: '{"taskId":"ghost","status":"in_progress"}' } as ContentBlock,
    ])]
    const patch = reduceContentDelta(session, {
      type: 'content_delta', messageId: 'm1',
      delta: { type: 'tool_result', toolUseId: 'tu-1' },
    } as never)
    expect(patch.todos).toBeUndefined()
  })
})

describe('reduceContentDelta: EnterPlanMode / ExitPlanMode', () => {
  it('switches permissionMode to plan when EnterPlanMode tool_result lands', () => {
    const session = createDefaultPerSessionState()
    session.messages = [makeAssistant('m1', [
      { type: 'tool_use', toolUseId: 'p1', toolName: 'EnterPlanMode', input: '' } as ContentBlock,
    ])]
    const patch = reduceContentDelta(session, {
      type: 'content_delta', messageId: 'm1',
      delta: { type: 'tool_result', toolUseId: 'p1' },
    } as never)
    expect(patch.permissionMode).toBe('plan')
  })

  it("annotates the tool_result with '[denied] …' summary when ExitPlanMode lands after a rejected plan approval", () => {
    const session = createDefaultPerSessionState()
    session.planApprovalOutcome = { approved: false, feedback: 'this is wrong' }
    session.messages = [makeAssistant('m1', [
      { type: 'tool_use', toolUseId: 'p1', toolName: 'ExitPlanMode', input: '' } as ContentBlock,
    ])]
    const patch = reduceContentDelta(session, {
      type: 'content_delta', messageId: 'm1',
      delta: { type: 'tool_result', toolUseId: 'p1', summary: '' },
    } as never)
    // applyDelta appends a fresh tool_result for the toolUseId; ExitPlanMode's
    // [denied] override patches the latest tool_result for that toolUseId.
    const resultBlock = patch.messages?.[0].content.findLast(
      (b) => b.type === 'tool_result' && (b as { toolUseId: string }).toolUseId === 'p1',
    ) as { summary: string }
    expect(resultBlock.summary).toMatch(/^\[denied\] this is wrong/)
  })

  it('does not write [denied] when planApprovalOutcome was approved', () => {
    const session = createDefaultPerSessionState()
    session.planApprovalOutcome = { approved: true }
    session.messages = [makeAssistant('m1', [
      { type: 'tool_use', toolUseId: 'p1', toolName: 'ExitPlanMode', input: '' } as ContentBlock,
    ])]
    const patch = reduceContentDelta(session, {
      type: 'content_delta', messageId: 'm1',
      delta: { type: 'tool_result', toolUseId: 'p1', summary: 'original' },
    } as never)
    const resultBlock = patch.messages?.[0].content.findLast(
      (b) => b.type === 'tool_result' && (b as { toolUseId: string }).toolUseId === 'p1',
    ) as { summary: string }
    expect(resultBlock.summary).toBe('original')
  })
})
