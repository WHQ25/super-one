/** @vitest-environment jsdom */

import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi, beforeEach } from 'vitest'

const hoisted = vi.hoisted(() => ({
  sessionState: {
    messages: [] as Array<{ role: string; content: unknown[] }>,
    subagentTokens: {} as Record<string, { input: number; output: number }>,
    subagentColors: {} as Record<string, number>,
    taskProgress: {} as Record<string, unknown>,
    status: 'idle' as 'idle' | 'streaming',
  },
  remoteDetails: {} as Record<string, unknown>,
  bashOutput: undefined as { outputPath: string; content: string; finished: boolean } | undefined,
}))

vi.mock('@superone/chat-view/use-deferred-tool-detail', () => ({
  useDeferredToolDetail: (remoteDetail: string | undefined, expanded: boolean) => ({
    detail: remoteDetail && expanded ? hoisted.remoteDetails[remoteDetail] ?? {} : {},
  }),
  DeferredDetailStatus: () => null,
}))

vi.mock('@/stores/chat', () => ({
  useActiveSession: (selector: (s: typeof hoisted.sessionState) => unknown) => selector(hoisted.sessionState),
  useChatStore: Object.assign((selector: (s: unknown) => unknown) => selector({}), {
    setState: vi.fn(),
    getState: () => ({}),
  }),
  useBashOutput: () => hoisted.bashOutput,
}))

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string, fallback?: string) => fallback ?? key }),
}))

vi.mock('streamdown', () => ({
  Streamdown: ({ children }: { children?: React.ReactNode }) => <div data-testid="streamdown">{children}</div>,
}))

vi.mock('./chat-shared', () => ({
  streamdownPlugins: [],
  streamdownRehypePlugins: [],
  streamdownControls: {},
  streamdownComponents: {},
  streamdownLinkSafety: {},
  formatTokens: (n: number) => String(n),
}))

vi.mock('./ToolBlock', () => ({
  ToolBlock: (props: { toolName: string; remoteDetail?: string; status?: string; isError?: boolean; isTimedOut?: boolean }) => (
    <div
      data-testid="tool-block"
      data-tool={props.toolName}
      data-remote-detail={props.remoteDetail}
      data-status={props.status}
      data-error={String(!!props.isError)}
      data-timeout={String(!!props.isTimedOut)}
    />
  ),
}))

import { SubagentFullView } from './SubagentFullView'

function taskInput(extra: Record<string, unknown>): string {
  return JSON.stringify({ prompt: 'do the work', ...extra })
}

beforeEach(() => {
  hoisted.sessionState = { messages: [], subagentTokens: {}, subagentColors: {}, taskProgress: {}, status: 'idle' }
  hoisted.remoteDetails = {}
  hoisted.bashOutput = undefined
})

describe('SubagentFullView', () => {
  it('surfaces error status of a failed child tool in a sync subagent', () => {
    hoisted.sessionState.messages = [{
      role: 'assistant',
      content: [
        { type: 'tool_use', toolUseId: 'task-1', toolName: 'Agent', input: taskInput({ subagent_type: 'reviewer', description: 'Review code' }) },
        { type: 'tool_use', toolUseId: 'child-1', toolName: 'Read', input: '{}', parentToolUseId: 'task-1', status: 'complete' },
        { type: 'tool_result', toolUseId: 'child-1', summary: 'file not found', isError: true, parentToolUseId: 'task-1' },
        { type: 'tool_result', toolUseId: 'task-1', summary: 'review done' },
      ],
    }]

    render(<SubagentFullView view={{ toolUseId: 'task-1' }} />)

    const tool = screen.getByTestId('tool-block')
    expect(tool.getAttribute('data-tool')).toBe('Read')
    expect(tool.getAttribute('data-error')).toBe('true')
  })

  it('surfaces timeout status of a child tool in a sync subagent', () => {
    hoisted.sessionState.messages = [{
      role: 'assistant',
      content: [
        { type: 'tool_use', toolUseId: 'task-1', toolName: 'Agent', input: taskInput({ subagent_type: 'reviewer', description: 'Review code' }) },
        { type: 'tool_use', toolUseId: 'child-1', toolName: 'Bash', input: '{}', parentToolUseId: 'task-1', status: 'complete' },
        { type: 'tool_result', toolUseId: 'child-1', summary: 'timed out', isTimedOut: true, parentToolUseId: 'task-1' },
        { type: 'tool_result', toolUseId: 'task-1', summary: 'done' },
      ],
    }]

    render(<SubagentFullView view={{ toolUseId: 'task-1' }} />)

    expect(screen.getByTestId('tool-block').getAttribute('data-timeout')).toBe('true')
  })

  it('collapses a finished child thinking block into a reasoning row, like the main chat', () => {
    hoisted.sessionState.messages = [{
      role: 'assistant',
      content: [
        { type: 'tool_use', toolUseId: 'task-1', toolName: 'Agent', input: taskInput({ subagent_type: 'reviewer', description: 'Review code' }) },
        { type: 'thinking', thinking: 'private chain of thought', parentToolUseId: 'task-1' },
        { type: 'tool_result', toolUseId: 'task-1', summary: 'done' },
      ],
    }]

    render(<SubagentFullView view={{ toolUseId: 'task-1' }} />)

    expect(screen.getByText('chat.reasoning.thought')).toBeTruthy()
    expect(screen.queryByText('private chain of thought')).toBeNull()
    fireEvent.click(screen.getByText('chat.reasoning.thought'))
    expect(screen.getByText('private chain of thought')).toBeTruthy()
  })

  it('renders tool calls for an async (background) subagent from progress history', () => {
    hoisted.sessionState.messages = [{
      role: 'assistant',
      content: [
        { type: 'tool_use', toolUseId: 'task-1', toolName: 'Agent', input: taskInput({ subagent_type: 'worker', description: 'Background job', run_in_background: true }) },
        { type: 'tool_result', toolUseId: 'task-1', summary: 'started in background' },
      ],
    }]
    hoisted.sessionState.taskProgress = {
      'task-1': {
        description: '',
        totalTokens: 120,
        toolUses: 2,
        durationMs: 0,
        completed: true,
        toolHistory: [
          { toolName: 'Read', description: 'index.ts' },
          { toolName: 'Grep', description: 'pattern' },
        ],
      },
    }

    render(<SubagentFullView view={{ toolUseId: 'task-1' }} />)

    expect(screen.getByText('Read')).toBeInTheDocument()
    expect(screen.getByText('Grep')).toBeInTheDocument()
  })

  it('renders tool calls for a nested non-async subagent whose tools ran in its own session', () => {
    // run_in_background:false, NO inline child blocks (tools executed in a separate
    // session), activity only in task_progress. The full view must still surface them.
    hoisted.sessionState.messages = [{
      role: 'assistant',
      content: [
        { type: 'tool_use', toolUseId: 'parent-1', toolName: 'Agent', input: taskInput({ subagent_type: 'general-purpose', description: 'Deep research' }) },
        { type: 'tool_use', toolUseId: 'nested-1', toolName: 'Agent', input: taskInput({ subagent_type: 'general-purpose', description: 'Search angle 1', run_in_background: false }), parentToolUseId: 'parent-1' },
        { type: 'tool_result', toolUseId: 'nested-1', summary: 'found 5 stories', parentToolUseId: 'parent-1' },
      ],
    }]
    hoisted.sessionState.taskProgress = {
      'nested-1': {
        description: '', totalTokens: 1200, toolUses: 2, durationMs: 5000, completed: true,
        toolHistory: [
          { toolName: 'ToolSearch', description: 'find search tool' },
          { toolName: 'WebSearch', description: 'AI model releases June 2026' },
        ],
      },
    }

    render(<SubagentFullView view={{ toolUseId: 'nested-1' }} />)

    expect(screen.getByText('WebSearch')).toBeInTheDocument()
    expect(screen.queryByText('SearchTools')).not.toBeInTheDocument()
  })

  it('shows a nested agent\'s tool calls from the persisted block on history reload (empty live store)', () => {
    // Live taskProgress is gone after reload; tool history persists on the block.
    hoisted.sessionState.messages = [{
      role: 'assistant',
      content: [
        { type: 'tool_use', toolUseId: 'parent-1', toolName: 'Agent', input: taskInput({ subagent_type: 'general-purpose', description: 'Deep research' }) },
        {
          type: 'tool_use', toolUseId: 'nested-1', toolName: 'Agent', parentToolUseId: 'parent-1',
          input: taskInput({ subagent_type: 'general-purpose', description: 'Search angle 1', run_in_background: false }),
          taskToolHistory: [
            { toolName: 'ToolSearch', description: 'find search tool' },
            { toolName: 'WebSearch', description: 'AI model releases June 2026' },
          ],
          taskUsage: { totalTokens: 1200, toolUses: 2, durationMs: 5000 },
        },
        { type: 'tool_result', toolUseId: 'nested-1', summary: 'found 5 stories', parentToolUseId: 'parent-1' },
      ],
    }]
    hoisted.sessionState.taskProgress = {}

    render(<SubagentFullView view={{ toolUseId: 'nested-1' }} />)

    expect(screen.getByText('WebSearch')).toBeInTheDocument()
    expect(screen.queryByText('SearchTools')).not.toBeInTheDocument()
  })

  it('loads a summarized remote card\'s children from its detail', () => {
    // A remote node sends the card as a shell; prompt and children sit behind remoteDetail.
    hoisted.sessionState.messages = [{
      role: 'assistant',
      content: [
        { type: 'tool_use', toolUseId: 'task-1', toolName: 'Agent', input: '{}', remoteDetail: 'detail-task-1' },
        { type: 'tool_result', toolUseId: 'task-1', summary: '' },
      ],
    }]
    hoisted.remoteDetails = {
      'detail-task-1': {
        input: taskInput({ subagent_type: 'reviewer', description: 'Review code' }),
        result: 'review done',
        childBlocks: [
          { type: 'tool_use', toolUseId: 'child-1', toolName: 'Read', input: '{}', parentToolUseId: 'task-1', status: 'complete', remoteDetail: 'detail-child-1' },
          { type: 'tool_use', toolUseId: 'child-2', toolName: 'Grep', input: '{}', parentToolUseId: 'task-1', status: 'complete', remoteDetail: 'detail-child-2' },
        ],
      },
    }

    render(<SubagentFullView view={{ toolUseId: 'task-1' }} />)

    const tools = screen.getAllByTestId('tool-block')
    expect(tools.map((el) => el.getAttribute('data-tool'))).toEqual(['Read', 'Grep'])
    expect(tools[0].getAttribute('data-remote-detail')).toBe('detail-child-1')
    expect(screen.getByText('do the work')).toBeInTheDocument()
    expect(screen.getByText('review done')).toBeInTheDocument()
  })

  it('treats a background agent with a terminal task status as finished without its result text', () => {
    // A remote task_notification arrives without resultText; only taskStatus lands on the block.
    hoisted.sessionState.messages = [{
      role: 'assistant',
      content: [
        { type: 'tool_use', toolUseId: 'task-1', toolName: 'Agent', input: taskInput({ description: 'Background job', run_in_background: true }), taskStatus: 'completed' },
        { type: 'tool_result', toolUseId: 'task-1', summary: 'started in background' },
      ],
    }]

    const { container } = render(<SubagentFullView view={{ toolUseId: 'task-1' }} />)

    expect(container.querySelector('.animate-spin')).toBeNull()
    expect(screen.getByText('No activity recorded')).toBeInTheDocument()
  })

  it('marks finished async tool entries as complete while the subagent is still running', () => {
    hoisted.sessionState.status = 'streaming'
    hoisted.sessionState.messages = [{
      role: 'assistant',
      content: [
        { type: 'tool_use', toolUseId: 'task-1', toolName: 'Agent', input: taskInput({ description: 'Research', run_in_background: true }) },
        { type: 'tool_result', toolUseId: 'task-1', summary: '{"subagent_id":"sub-1","output_file":"/tmp/sub-1/transcript.jsonl"}', outputPath: '/tmp/sub-1/transcript.jsonl' },
      ],
    }]
    hoisted.bashOutput = {
      outputPath: '/tmp/sub-1/transcript.jsonl',
      finished: false,
      content: [
        JSON.stringify({
          step_index: 1,
          type: 'PLANNER_RESPONSE',
          status: 'DONE',
          tool_calls: [{ id: 'tc-1', name: 'read_file', args: { Path: '/tmp/a.ts' } }],
        }),
        JSON.stringify({
          step_index: 2,
          type: 'GENERIC',
          status: 'DONE',
          content: 'file contents',
        }),
        JSON.stringify({
          step_index: 3,
          type: 'PLANNER_RESPONSE',
          status: 'DONE',
          tool_calls: [{ id: 'tc-2', name: 'grep_search', args: { Query: 'foo' } }],
        }),
      ].join('\n'),
    }

    render(<SubagentFullView view={{ toolUseId: 'task-1' }} />)

    const tools = screen.getAllByTestId('tool-block')
    expect(tools).toHaveLength(2)
    expect(tools[0].getAttribute('data-tool')).toBe('Read')
    expect(tools[0].getAttribute('data-status')).toBe('complete')
    expect(tools[1].getAttribute('data-tool')).toBe('Grep')
    expect(tools[1].getAttribute('data-status')).toBe('streaming')
    hoisted.bashOutput = undefined
    hoisted.sessionState.status = 'idle'
  })
})
