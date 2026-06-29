/** @vitest-environment jsdom */

import { render, screen } from '@testing-library/react'
import { describe, expect, it, vi, beforeEach } from 'vitest'
import type { ContentBlock } from '@superone/shared/agent-types'

const hoisted = vi.hoisted(() => ({
  sessionState: {
    subagentTokens: {} as Record<string, { input: number; output: number }>,
    subagentColors: {} as Record<string, number>,
    taskProgress: {} as Record<string, unknown>,
  },
  jsonl: { entries: [] as unknown[], resultText: undefined as string | undefined },
}))

vi.mock('@/stores/chat', () => ({
  useActiveSession: (selector: (s: typeof hoisted.sessionState) => unknown) => selector(hoisted.sessionState),
  useChatStore: Object.assign((selector: (s: unknown) => unknown) => selector({}), {
    setState: vi.fn(),
    getState: () => ({ assignSubagentColor: vi.fn() }),
  }),
}))

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string, fallback?: string) => fallback ?? key }),
}))

vi.mock('./use-subagent-jsonl', () => ({ useSubagentJsonl: () => hoisted.jsonl }))
vi.mock('./subagent-navigation-context', () => ({ useSubagentNavigation: () => ({ open: vi.fn() }) }))

vi.mock('./ToolBlock', () => ({
  ToolBlock: (props: { toolName: string }) => <div data-testid="tool-block" data-tool={props.toolName}>{props.toolName}</div>,
}))

vi.mock('streamdown', () => ({ Streamdown: ({ children }: { children?: React.ReactNode }) => <div>{children}</div> }))

vi.mock('./chat-shared', () => ({
  streamdownPlugins: [], streamdownRehypePlugins: [], streamdownControls: {},
  streamdownComponents: {}, streamdownLinkSafety: {}, formatTokens: (n: number) => String(n),
}))

import { SubagentBlock } from './SubagentBlock'

function agentBlock(toolUseId: string, runInBackground: boolean, extra: Record<string, unknown> = {}): ContentBlock & { type: 'tool_use' } {
  return {
    type: 'tool_use', toolUseId, toolName: 'Agent',
    input: JSON.stringify({ subagent_type: 'general-purpose', description: 'Search angle 1', prompt: 'search', run_in_background: runInBackground }),
    ...extra,
  } as ContentBlock & { type: 'tool_use' }
}

beforeEach(() => {
  hoisted.sessionState = { subagentTokens: {}, subagentColors: {}, taskProgress: {} }
  hoisted.jsonl = { entries: [], resultText: undefined }
})

describe('SubagentBlock activity surface', () => {
  it('shows tool calls from task_progress when a nested non-async agent has no inline childBlocks', () => {
    // Workflow-spawned parallel agent: run_in_background:false, tools ran in its own
    // session, activity only in task_progress. Must still surface its tool calls.
    hoisted.sessionState.taskProgress = {
      'toolu_nested': {
        description: 'searching', lastToolName: 'WebSearch', totalTokens: 1200, toolUses: 2, durationMs: 5000,
        toolHistory: [
          { toolName: 'ToolSearch', description: 'find search tool' },
          { toolName: 'WebSearch', description: 'AI model releases' },
        ],
      },
    }
    render(
      <SubagentBlock
        taskBlock={agentBlock('toolu_nested', false)}
        childBlocks={[]}
        resultBlock={{ type: 'tool_result', toolUseId: 'toolu_nested', summary: 'found 5 stories' } as ContentBlock}
        isStreaming={false}
        defaultExpanded
      />,
    )
    expect(screen.getByText('WebSearch')).toBeInTheDocument()
    expect(screen.getByText('ToolSearch')).toBeInTheDocument()
  })

  it('shows tool calls from the persisted block on history reload (empty live store)', () => {
    // After a restart/history reload the live taskProgress map is empty; the tool
    // history survives on the Agent block (taskToolHistory). Must still render.
    hoisted.sessionState.taskProgress = {}
    render(
      <SubagentBlock
        taskBlock={agentBlock('toolu_nested', false, {
          taskToolHistory: [
            { toolName: 'ToolSearch', description: 'find search tool' },
            { toolName: 'WebSearch', description: 'AI model releases' },
          ],
          taskUsage: { totalTokens: 1200, toolUses: 2, durationMs: 5000 },
          taskResultText: 'found 5 stories',
        })}
        childBlocks={[]}
        resultBlock={{ type: 'tool_result', toolUseId: 'toolu_nested', summary: 'found 5 stories' } as ContentBlock}
        isStreaming={false}
        defaultExpanded
      />,
    )
    expect(screen.getByText('WebSearch')).toBeInTheDocument()
    expect(screen.getByText('ToolSearch')).toBeInTheDocument()
  })

  it('renders as running when taskProgress is active, even though the tool_result arrived and the turn is idle', () => {
    // A background agent returns its "started" tool_result immediately and the main
    // turn goes idle; its input has no run_in_background flag. taskProgress is the
    // authoritative running signal, so it must read as running, not done.
    hoisted.sessionState.taskProgress = {
      'toolu_bg': { description: 'researching', completed: false, totalTokens: 0, toolUses: 0, durationMs: 0, toolHistory: [] },
    }
    render(
      <SubagentBlock
        taskBlock={agentBlock('toolu_bg', false)}
        childBlocks={[]}
        resultBlock={{ type: 'tool_result', toolUseId: 'toolu_bg', summary: 'started' } as ContentBlock}
        isStreaming={false}
        defaultExpanded
      />,
    )
    expect(screen.getByText('chat.subagent.running')).toBeInTheDocument()
    expect(screen.queryByText('chat.subagent.done')).not.toBeInTheDocument()
  })

  it('renders as done once taskProgress is completed', () => {
    hoisted.sessionState.taskProgress = {
      'toolu_bg': { description: 'researching', completed: true, status: 'completed', totalTokens: 0, toolUses: 0, durationMs: 0, toolHistory: [] },
    }
    render(
      <SubagentBlock
        taskBlock={agentBlock('toolu_bg', false)}
        childBlocks={[]}
        resultBlock={{ type: 'tool_result', toolUseId: 'toolu_bg', summary: 'done' } as ContentBlock}
        isStreaming={false}
        defaultExpanded
      />,
    )
    expect(screen.getByText('chat.subagent.done')).toBeInTheDocument()
    expect(screen.queryByText('chat.subagent.running')).not.toBeInTheDocument()
  })

  it('renders inline childBlocks (not the progress channel) when the agent has them — no regression', () => {
    // A parent agent that DID stream inline children. Even if a stale progress
    // entry exists, the structured inline blocks must win and the progress-only
    // "ghost" tool must NOT appear (else we double-render / replace the real tree).
    hoisted.sessionState.taskProgress = {
      'toolu_parent': {
        description: '', totalTokens: 10, toolUses: 1, durationMs: 0,
        toolHistory: [{ toolName: 'GhostProgressTool', description: 'should not render' }],
      },
    }
    render(
      <SubagentBlock
        taskBlock={agentBlock('toolu_parent', false)}
        childBlocks={[
          { type: 'tool_use', toolUseId: 'c1', toolName: 'Read', input: '{}', parentToolUseId: 'toolu_parent', status: 'complete' } as ContentBlock,
          { type: 'tool_result', toolUseId: 'c1', summary: 'file body', parentToolUseId: 'toolu_parent' } as ContentBlock,
        ]}
        resultBlock={{ type: 'tool_result', toolUseId: 'toolu_parent', summary: 'done' } as ContentBlock}
        isStreaming={false}
        defaultExpanded
      />,
    )
    expect(screen.getByTestId('tool-block').getAttribute('data-tool')).toBe('Read')
    expect(screen.queryByText('GhostProgressTool')).not.toBeInTheDocument()
  })
})
