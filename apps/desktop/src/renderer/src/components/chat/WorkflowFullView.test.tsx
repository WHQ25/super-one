/** @vitest-environment jsdom */

import { render, screen } from '@testing-library/react'
import { userEvent } from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { WorkflowViewState } from './workflow-navigation-context'

const hoisted = vi.hoisted(() => ({
  sessionState: {
    subagentColors: {} as Record<string, number>,
    taskProgress: {} as Record<string, {
      completed?: boolean
      taskId?: string
      workflowAgents?: Array<{ agentId?: string; label: string; toolCount: number; tokens?: number; state?: string; phase?: string }>
    }>,
  },
  navClose: vi.fn(),
  subagentJsonlCalls: [] as Array<{ outputFile?: string; enabled: boolean; skipAuthoritativeRead?: boolean }>,
  subagentJsonlByFile: {} as Record<string, { entries: Array<{ type: string; toolName?: string; text?: string; result?: string; isError?: boolean }>; resultText?: string }>,
  codeBlockCalls: [] as Array<{ code: string; language: string }>,
}))

vi.mock('@/stores/chat', () => ({
  useActiveSession: (selector: (s: typeof hoisted.sessionState) => unknown) => selector(hoisted.sessionState),
}))

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (_key: string, fallback?: string) => fallback ?? _key }),
}))

vi.mock('./workflow-navigation-context', () => ({
  useWorkflowNavigation: () => ({ current: null, open: vi.fn(), close: hoisted.navClose }),
}))

vi.mock('./CodeBlock', () => ({
  HighlightedCodeBlock: ({ code, language }: { code: string; language: string }) => {
    hoisted.codeBlockCalls.push({ code, language })
    return <pre data-testid="highlighted-code" data-language={language}>{code}</pre>
  },
}))

vi.mock('streamdown', () => ({
  Streamdown: ({ children }: { children: string }) => <div data-testid="streamdown">{children}</div>,
}))

vi.mock('./use-subagent-jsonl', () => ({
  useSubagentJsonl: (opts: { outputFile?: string; enabled: boolean; skipAuthoritativeRead?: boolean }) => {
    hoisted.subagentJsonlCalls.push(opts)
    if (opts.enabled && opts.outputFile && hoisted.subagentJsonlByFile[opts.outputFile]) {
      return hoisted.subagentJsonlByFile[opts.outputFile]
    }
    return { entries: [], resultText: undefined }
  },
}))

vi.mock('./subagent-activity', () => ({
  renderJsonlEntry: (entry: { type: string; toolName?: string; text?: string; result?: string; isError?: boolean }, index: number) => (
    <div
      key={`entry-${index}`}
      data-testid={`jsonl-entry-${entry.type}`}
      data-error={entry.isError ? 'true' : undefined}
    >
      {entry.type === 'tool' ? `${entry.toolName}: ${entry.result ?? ''}` : entry.text}
    </div>
  ),
}))

vi.mock('./WorkflowDagCanvas', () => ({
  WorkflowDagCanvas: ({
    dag,
    stats,
    onSelectNode,
    overlayHeader,
    overlayContent,
    onContainerWidth,
  }: {
    dag: { nodes: Array<{ id: string; label: string }> }
    stats?: Map<string, { toolCount?: number; tokens?: number }>
    onSelectNode?: (node: { id: string; label: string }) => void
    overlayHeader?: React.ReactNode
    overlayContent?: React.ReactNode
    onContainerWidth?: (w: number) => void
  }) => (
    <div data-testid="dag-canvas">
      <button type="button" onClick={() => onContainerWidth?.(800)}>set-wide</button>
      {dag.nodes.map((node) => {
        const s = stats?.get(node.id)
        return (
          <button key={node.id} type="button" onClick={() => onSelectNode?.(node)}>
            {node.label}
            {s?.tokens ? ` (${s.tokens})` : ''}
          </button>
        )
      })}
      {overlayHeader && <div data-testid="dag-overlay-header">{overlayHeader}</div>}
      {overlayContent && <div data-testid="dag-overlay-content">{overlayContent}</div>}
    </div>
  ),
}))

vi.mock('./StructuredOutputView', () => ({
  StructuredOutputView: ({ data }: { data: unknown }) => <div data-testid="structured-output">{String(data)}</div>,
}))

vi.mock('./chat-shared', () => ({
  streamdownPlugins: [],
  streamdownRehypePlugins: [],
  streamdownControls: {},
  streamdownComponents: {},
  streamdownLinkSafety: {},
  codePlugin: {},
  formatTokens: (n: number) => String(n),
}))

import { WorkflowFullView } from './WorkflowFullView'

beforeEach(() => {
  hoisted.sessionState = {
    subagentColors: {},
    taskProgress: {},
  }
  hoisted.navClose.mockClear()
  hoisted.subagentJsonlCalls = []
  hoisted.subagentJsonlByFile = {}
  hoisted.codeBlockCalls = []
  delete (window as { app?: unknown }).app
})

describe('WorkflowFullView', () => {
  it('renders Antigravity task-*.log agents in List tab, shows resultText with explicit transcript-unavailable note, and highlights Python scripts', async () => {
    const user = userEvent.setup()
    const pyScript = [
      'phase("Demo")',
      'results = await parallel(["apple", "banana"], lambda item: agent(f"Fact: {item}", role=f"Fact: {item}"))',
    ].join('\n')
    const logText = [
      '- [phase] Demo',
      '- apple: red',
      '- [agent:self] Fact: apple: done (ag-apple): "Apples are crisp."',
      '- [agent:self] Fact: banana: running (ag-banana)',
      'Output:',
      'Summary output',
    ].join('\n')

    Object.assign(window, {
      app: {
        readBashOutputFile: vi.fn().mockResolvedValue(logText),
      },
    })

    const view: WorkflowViewState = {
      toolUseId: 'tc_ag',
      harness: 'antigravity',
      logPath: '/tmp/task-6.log',
      name: 'demo.py',
      script: pyScript,
      scriptPath: '/tmp/demo.py',
    }

    render(<WorkflowFullView view={view} />)

    expect(await screen.findByRole('button', { name: 'Graph' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'List' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Script' })).toBeInTheDocument()
    expect(screen.getByTestId('dag-canvas')).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'List' }))
    expect(screen.getByText('Demo')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Fact: apple' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Fact: banana' })).toBeInTheDocument()
    expect(screen.getByTestId('streamdown')).toHaveTextContent('Apples are crisp.')
    expect(screen.getByText('Tool-level transcript is unavailable for this agent; showing final output.')).toBeInTheDocument()
    expect(screen.queryByText('No activity recorded')).not.toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Fact: banana' }))
    expect(screen.getByText('Tool-level transcript is unavailable for this agent.')).toBeInTheDocument()
    expect(screen.queryByText('No activity recorded')).not.toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Script' }))
    const codeEl = screen.getByTestId('highlighted-code')
    expect(codeEl).toHaveAttribute('data-language', 'python')
  })

  it('renders Graph and Python Script for Antigravity workflows even without logPath or transcriptDir', async () => {
    const user = userEvent.setup()
    const pyScript = [
      'phase("Echo")',
      'results = await parallel(["Hello", "World"], lambda word: agent(f"Upper {word}", role=f"Uppercase {word}", model="flash_lite"))',
    ].join('\n')

    render(
      <WorkflowFullView
        view={{
          toolUseId: 'tc_ag_done',
          harness: 'antigravity',
          inlineSummary: 'done',
          name: 'Minimal run_workflow example',
          script: pyScript,
        }}
      />,
    )

    expect(screen.getByRole('button', { name: 'Graph' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Script' })).toBeInTheDocument()
    expect(screen.getByTestId('dag-canvas')).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Script' }))
    expect(screen.getByTestId('highlighted-code')).toHaveAttribute('data-language', 'python')
  })

  it('loads Antigravity child transcript.jsonl into List and Graph views with prompt, tool calls, toolCount, and tokens', async () => {
    const user = userEvent.setup()
    const pyScript = [
      'phase("Echo")',
      'results = await parallel(["Hello", "World"], lambda word: agent(f"Reply with uppercase: {word}", role=f"Uppercase {word}", model="flash_lite"))',
    ].join('\n')
    const logText = [
      '- [phase] Echo',
      '- [agent:self] Uppercase Hello: done (9f0dcf74-hello): "HELLO"',
      '- [agent:self] Uppercase World: done (9f0dcf74-world): "WORLD"',
    ].join('\n')
    const helloJsonl = '/brain/9f0dcf74-hello/.system_generated/logs/transcript.jsonl'
    hoisted.subagentJsonlByFile[helloJsonl] = {
      entries: [
        { type: 'activity', text: 'Need to return HELLO.' },
        { type: 'tool', toolName: 'session_rename', result: 'unknown tool: "session_rename"', isError: true },
        { type: 'tool', toolName: 'finish', result: 'Finished.' },
      ],
      resultText: 'HELLO',
    }
    Object.assign(window, {
      app: {
        readBashOutputFile: vi.fn().mockResolvedValue(logText),
        resolveWorkflowAgentTranscripts: vi.fn().mockResolvedValue({
          '9f0dcf74-hello': {
            agentId: '9f0dcf74-hello',
            jsonlPath: helloJsonl,
            prompt: 'Reply with uppercase: Hello',
            toolCount: 2,
            tokens: 32818,
            resultText: 'HELLO',
            transcriptAvailable: true,
          },
        }),
      },
    })

    render(
      <WorkflowFullView
        view={{
          toolUseId: 'tc_ag_transcript',
          harness: 'antigravity',
          logPath: '/brain/parent-1/.system_generated/tasks/task-6.log',
          name: 'echo.py',
          script: pyScript,
        }}
      />,
    )

    expect(await screen.findByRole('button', { name: 'Uppercase Hello (32818)' })).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'set-wide' }))
    await user.click(screen.getByRole('button', { name: 'Uppercase Hello (32818)' }))
    expect(screen.getByTestId('dag-overlay-header')).toHaveTextContent('Uppercase Hello')
    expect(screen.getByTestId('dag-overlay-header')).toHaveTextContent('32818')
    expect(screen.getByTestId('dag-overlay-content')).toHaveTextContent('Reply with uppercase: Hello')
    expect(screen.getByTestId('dag-overlay-content')).toHaveTextContent('Need to return HELLO.')
    expect(screen.getByTestId('dag-overlay-content')).toHaveTextContent('session_rename: unknown tool: "session_rename"')
    expect(screen.getByTestId('dag-overlay-content')).toHaveTextContent('HELLO')
    expect(screen.queryByText(/Tool-level transcript is unavailable/)).not.toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'List' }))
    expect(screen.getByText('Reply with uppercase: Hello')).toBeInTheDocument()
    expect(hoisted.subagentJsonlCalls.some((c) => c.outputFile === helloJsonl && c.enabled && c.skipAuthoritativeRead === true)).toBe(true)

    await user.click(screen.getByRole('button', { name: 'Uppercase World' }))
    expect(screen.getByText('Tool-level transcript is unavailable for this agent; showing final output.')).toBeInTheDocument()
    expect(screen.getByTestId('streamdown')).toHaveTextContent('WORLD')
  })

  it('uses adapter authoritative jsonl policy for Claude vs Grok agent transcripts', async () => {
    const claudeAgent = {
      agentId: 'a1',
      jsonlPath: '/tmp/claude/agent-a1.jsonl',
      label: 'ClaudeWorker',
      toolCount: 1,
      resultText: 'done',
    }
    const grokAgent = {
      agentId: 'g1',
      jsonlPath: '/Users/me/.grok/sessions/p/child/chat_history.jsonl',
      label: 'GrokWorker',
      toolCount: 1,
      resultText: 'done',
    }

    Object.assign(window, {
      app: {
        listWorkflowAgents: vi.fn().mockResolvedValue([claudeAgent]),
      },
    })

    const { unmount } = render(
      <WorkflowFullView
        view={{
          toolUseId: 'tc_claude',
          harness: 'claude',
          transcriptDir: '/tmp/claude',
          name: 'claude-wf',
          agentId: 'a1',
        }}
      />,
    )
    expect(await screen.findByText('ClaudeWorker')).toBeInTheDocument()
    expect(hoisted.subagentJsonlCalls.some((c) => c.outputFile === claudeAgent.jsonlPath && c.skipAuthoritativeRead === false)).toBe(true)
    unmount()

    hoisted.subagentJsonlCalls = []
    Object.assign(window, {
      app: {
        listWorkflowAgents: vi.fn().mockResolvedValue([grokAgent]),
      },
    })
    render(
      <WorkflowFullView
        view={{
          toolUseId: 'tc_grok',
          harness: 'grok',
          transcriptDir: '/Users/me/.grok/sessions/p/s/workflows/wf_1',
          name: 'grok-wf',
          agentId: 'g1',
        }}
      />,
    )
    expect(await screen.findByText('GrokWorker')).toBeInTheDocument()
    expect(hoisted.subagentJsonlCalls.some((c) => c.outputFile === grokAgent.jsonlPath && c.skipAuthoritativeRead === true)).toBe(true)
  })
})
