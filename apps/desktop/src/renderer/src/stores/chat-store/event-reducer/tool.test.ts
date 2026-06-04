/** @vitest-environment jsdom */

import { describe, it, expect, vi } from 'vitest'
import type { ChatMessage, ContentBlock } from '@superone/shared/agent-types'

vi.mock('@/stores/app', () => ({ useAppStore: { getState: () => ({ sandboxCapability: null }) } }))
vi.mock('@/stores/activity-view-state', () => ({ useActivityViewStateStore: { getState: () => ({}) } }))

const mockTrace = vi.fn()
vi.stubGlobal('window', {
  agent: new Proxy({}, { get: () => () => Promise.resolve(undefined) }),
  app: { trace: mockTrace, getAppSettings: vi.fn().mockResolvedValue({ agentPreference: {} }) },
})

await import('../index')
const { createDefaultPerSessionState } = await import('../defaults')
const { reduceTool } = await import('./tool')
const { streamingToolInputRaw, streamingPreviewLastUpdate } = await import('./shared')

function toolUseBlock(toolUseId: string, toolName: string, input = ''): ContentBlock {
  return { type: 'tool_use', toolUseId, toolName, input } as ContentBlock
}

function makeAssistant(id: string, blocks: ContentBlock[] = []): ChatMessage {
  return {
    id, role: 'assistant', status: 'streaming', content: blocks, createdAt: '', providerId: 'claude',
  }
}

describe('reduceTool: tool_input_delta', () => {
  it('is a tick-only patch for a non-streamable tool', () => {
    const session = createDefaultPerSessionState()
    session.messages = [makeAssistant('m1', [toolUseBlock('t1', 'BashTool')])]
    const patch = reduceTool(session, {
      type: 'tool_input_delta', messageId: 'm1', toolUseId: 't1', partialJson: '{"x":',
    } as never)
    expect(patch.lastEventAt).toBeGreaterThan(0)
    expect(patch.messages).toBeUndefined()
  })

  it('accumulates raw input + emits a throttled preview for a STREAMING_INPUT_TOOL', () => {
    streamingToolInputRaw.clear()
    streamingPreviewLastUpdate.clear()
    const session = createDefaultPerSessionState()
    session.messages = [makeAssistant('m1', [toolUseBlock('t1', 'Edit')])]

    const patch = reduceTool(session, {
      type: 'tool_input_delta', messageId: 'm1', toolUseId: 't1', partialJson: '{"file_path":"/x",',
    } as never)
    expect(streamingToolInputRaw.get('t1')).toBe('{"file_path":"/x",')
    expect(patch._streamingToolInputPreviews?.['t1']).toBeDefined()
  })

  it('returns the appended-input messages branch for __widget_show tools (non-STREAMING)', () => {
    const session = createDefaultPerSessionState()
    session.messages = [makeAssistant('m1', [toolUseBlock('t1', 'mcp__superone__myapp__widget_show')])]
    const patch = reduceTool(session, {
      type: 'tool_input_delta', messageId: 'm1', toolUseId: 't1', partialJson: '{"a":1}',
    } as never)
    const tool = patch.messages?.[0].content[0] as { input: string }
    expect(tool.input).toBe('{"a":1}')
  })
})

describe('reduceTool: tool_progress', () => {
  it('writes elapsedSeconds onto the target tool block', () => {
    const session = createDefaultPerSessionState()
    session.messages = [makeAssistant('m1', [toolUseBlock('t1', 'BashTool')])]
    const patch = reduceTool(session, {
      type: 'tool_progress', messageId: 'm1', toolUseId: 't1', elapsedSeconds: 4,
    } as never)
    const tool = patch.messages?.[0].content[0] as { elapsedSeconds?: number }
    expect(tool.elapsedSeconds).toBe(4)
  })

  it('leaves non-target tool blocks untouched', () => {
    const session = createDefaultPerSessionState()
    session.messages = [makeAssistant('m1', [toolUseBlock('t1', 'BashTool'), toolUseBlock('t2', 'Read')])]
    const patch = reduceTool(session, {
      type: 'tool_progress', messageId: 'm1', toolUseId: 't1', elapsedSeconds: 9,
    } as never)
    const blocks = patch.messages?.[0].content as Array<{ toolUseId: string; elapsedSeconds?: number }>
    expect(blocks[0].elapsedSeconds).toBe(9)
    expect(blocks[1].elapsedSeconds).toBeUndefined()
  })
})

describe('reduceTool: subagent_usage', () => {
  it('records subagent token usage keyed by parent tool use id', () => {
    const session = createDefaultPerSessionState()
    const patch = reduceTool(session, {
      type: 'subagent_usage', parentToolUseId: 'parent-1', inputTokens: 10, outputTokens: 20,
    } as never)
    expect(patch.subagentTokens).toEqual({ 'parent-1': { input: 10, output: 20 } })
  })

  it('merges with existing subagent token entries', () => {
    const session = createDefaultPerSessionState()
    session.subagentTokens = { 'existing': { input: 5, output: 5 } }
    const patch = reduceTool(session, {
      type: 'subagent_usage', parentToolUseId: 'new', inputTokens: 1, outputTokens: 2,
    } as never)
    expect(patch.subagentTokens).toEqual({
      existing: { input: 5, output: 5 },
      new: { input: 1, output: 2 },
    })
  })
})

describe('reduceTool: task_started', () => {
  it('seeds task progress with the description on first call', () => {
    const session = createDefaultPerSessionState()
    const patch = reduceTool(session, {
      type: 'task_started', toolUseId: 'task-1', description: 'Initial work',
    } as never)
    expect(patch.taskProgress?.['task-1']).toMatchObject({ description: 'Initial work', completed: false })
  })

  it('is a no-op when toolUseId is missing', () => {
    expect(reduceTool(createDefaultPerSessionState(), {
      type: 'task_started', description: 'x',
    } as never)).toEqual({})
  })

  it('preserves completed=true if previously completed', () => {
    const session = createDefaultPerSessionState()
    session.taskProgress = { 'task-1': { description: 'old', totalTokens: 0, toolUses: 0, durationMs: 0, toolHistory: [], completed: true } }
    const patch = reduceTool(session, {
      type: 'task_started', toolUseId: 'task-1', description: 'restart',
    } as never)
    expect(patch.taskProgress?.['task-1'].completed).toBe(true)
  })
})

describe('reduceTool: task_progress', () => {
  it('pushes the previous description onto toolHistory when description changes', () => {
    const session = createDefaultPerSessionState()
    session.taskProgress = { 'task-1': { description: 'reading file', lastToolName: 'Read', totalTokens: 0, toolUses: 0, durationMs: 0, toolHistory: [] } }
    const patch = reduceTool(session, {
      type: 'task_progress', toolUseId: 'task-1', description: 'editing file', lastToolName: 'Edit',
      usage: { totalTokens: 100, toolUses: 2, durationMs: 500 },
    } as never)
    const progress = patch.taskProgress?.['task-1']
    expect(progress?.description).toBe('editing file')
    expect(progress?.lastToolName).toBe('Edit')
    expect(progress?.totalTokens).toBe(100)
    expect(progress?.toolHistory).toEqual([{ toolName: 'Read', description: 'reading file' }])
  })

  it('does not push to toolHistory when description stays the same', () => {
    const session = createDefaultPerSessionState()
    session.taskProgress = { 'task-1': { description: 'same', totalTokens: 0, toolUses: 0, durationMs: 0, toolHistory: [] } }
    const patch = reduceTool(session, {
      type: 'task_progress', toolUseId: 'task-1', description: 'same',
      usage: { totalTokens: 50, toolUses: 1, durationMs: 200 },
    } as never)
    expect(patch.taskProgress?.['task-1'].toolHistory).toEqual([])
  })

  it('is a no-op when toolUseId is missing', () => {
    expect(reduceTool(createDefaultPerSessionState(), {
      type: 'task_progress', description: 'x', usage: { totalTokens: 0, toolUses: 0, durationMs: 0 },
    } as never)).toEqual({})
  })
})

describe('reduceTool: task_notification', () => {
  it('marks task as completed and patches the Agent tool_use block + outputFile', () => {
    const session = createDefaultPerSessionState()
    session.messages = [
      makeAssistant('m1', [
        { type: 'tool_use', toolUseId: 'task-1', toolName: 'Agent', input: '' } as ContentBlock,
        { type: 'tool_result', toolUseId: 'task-1', summary: '' } as ContentBlock,
      ]),
    ]
    const patch = reduceTool(session, {
      type: 'task_notification', toolUseId: 'task-1', outputFile: '/var/log/task.log',
      summary: 'done',
      usage: { totalTokens: 999, toolUses: 5, durationMs: 1234 },
    } as never)
    const agentBlock = patch.messages?.[0].content[0] as { taskUsage: { totalTokens: number }; taskSummary: string }
    expect(agentBlock.taskUsage.totalTokens).toBe(999)
    expect(agentBlock.taskSummary).toBe('done')
    const resultBlock = patch.messages?.[0].content[1] as { outputPath: string }
    expect(resultBlock.outputPath).toBe('/var/log/task.log')
    expect(patch.taskProgress?.['task-1'].completed).toBe(true)
    expect(patch.taskProgress?.['task-1'].summary).toBe('done')
  })

  it('falls back to prior progress when event lacks usage/summary', () => {
    const session = createDefaultPerSessionState()
    session.taskProgress = { 'task-1': { description: 'x', summary: 'prev', totalTokens: 10, toolUses: 2, durationMs: 50, toolHistory: [] } }
    const patch = reduceTool(session, {
      type: 'task_notification', toolUseId: 'task-1',
    } as never)
    expect(patch.taskProgress?.['task-1'].summary).toBe('prev')
    expect(patch.taskProgress?.['task-1'].completed).toBe(true)
  })

  it('is a no-op when toolUseId is missing', () => {
    expect(reduceTool(createDefaultPerSessionState(), {
      type: 'task_notification',
    } as never)).toEqual({})
  })

  it('propagates the terminal taskStatus so a failed background task is distinguishable from a completed one', () => {
    const session = createDefaultPerSessionState()
    const patch = reduceTool(session, {
      type: 'task_notification', toolUseId: 'task-1', taskStatus: 'failed', outputFile: '',
    } as never)
    expect(patch.taskProgress?.['task-1'].completed).toBe(true)
    expect(patch.taskProgress?.['task-1'].status).toBe('failed')
  })

  it('does not let a later default-completed notification clobber an already-recorded failure', () => {
    const session = createDefaultPerSessionState()
    session.taskProgress = { 'task-1': { description: 'x', totalTokens: 0, toolUses: 0, durationMs: 0, toolHistory: [], completed: true, status: 'failed' } }
    const patch = reduceTool(session, {
      type: 'task_notification', toolUseId: 'task-1', taskStatus: 'completed', outputFile: '',
    } as never)
    expect(patch.taskProgress?.['task-1'].status).toBe('failed')
  })
})
