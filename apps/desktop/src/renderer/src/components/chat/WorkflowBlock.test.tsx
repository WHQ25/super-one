/** @vitest-environment jsdom */

import { render, screen } from '@testing-library/react'
import { describe, expect, it, vi, beforeEach } from 'vitest'
import type { ContentBlock } from '@superone/shared/agent-types'

const hoisted = vi.hoisted(() => ({
  sessionState: {
    subagentTokens: {} as Record<string, { input: number; output: number }>,
    subagentColors: {} as Record<string, number>,
    cwd: '/Users/me/proj',
    _providerSessionId: '019f-sess' as string | null,
    taskProgress: {} as Record<string, {
      description: string
      taskId?: string
      summary?: string
      totalTokens: number
      toolUses: number
      durationMs: number
      completed?: boolean
      status?: 'completed' | 'failed' | 'stopped'
      resultText?: string
      toolHistory: Array<{ toolName: string; description: string }>
      workflowAgents?: Array<{ agentId?: string; label: string; toolCount: number; tokens?: number; state?: string }>
      workflowPhases?: Array<{ title: string; state?: string }>
      currentPhase?: string
    }>,
  },
  storeState: {
    activeProject: '/Users/me/proj',
    projectSessions: {
      '/Users/me/proj': { homedir: '/Users/me' },
    },
  },
  navOpen: vi.fn(),
}))

vi.mock('@/stores/chat', () => ({
  useActiveSession: (selector: (s: typeof hoisted.sessionState) => unknown) => selector(hoisted.sessionState),
  useChatStore: Object.assign((selector: (s: typeof hoisted.storeState) => unknown) => selector(hoisted.storeState), {
    setState: vi.fn(),
    getState: () => ({ assignSubagentColor: vi.fn() }),
  }),
}))

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (_key: string, fallback?: string) => fallback ?? _key }),
}))

vi.mock('./workflow-navigation-context', () => ({
  useWorkflowNavigation: () => ({ open: hoisted.navOpen, close: vi.fn() }),
}))

vi.mock('./use-workflow-agents', () => ({
  useWorkflowAgents: (transcriptDir: string | undefined) => {
    if (!transcriptDir) return []
    // Only Claude-style dirs ship agent-*.jsonl fixtures in these tests.
    // Grok resolved ~/.grok/.../workflows/<run> should fall back to liveAgents.
    if (transcriptDir.includes('/.grok/')) return []
    return [{
      agentId: 'claude-a1',
      jsonlPath: `${transcriptDir}/agent.jsonl`,
      label: 'ClaudeAgent',
      toolCount: 2,
      tokens: 100,
    }]
  },
}))

vi.mock('./use-workflow-output', () => ({
  useWorkflowOutput: () => null,
}))

vi.mock('./StructuredOutputView', () => ({
  StructuredOutputView: ({ data }: { data: string }) => <div data-testid="result-text">{data}</div>,
}))

vi.mock('./chat-shared', () => ({
  formatTokens: (n: number) => String(n),
}))

import { WorkflowBlock } from './WorkflowBlock'

function workflowTool(input: Record<string, unknown> = {}): ContentBlock & { type: 'tool_use' } {
  return {
    type: 'tool_use',
    toolUseId: 'tc_wf',
    toolName: 'Workflow',
    input: JSON.stringify(input),
  } as ContentBlock & { type: 'tool_use' }
}

function grokResult(): ContentBlock {
  return {
    type: 'tool_result',
    toolUseId: 'tc_wf',
    summary: JSON.stringify({
      run_id: 'wf_live',
      task_id: 'wf_live',
      name: 'review-changes',
      message: 'Workflow review-changes started.',
    }),
  } as ContentBlock
}

function claudeResult(): ContentBlock {
  return {
    type: 'tool_result',
    toolUseId: 'tc_wf',
    summary: [
      'Workflow launched in background. Task ID: t1',
      'Transcript dir: /tmp/demo/subagents/workflows/wf_claude',
      'Script file: /tmp/script.js',
    ].join('\n'),
  } as ContentBlock
}

beforeEach(() => {
  hoisted.sessionState = {
    subagentTokens: {},
    subagentColors: {},
    cwd: '/Users/me/proj',
    _providerSessionId: '019f-sess',
    taskProgress: {},
  }
  hoisted.storeState = {
    activeProject: '/Users/me/proj',
    projectSessions: {
      '/Users/me/proj': { homedir: '/Users/me' },
    },
  }
  hoisted.navOpen.mockClear()
})

describe('WorkflowBlock — Grok launch without transcript', () => {
  it('stays running when Grok JSON landed, parent still streaming, and no progress yet', () => {
    render(
      <WorkflowBlock
        toolBlock={workflowTool({ name: 'review-changes' })}
        resultBlock={grokResult()}
        isStreaming
        defaultExpanded
      />,
    )
    expect(screen.getByText('Running…')).toBeInTheDocument()
    expect(screen.queryByText('Workflow complete')).not.toBeInTheDocument()
  })

  it('shows live phases/agents while running after parent turn is idle', () => {
    hoisted.sessionState.taskProgress = {
      tc_wf: {
        description: 'review-changes: Review the PR',
        taskId: 'wf_live',
        summary: 'phase: Execute · Plan(done) → Execute(active)',
        totalTokens: 50,
        toolUses: 1,
        durationMs: 12000,
        completed: false,
        toolHistory: [],
        currentPhase: 'Execute',
        workflowPhases: [
          { title: 'Plan', state: 'done' },
          { title: 'Execute', state: 'active' },
        ],
        workflowAgents: [
          { agentId: 'a1', label: 'Explore', toolCount: 0, tokens: 50, state: 'running' },
        ],
      },
    }
    render(
      <WorkflowBlock
        toolBlock={workflowTool({ name: 'review-changes' })}
        resultBlock={grokResult()}
        isStreaming={false}
        defaultExpanded
      />,
    )
    expect(screen.getByText('Plan')).toBeInTheDocument()
    expect(screen.getByText('Execute')).toBeInTheDocument()
    expect(screen.getByText('Explore')).toBeInTheDocument()
    expect(screen.getByText('running')).toBeInTheDocument()
    expect(screen.getByText(/phase: Execute/)).toBeInTheDocument()
    // Grok resolves ~/.grok/sessions/.../workflows/<run_id> → full view available
    expect(screen.getByTitle('Open full view')).toBeInTheDocument()
  })

  it('opens full view with resolved Grok workflow dir and script.rhai path', async () => {
    const { userEvent } = await import('@testing-library/user-event')
    const user = userEvent.setup()
    hoisted.sessionState.taskProgress = {
      tc_wf: {
        description: 'review-changes',
        taskId: 'wf_live',
        summary: 'running',
        totalTokens: 0,
        toolUses: 0,
        durationMs: 1000,
        completed: false,
        toolHistory: [],
        workflowAgents: [{ agentId: 'a1', label: 'Explore', toolCount: 0 }],
      },
    }
    render(
      <WorkflowBlock
        toolBlock={workflowTool({ name: 'review-changes' })}
        resultBlock={grokResult()}
        isStreaming={false}
        defaultExpanded
      />,
    )
    await user.click(screen.getByTitle('Open full view'))
    expect(hoisted.navOpen).toHaveBeenCalledWith(expect.objectContaining({
      toolUseId: 'tc_wf',
      transcriptDir: '/Users/me/.grok/sessions/%2FUsers%2Fme%2Fproj/019f-sess/workflows/wf_live',
      name: 'review-changes',
      scriptPath: '/Users/me/.grok/sessions/%2FUsers%2Fme%2Fproj/019f-sess/workflows/wf_live/script.rhai',
    }))
  })

  it('stays running (not complete) while streaming even when Grok dir is resolved', () => {
    render(
      <WorkflowBlock
        toolBlock={workflowTool({ name: 'review-changes' })}
        resultBlock={grokResult()}
        isStreaming
        defaultExpanded
      />,
    )
    expect(screen.getByText('Running…')).toBeInTheDocument()
    expect(screen.queryByText('Workflow complete')).not.toBeInTheDocument()
  })

  it('renders completed with resultText', async () => {
    const { userEvent } = await import('@testing-library/user-event')
    const user = userEvent.setup()
    hoisted.sessionState.taskProgress = {
      tc_wf: {
        description: 'review-changes',
        taskId: 'wf_live',
        summary: 'done',
        totalTokens: 10,
        toolUses: 1,
        durationMs: 5000,
        completed: true,
        status: 'completed',
        resultText: 'All good',
        toolHistory: [],
        currentPhase: 'Execute',
        workflowPhases: [{ title: 'Plan', state: 'done' }, { title: 'Execute', state: 'done' }],
      },
    }
    render(
      <WorkflowBlock
        toolBlock={workflowTool({ name: 'review-changes' })}
        resultBlock={grokResult()}
        isStreaming={false}
        defaultExpanded
      />,
    )
    expect(screen.getByText(/Workflow complete/)).toBeInTheDocument()
    // Persisted currentPhase must not look live after completion
    expect(screen.queryByText('Execute', { selector: '.text-primary' })).not.toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: /Output/i }))
    expect(screen.getByTestId('result-text')).toHaveTextContent('All good')
  })

  it('renders failed and stopped distinctly without success-checking unfinished phases', () => {
    hoisted.sessionState.taskProgress = {
      tc_wf: {
        description: 'x',
        taskId: 'wf_live',
        summary: 'boom',
        totalTokens: 0,
        toolUses: 0,
        durationMs: 100,
        completed: true,
        status: 'failed',
        toolHistory: [],
        workflowPhases: [
          { title: 'Plan', state: 'done' },
          { title: 'Execute', state: 'active' },
          { title: 'Verify', state: 'pending' },
        ],
      },
    }
    const { container, rerender } = render(
      <WorkflowBlock
        toolBlock={workflowTool()}
        resultBlock={grokResult()}
        isStreaming={false}
        defaultExpanded
      />,
    )
    expect(screen.getByText(/Workflow failed/)).toBeInTheDocument()
    // Explicit done may keep a check; active/pending must not get success styling for failed run.
    const phaseRows = container.querySelectorAll('.space-y-0\\.5 > div')
    // Plan is done → may show check; Execute/Verify must not appear with text-success check alone on unfinished
    expect(screen.getByText('Execute').closest('div')?.querySelector('.text-success')).toBeNull()
    expect(screen.getByText('Verify').closest('div')?.querySelector('.text-success')).toBeNull()
    void phaseRows

    hoisted.sessionState.taskProgress = {
      tc_wf: {
        description: 'x',
        taskId: 'wf_live',
        totalTokens: 0,
        toolUses: 0,
        durationMs: 100,
        completed: true,
        status: 'stopped',
        toolHistory: [],
        workflowPhases: [
          { title: 'Plan', state: 'done' },
          { title: 'Execute', state: 'active' },
        ],
      },
    }
    rerender(
      <WorkflowBlock
        toolBlock={workflowTool()}
        resultBlock={grokResult()}
        isStreaming={false}
        defaultExpanded
      />,
    )
    expect(screen.getByText(/Workflow stopped/)).toBeInTheDocument()
    expect(screen.getByText('Execute').closest('div')?.querySelector('.text-success')).toBeNull()
  })
})

describe('WorkflowBlock — Claude transcript regression', () => {
  it('treats launched transcript without live progress as historical complete and keeps full-view nav', () => {
    render(
      <WorkflowBlock
        toolBlock={workflowTool({
          script: `export const meta = { name: 'ui-test', description: 'demo', phases: [{ title: 'Greet' }] }`,
        })}
        resultBlock={claudeResult()}
        isStreaming={false}
        defaultExpanded
      />,
    )
    expect(screen.getByText(/Workflow complete/)).toBeInTheDocument()
    expect(screen.getByText('ClaudeAgent')).toBeInTheDocument()
    expect(screen.getByTitle('Open full view')).toBeInTheDocument()
  })
})
