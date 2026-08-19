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
const {
  streamingToolInputRaw,
  streamingPreviewLastUpdate,
  streamingToolInputOwners,
  clearStreamingToolInput,
  clearStreamingToolInputsForSession,
} = await import('./shared')

function toolUseBlock(toolUseId: string, toolName: string, input = ''): ContentBlock {
  return { type: 'tool_use', toolUseId, toolName, input } as ContentBlock
}

function makeAssistant(id: string, blocks: ContentBlock[] = []): ChatMessage {
  return {
    id, role: 'assistant', status: 'streaming', content: blocks, createdAt: '', providerId: 'claude',
  }
}

describe('streaming tool input ownership cleanup', () => {
  it('clears only the matching session ownership entries', () => {
    streamingToolInputRaw.clear()
    streamingPreviewLastUpdate.clear()
    streamingToolInputOwners.clear()
    streamingToolInputRaw.set('a', '{"x":')
    streamingToolInputRaw.set('b', '{"y":')
    streamingToolInputOwners.set('a', { projectPath: '/p1', sessionId: 's1' })
    streamingToolInputOwners.set('b', { projectPath: '/p1', sessionId: 's2' })
    clearStreamingToolInputsForSession('/p1', 's1')
    expect(streamingToolInputRaw.has('a')).toBe(false)
    expect(streamingToolInputRaw.has('b')).toBe(true)
    clearStreamingToolInput('b')
    expect(streamingToolInputRaw.has('b')).toBe(false)
  })
})

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

  it('throttles preview extraction inside the window even when deltas contain newlines', () => {
    vi.useFakeTimers()
    try {
      streamingToolInputRaw.clear()
      streamingPreviewLastUpdate.clear()
      const session = createDefaultPerSessionState()
      session.messages = [makeAssistant('m1', [toolUseBlock('t1', 'Edit')])]

      const first = reduceTool(session, {
        type: 'tool_input_delta', messageId: 'm1', toolUseId: 't1', partialJson: '{"file_path":"/x","old_string":"a\\n',
      } as never)
      expect(first._streamingToolInputPreviews?.['t1']).toBeDefined()
      session._streamingToolInputPreviews = first._streamingToolInputPreviews!

      vi.advanceTimersByTime(50)
      const second = reduceTool(session, {
        type: 'tool_input_delta', messageId: 'm1', toolUseId: 't1', partialJson: 'b\\nc\\n',
      } as never)
      expect(second._streamingToolInputPreviews).toBeUndefined()
      expect(streamingToolInputRaw.get('t1')).toContain('b\\nc\\n')

      vi.advanceTimersByTime(60)
      const third = reduceTool(session, {
        type: 'tool_input_delta', messageId: 'm1', toolUseId: 't1', partialJson: 'd',
      } as never)
      expect(third._streamingToolInputPreviews?.['t1']).toBeDefined()
    } finally {
      vi.useRealTimers()
    }
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

  it('records subagent retry status onto taskProgress keyed by tool use id', () => {
    const session = createDefaultPerSessionState()
    session.taskProgress = { t1: { description: 'sub', totalTokens: 0, toolUses: 0, durationMs: 0, toolHistory: [] } }
    session.messages = [makeAssistant('m1', [toolUseBlock('t1', 'Task')])]
    const patch = reduceTool(session, {
      type: 'tool_progress', messageId: 'm1', toolUseId: 't1', elapsedSeconds: 2,
      subagentRetry: { agentId: 'a1', attempt: 2, maxRetries: 5, retryDelayMs: 60000, errorStatus: 429, errorCategory: 'rate_limit' },
    } as never)
    expect(patch.taskProgress?.t1.retry).toEqual({ agentId: 'a1', attempt: 2, maxRetries: 5, retryDelayMs: 60000, errorStatus: 429, errorCategory: 'rate_limit' })
  })

  it('clears a prior retry once a plain progress tick arrives', () => {
    const session = createDefaultPerSessionState()
    session.taskProgress = { t1: { description: 'sub', totalTokens: 0, toolUses: 0, durationMs: 0, toolHistory: [], retry: { agentId: 'a1', attempt: 2, maxRetries: 5, retryDelayMs: 60000, errorStatus: 429, errorCategory: 'rate_limit' } } }
    session.messages = [makeAssistant('m1', [toolUseBlock('t1', 'Task')])]
    const patch = reduceTool(session, {
      type: 'tool_progress', messageId: 'm1', toolUseId: 't1', elapsedSeconds: 3,
    } as never)
    expect(patch.taskProgress?.t1.retry).toBeUndefined()
  })

  it('does not create a taskProgress entry for a non-subagent tool tick', () => {
    const session = createDefaultPerSessionState()
    session.messages = [makeAssistant('m1', [toolUseBlock('t1', 'BashTool')])]
    const patch = reduceTool(session, {
      type: 'tool_progress', messageId: 'm1', toolUseId: 't1', elapsedSeconds: 3,
    } as never)
    expect(patch.taskProgress).toBeUndefined()
  })
})

describe('reduceTool: task_progress identity share', () => {
  it('preserves non-home message refs when patching an Agent block', () => {
    const otherMsg = makeAssistant('m0', [toolUseBlock('other', 'Read')])
    const homeMsg = makeAssistant('m1', [toolUseBlock('agent-1', 'Agent')])
    const session = createDefaultPerSessionState()
    session.messages = [otherMsg, homeMsg]
    session.taskProgress = {
      'agent-1': { description: 'sub', totalTokens: 0, toolUses: 0, durationMs: 0, toolHistory: [] },
    }

    const patch = reduceTool(session, {
      type: 'task_progress',
      toolUseId: 'agent-1',
      description: 'reading files',
      lastToolName: 'Read',
      usage: { totalTokens: 42, toolUses: 3, durationMs: 900 },
    } as never)

    expect(patch.messages?.[0]).toBe(otherMsg)
    expect(patch.messages?.[0].content[0]).toBe(otherMsg.content[0])
    expect(patch.messages?.[1]).not.toBe(homeMsg)
    const agent = patch.messages?.[1].content[0] as { taskUsage?: { totalTokens: number }; taskSummary?: string }
    expect(agent.taskUsage?.totalTokens).toBe(42)
  })
})

describe('reduceTool: task_notification identity share', () => {
  it('preserves non-home message refs and patches Agent + optional tool_result', () => {
    const otherMsg = makeAssistant('m0', [toolUseBlock('other', 'Bash')])
    const homeBlocks = [
      toolUseBlock('agent-1', 'Agent'),
      { type: 'tool_result', toolUseId: 'agent-1', summary: 'done' } as ContentBlock,
    ]
    const homeMsg = makeAssistant('m1', homeBlocks)
    const session = createDefaultPerSessionState()
    session.messages = [otherMsg, homeMsg]
    session.taskProgress = {
      'agent-1': { description: 'sub', totalTokens: 1, toolUses: 1, durationMs: 10, toolHistory: [], taskId: 'task-1' },
    }

    const patch = reduceTool(session, {
      type: 'task_notification',
      toolUseId: 'agent-1',
      taskId: 'task-1',
      taskStatus: 'completed',
      summary: 'finished',
      outputFile: '/tmp/out.jsonl',
      usage: { totalTokens: 99, toolUses: 5, durationMs: 1200 },
    } as never)

    expect(patch.messages?.[0]).toBe(otherMsg)
    expect(patch.messages?.[1]).not.toBe(homeMsg)
    const agent = patch.messages?.[1].content[0] as { taskSummary?: string; taskUsage?: { totalTokens: number } }
    const result = patch.messages?.[1].content[1] as { outputPath?: string }
    expect(agent.taskSummary).toBe('finished')
    expect(agent.taskUsage?.totalTokens).toBe(99)
    expect(result.outputPath).toBe('/tmp/out.jsonl')
  })

  /**
   * dsh learns a failed delegation's provider diagnostic only AFTER the run has
   * already closed the Task block — `subagent/end` carries no diagnostic and the
   * tool rejects afterwards — so it necessarily arrives as a second, sparse
   * notification. It has to merge onto the entry that already exists rather than
   * blanking the usage and summary the first one established.
   */
  it('merges a later diagnostic-only notification without losing what was shown', () => {
    const homeMsg = makeAssistant('m1', [toolUseBlock('agent-1', 'Agent')])
    const session = createDefaultPerSessionState()
    session.messages = [homeMsg]
    session.taskProgress = {
      'agent-1': { description: 'sub', totalTokens: 1, toolUses: 1, durationMs: 10, toolHistory: [], taskId: 'task-1' },
    }

    const first = reduceTool(session, {
      type: 'task_notification',
      toolUseId: 'agent-1',
      taskId: 'task-1',
      taskStatus: 'failed',
      summary: 'delegation failed',
      outputFile: '',
      usage: { totalTokens: 99, toolUses: 5, durationMs: 1200 },
    } as never)
    Object.assign(session, first)

    const second = reduceTool(session, {
      type: 'task_notification',
      toolUseId: 'agent-1',
      taskId: 'task-1',
      taskStatus: 'failed',
      outputFile: '',
      diagnostic: 'provider returned HTTP 503 after 5 attempts',
    } as never)

    const progress = second.taskProgress?.['agent-1']
    expect(progress?.diagnostic).toBe('provider returned HTTP 503 after 5 attempts')
    // Everything the first notification established survives the merge.
    expect(progress?.status).toBe('failed')
    expect(progress?.summary).toBe('delegation failed')
    expect(progress?.totalTokens).toBe(99)
  })
})

describe('reduceTool: browser_download_update identity share', () => {
  it('preserves non-target message refs when patching a download tool_result', () => {
    const otherMsg = makeAssistant('m0', [toolUseBlock('t0', 'Read')])
    const summary = JSON.stringify({ taskId: 'bdl_1', status: 'progressing' })
    const targetBlock = { type: 'tool_result', toolUseId: 'tu-dl', summary } as ContentBlock
    const targetMsg = makeAssistant('m1', [targetBlock])
    const session = createDefaultPerSessionState()
    session.messages = [otherMsg, targetMsg]

    const patch = reduceTool(session, {
      type: 'browser_download_update',
      taskId: 'bdl_1',
      status: 'completed',
      path: '/tmp/file.bin',
      filename: 'file.bin',
      bytes: 12,
    } as never)

    expect(patch.messages?.[0]).toBe(otherMsg)
    expect(patch.messages?.[0].content[0]).toBe(otherMsg.content[0])
    expect(patch.messages?.[1]).not.toBe(targetMsg)
    const nextSummary = JSON.parse((patch.messages?.[1].content[0] as { summary: string }).summary) as {
      status: string
      path?: string
    }
    expect(nextSummary.status).toBe('completed')
    expect(nextSummary.path).toBe('/tmp/file.bin')
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

  it('is a no-op when both toolUseId and taskId are missing', () => {
    expect(reduceTool(createDefaultPerSessionState(), {
      type: 'task_started', description: 'x',
    } as never)).toEqual({})
  })

  it('stores under provisional taskId when toolUseId is missing', () => {
    const session = createDefaultPerSessionState()
    const patch = reduceTool(session, {
      type: 'task_started', taskId: 'wf_1', description: 'review',
    } as never)
    expect(patch.taskProgress?.['wf_1']).toMatchObject({ taskId: 'wf_1', description: 'review', completed: false })
  })

  it('stores taskId so the UI can stop the task manually', () => {
    const session = createDefaultPerSessionState()
    const patch = reduceTool(session, {
      type: 'task_started', toolUseId: 'tu-1', taskId: 'bg-task-9', description: 'dev server',
    } as never)
    expect(patch.taskProgress?.['tu-1']).toMatchObject({ taskId: 'bg-task-9', description: 'dev server' })
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

  it('merges chronological toolEntries into toolHistory', () => {
    const session = createDefaultPerSessionState()
    session.taskProgress = {
      'task-1': { description: 'sa1', totalTokens: 0, toolUses: 0, durationMs: 0, toolHistory: [] },
    }
    const patch = reduceTool(session, {
      type: 'task_progress',
      toolUseId: 'task-1',
      taskId: 'sa1',
      description: 'grep',
      lastToolName: 'grep',
      usage: { totalTokens: 40, toolUses: 2, durationMs: 100 },
      toolEntries: [
        { toolName: 'read_file', description: '' },
        { toolName: 'grep', description: '' },
      ],
      outputFile: '/tmp/child/chat_history.jsonl',
    } as never)
    expect(patch.taskProgress?.['task-1'].toolHistory).toEqual([
      { toolName: 'read_file', description: '' },
      { toolName: 'grep', description: '' },
    ])
    expect(patch.taskProgress?.['task-1'].outputFile).toBe('/tmp/child/chat_history.jsonl')
  })

  it('stores Grok chat_history path without inventing toolHistory from lastToolName alone', () => {
    const session = createDefaultPerSessionState()
    session.taskProgress = {
      'task-1': { description: 'read_file', lastToolName: 'read_file', totalTokens: 10, toolUses: 1, durationMs: 50, toolHistory: [] },
    }
    const patch = reduceTool(session, {
      type: 'task_progress',
      toolUseId: 'task-1',
      taskId: 'sa1',
      description: 'grep',
      lastToolName: 'grep',
      usage: { totalTokens: 40, toolUses: 12, durationMs: 100 },
      outputFile: '/home/u/.grok/sessions/%2Fproj/sa1/chat_history.jsonl',
    } as never)
    // With transcript path, do not invent sparse rows from description transitions.
    expect(patch.taskProgress?.['task-1'].toolHistory).toEqual([])
    expect(patch.taskProgress?.['task-1'].outputFile).toContain('chat_history.jsonl')
    expect(patch.taskProgress?.['task-1'].toolUses).toBe(12)
  })

  it('persists taskOutputFile on Agent tool_use so history reload can recover transcript path', () => {
    const session = createDefaultPerSessionState()
    session.messages = [
      makeAssistant('m1', [
        { type: 'tool_use', toolUseId: 'agent-1', toolName: 'Agent', input: '{}' } as ContentBlock,
        { type: 'tool_result', toolUseId: 'agent-1', summary: 'started' } as ContentBlock,
      ]),
    ]
    session.taskProgress = {
      'agent-1': { description: 'sa', totalTokens: 0, toolUses: 0, durationMs: 0, toolHistory: [], taskId: 'sa1' },
    }
    const path = '/home/u/.grok/sessions/%2Fproj/sa1/chat_history.jsonl'
    const progressPatch = reduceTool(session, {
      type: 'task_progress',
      toolUseId: 'agent-1',
      taskId: 'sa1',
      description: 'sa1',
      usage: { totalTokens: 10, toolUses: 2, durationMs: 100 },
      outputFile: path,
    } as never)
    const agentAfterProgress = progressPatch.messages?.[0].content[0] as { taskOutputFile?: string }
    expect(agentAfterProgress.taskOutputFile).toBe(path)

    const nextSession = { ...session, messages: progressPatch.messages!, taskProgress: progressPatch.taskProgress! }
    const donePatch = reduceTool(nextSession, {
      type: 'task_notification',
      toolUseId: 'agent-1',
      taskId: 'sa1',
      taskStatus: 'completed',
      outputFile: path,
      usage: { totalTokens: 20, toolUses: 3, durationMs: 200 },
      resultText: 'done',
    } as never)
    const agentDone = donePatch.messages?.[0].content[0] as { taskOutputFile?: string; taskResultText?: string }
    const resultDone = donePatch.messages?.[0].content[1] as { outputPath?: string }
    expect(agentDone.taskOutputFile).toBe(path)
    expect(agentDone.taskResultText).toBe('done')
    expect(resultDone.outputPath).toBe(path)
  })

  it('allows the same tool to reappear after another tool in toolEntries snapshots', () => {
    const session = createDefaultPerSessionState()
    session.taskProgress = {
      'task-1': {
        description: 'grep',
        totalTokens: 10,
        toolUses: 2,
        durationMs: 50,
        toolHistory: [
          { toolName: 'read_file', description: '' },
          { toolName: 'grep', description: '' },
        ],
      },
    }
    const patch = reduceTool(session, {
      type: 'task_progress',
      toolUseId: 'task-1',
      taskId: 'sa1',
      description: 'read_file',
      lastToolName: 'read_file',
      usage: { totalTokens: 40, toolUses: 3, durationMs: 100 },
      toolEntries: [
        { toolName: 'read_file', description: '' },
        { toolName: 'grep', description: '' },
        { toolName: 'read_file', description: '' },
      ],
    } as never)
    expect(patch.taskProgress?.['task-1'].toolHistory).toEqual([
      { toolName: 'read_file', description: '' },
      { toolName: 'grep', description: '' },
      { toolName: 'read_file', description: '' },
    ])
  })

  it('is a no-op when both toolUseId and taskId are missing', () => {
    expect(reduceTool(createDefaultPerSessionState(), {
      type: 'task_progress', description: 'x', usage: { totalTokens: 0, toolUses: 0, durationMs: 0 },
    } as never)).toEqual({})
  })

  it('migrates provisional taskId key to toolUseId and stores workflowAgents', () => {
    const session = createDefaultPerSessionState()
    session.messages = [
      makeAssistant('m1', [
        { type: 'tool_use', toolUseId: 'tu_wf', toolName: 'Workflow', input: '{}' } as ContentBlock,
      ]),
    ]
    session.taskProgress = {
      wf_1: { description: 'r', taskId: 'wf_1', totalTokens: 0, toolUses: 0, durationMs: 0, toolHistory: [] },
    }
    const patch = reduceTool(session, {
      type: 'task_progress',
      taskId: 'wf_1',
      toolUseId: 'tu_wf',
      description: 'r: o',
      summary: 'phase: Execute',
      usage: { totalTokens: 50, toolUses: 1, durationMs: 1000 },
      workflowAgents: [{ agentId: 'a1', label: 'Explore', toolCount: 0, tokens: 50, state: 'running' }],
      workflowPhases: [{ title: 'Plan', state: 'done' }, { title: 'Execute', state: 'active' }],
      currentPhase: 'Execute',
    } as never)
    expect(patch.taskProgress?.['tu_wf']).toMatchObject({
      taskId: 'wf_1',
      summary: 'phase: Execute',
      currentPhase: 'Execute',
      workflowAgents: [{ label: 'Explore', state: 'running' }],
    })
    expect(patch.taskProgress?.['wf_1']).toBeUndefined()
    const block = patch.messages?.[0].content[0] as { taskSummary?: string; workflowAgents?: unknown[]; workflowCurrentPhase?: string }
    expect(block.taskSummary).toBe('phase: Execute')
    expect(block.workflowCurrentPhase).toBe('Execute')
    expect(block.workflowAgents?.[0]).toMatchObject({ label: 'Explore' })
  })
})

describe('reduceTool: foreign taskId must not complete a workflow launch key', () => {
  it('writes a subagent finish under its own taskId, leaving the workflow entry running', () => {
    const session = createDefaultPerSessionState()
    session.messages = [
      makeAssistant('m1', [
        { type: 'tool_use', toolUseId: 'task-1', toolName: 'Workflow', input: '{}' } as ContentBlock,
      ]),
    ]
    // First: workflow progress under launch tool key.
    const progressPatch = reduceTool(session, {
      type: 'task_progress',
      toolUseId: 'task-1',
      taskId: 'wf_run',
      description: 'workflow',
      usage: { totalTokens: 1, toolUses: 0, durationMs: 10 },
    } as never)
    const withProgress = {
      ...session,
      taskProgress: { ...session.taskProgress, ...progressPatch.taskProgress },
    }
    // Hijack attempt: child finishes with parent toolUseId + different taskId.
    const donePatch = reduceTool(withProgress, {
      type: 'task_notification',
      toolUseId: 'task-1',
      taskId: 'child-agent',
      taskStatus: 'completed',
      outputFile: '',
      summary: 'child done',
    } as never)
    const progress = { ...withProgress.taskProgress, ...donePatch.taskProgress }
    expect(progress['task-1']?.completed).not.toBe(true)
    expect(progress['task-1']?.taskId).toBe('wf_run')
    expect(progress['child-agent']?.completed).toBe(true)
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

  it('is a no-op when both toolUseId and taskId are missing', () => {
    expect(reduceTool(createDefaultPerSessionState(), {
      type: 'task_notification',
    } as never)).toEqual({})
  })

  it('completes a provisional taskId entry and preserves prior agents', () => {
    const session = createDefaultPerSessionState()
    session.taskProgress = {
      wf_1: {
        description: 'r',
        taskId: 'wf_1',
        totalTokens: 10,
        toolUses: 1,
        durationMs: 100,
        toolHistory: [],
        workflowAgents: [{ agentId: 'a1', label: 'Explore', toolCount: 0, tokens: 10 }],
      },
    }
    const patch = reduceTool(session, {
      type: 'task_notification',
      taskId: 'wf_1',
      taskStatus: 'completed',
      outputFile: '',
      summary: 'done',
      resultText: 'All good',
    } as never)
    expect(patch.taskProgress?.['wf_1']).toMatchObject({
      completed: true,
      status: 'completed',
      resultText: 'All good',
      workflowAgents: [{ label: 'Explore' }],
    })
  })

  it('keeps established Agent key on resume waker notification (no migrate to waker)', () => {
    const session = createDefaultPerSessionState()
    session.messages = [
      makeAssistant('m1', [
        { type: 'tool_use', toolUseId: 'agent-original', toolName: 'Agent', input: '' } as ContentBlock,
        { type: 'tool_result', toolUseId: 'agent-original', summary: '' } as ContentBlock,
      ]),
    ]
    session.taskProgress = {
      'agent-original': {
        description: 'search',
        taskId: 'T1',
        totalTokens: 10,
        toolUses: 1,
        durationMs: 100,
        toolHistory: [],
      },
    }
    const patch = reduceTool(session, {
      type: 'task_notification',
      toolUseId: 'waker',
      taskId: 'T1',
      taskStatus: 'completed',
      outputFile: '/out.log',
      summary: 'resumed done',
      usage: { totalTokens: 99, toolUses: 3, durationMs: 500 },
    } as never)
    expect(patch.taskProgress?.['agent-original']).toMatchObject({
      completed: true,
      status: 'completed',
      summary: 'resumed done',
      taskId: 'T1',
    })
    expect(patch.taskProgress?.['waker']).toBeUndefined()
    const agentBlock = patch.messages?.[0].content[0] as { taskSummary?: string; taskUsage?: { totalTokens: number } }
    expect(agentBlock.taskSummary).toBe('resumed done')
    expect(agentBlock.taskUsage?.totalTokens).toBe(99)
    const resultBlock = patch.messages?.[0].content[1] as { outputPath?: string }
    expect(resultBlock.outputPath).toBe('/out.log')
  })

  it('migrates provisional workflow key to launch toolUseId on terminal and patches Workflow block', () => {
    const session = createDefaultPerSessionState()
    session.messages = [
      makeAssistant('m1', [
        { type: 'tool_use', toolUseId: 'tc_wf', toolName: 'Workflow', input: '{}' } as ContentBlock,
      ]),
    ]
    session.taskProgress = {
      wf_1: {
        description: 'review',
        taskId: 'wf_1',
        totalTokens: 5,
        toolUses: 1,
        durationMs: 50,
        toolHistory: [],
        workflowAgents: [{ agentId: 'a1', label: 'Explore', toolCount: 0 }],
      },
    }
    const patch = reduceTool(session, {
      type: 'task_notification',
      toolUseId: 'tc_wf',
      taskId: 'wf_1',
      taskStatus: 'completed',
      outputFile: '',
      summary: 'done',
      resultText: 'All good',
    } as never)
    expect(patch.taskProgress?.['tc_wf']).toMatchObject({
      completed: true,
      taskId: 'wf_1',
      resultText: 'All good',
      workflowAgents: [{ label: 'Explore' }],
    })
    expect(patch.taskProgress?.['wf_1']).toBeUndefined()
    const wf = patch.messages?.[0].content[0] as { taskSummary?: string; taskResultText?: string }
    expect(wf.taskSummary).toBe('done')
    expect(wf.taskResultText).toBe('All good')
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
