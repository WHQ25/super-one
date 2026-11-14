/** @vitest-environment jsdom */

import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { ContentBlock, HarnessId } from '@superone/shared/agent-types'

const hoisted = vi.hoisted(() => ({
  harness: 'claude' as HarnessId,
  serves: true,
  callSession: vi.fn(async () => true),
  toastError: vi.fn(),
  bashOutput: undefined as { content: string; finished: boolean; outputPath?: string } | undefined,
  pendingPermissions: [] as Array<{ toolUseId?: string }>,
  scope: { projectPath: '/proj', sessionId: 'sid-1' } as { projectPath: string; sessionId: string } | null,
}))

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}))

vi.mock('sonner', () => ({
  toast: { error: hoisted.toastError },
}))

vi.mock('@/lib/session-client', () => ({
  callSession: hoisted.callSession,
}))

vi.mock('@/hooks/use-environment-serves', () => ({
  useEnvironmentServes: () => hoisted.serves,
}))

vi.mock('@/stores/app', () => ({
  useAppStore: Object.assign(() => 'main', {
    getState: () => ({ view: 'main' }),
  }),
}))

vi.mock('@/stores/chat-store/session-scope', () => ({
  useSessionScope: () => hoisted.scope,
}))

vi.mock('@/stores/chat', () => ({
  useActiveSession: (selector: (s: unknown) => unknown) => selector({
    sessionProvider: hoisted.harness,
    preferredProvider: hoisted.harness,
    cwd: '/proj',
    homedir: '/Users/test',
    taskProgress: {},
    pendingPermissions: hoisted.pendingPermissions,
    _streamingToolInputPreviews: {},
  }),
  useChatStore: Object.assign(
    (selector: (s: unknown) => unknown) => selector({
      toolRenderers: {},
      activeProject: '/proj',
      projectSessions: { '/proj': { _activeSessionId: 'sid-1', _sessions: {} } },
    }),
    {
      getState: () => ({
        activeProject: '/proj',
        projectSessions: {},
        _bashOutputs: {},
      }),
    },
  ),
  useBashOutput: () => hoisted.bashOutput,
}))

vi.mock('@/stores/settings', () => ({
  useSettingsStore: (selector: (s: unknown) => unknown) => selector({
    mcpMeta: {},
    mcpLibrary: [],
    autoExpandFileDiffs: false,
    hideMcpUiToolBlocks: false,
    toolDetailLevels: {},
  }),
}))

vi.mock('@/stores/source-control', () => ({
  useSourceControlStore: () => ({}),
}))

vi.mock('@/stores/miniapp', () => ({
  useMiniAppStore: (selector: (s: unknown) => unknown) => selector({ apps: [] }),
}))

vi.mock('./tool-display', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
}))

vi.mock('@/components/activity/activity-panel-api', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  openFileTab: vi.fn(),
}))

import { BackgroundTaskActionButton, hasForegroundBackgroundableTask } from './background-task-action'
import { ToolBlock } from './ToolBlock'

beforeEach(() => {
  vi.clearAllMocks()
  hoisted.harness = 'claude'
  hoisted.serves = true
  hoisted.bashOutput = undefined
  hoisted.pendingPermissions = []
  hoisted.scope = { projectPath: '/proj', sessionId: 'sid-1' }
})

describe('BackgroundTaskActionButton', () => {
  it('invokes session.backgroundTasks with toolUseId on click and Enter without bubbling', async () => {
    const parentClick = vi.fn()
    render(
      <button type="button" onClick={parentClick}>
        <BackgroundTaskActionButton toolUseId="tu-bash-1" />
      </button>,
    )

    const trigger = screen.getByRole('button', { name: 'chat.toolBlock.runInBackgroundShortcut' })
    fireEvent.click(trigger)
    await waitFor(() => {
      expect(hoisted.callSession).toHaveBeenCalledWith('/proj', 'sid-1', 'session.backgroundTasks', { toolUseId: 'tu-bash-1' })
    })
    expect(parentClick).not.toHaveBeenCalled()

    fireEvent.keyDown(trigger, { key: 'Enter' })
    await waitFor(() => {
      expect(hoisted.callSession).toHaveBeenCalledTimes(2)
    })
  })

  it('hides itself for non-Claude harnesses and when environment does not serve the method', () => {
    hoisted.harness = 'codex'
    const { rerender } = render(<BackgroundTaskActionButton toolUseId="tu-bash-1" />)
    expect(screen.queryByRole('button', { name: 'chat.toolBlock.runInBackgroundShortcut' })).not.toBeInTheDocument()

    hoisted.harness = 'claude'
    hoisted.serves = false
    rerender(<BackgroundTaskActionButton toolUseId="tu-bash-1" />)
    expect(screen.queryByRole('button', { name: 'chat.toolBlock.runInBackgroundShortcut' })).not.toBeInTheDocument()
  })

  it('shows Radix tooltip with Ctrl+B shortcut hint and omits native title', async () => {
    render(<BackgroundTaskActionButton toolUseId="tu-bash-1" />)
    const trigger = screen.getByRole('button', { name: 'chat.toolBlock.runInBackgroundShortcut' })
    expect(trigger).not.toHaveAttribute('title')

    fireEvent.focus(trigger)
    const tooltip = await screen.findByRole('tooltip')
    expect(tooltip).toHaveTextContent('chat.toolBlock.runInBackground')
    expect(tooltip).toHaveTextContent('Ctrl+B')
  })
})

describe('Bash header background action', () => {
  it('renders Run in Background while foreground Bash is streaming and hides once backgrounded', () => {
    const { rerender } = render(
      <ToolBlock
        toolName="Bash"
        toolUseId="tu-bash-fg"
        input={JSON.stringify({ command: 'sleep 20' })}
        status="streaming"
      />,
    )
    expect(screen.getByRole('button', { name: 'chat.toolBlock.runInBackgroundShortcut' })).toBeInTheDocument()

    rerender(
      <ToolBlock
        toolName="Bash"
        toolUseId="tu-bash-fg"
        input={JSON.stringify({ command: 'sleep 20' })}
        status="streaming"
        runInBackground
      />,
    )
    expect(screen.queryByRole('button', { name: 'chat.toolBlock.runInBackgroundShortcut' })).not.toBeInTheDocument()
  })

  it('preserves explicit trailingAction such as the status bar stop button', () => {
    render(
      <ToolBlock
        toolName="Bash"
        toolUseId="tu-bash-fg"
        input={JSON.stringify({ command: 'sleep 20' })}
        status="streaming"
        trailingAction={<span data-testid="custom-stop">stop</span>}
      />,
    )
    expect(screen.getByTestId('custom-stop')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'chat.toolBlock.runInBackgroundShortcut' })).not.toBeInTheDocument()
  })
})

describe('hasForegroundBackgroundableTask', () => {
  it('detects foreground Bash and subagents while excluding backgrounded, completed, or pending-permission blocks', () => {
    const bashFg = { type: 'tool_use', toolName: 'Bash', toolUseId: 'b1', input: '{"command":"sleep 10"}', status: 'streaming' } as ContentBlock
    const bashBg = { type: 'tool_use', toolName: 'Bash', toolUseId: 'b2', input: '{"command":"sleep 10"}', status: 'streaming', runInBackground: true } as ContentBlock
    const agentFg = { type: 'tool_use', toolName: 'Agent', toolUseId: 'a1', input: '{"subagent_type":"Explore","description":"scan"}', status: 'streaming' } as ContentBlock

    expect(hasForegroundBackgroundableTask({ status: 'streaming', messages: [{ id: 'm1', role: 'assistant', providerId: 'claude', status: 'streaming', createdAt: '', content: [bashFg] }] })).toBe(true)
    expect(hasForegroundBackgroundableTask({ status: 'streaming', messages: [{ id: 'm1', role: 'assistant', providerId: 'claude', status: 'streaming', createdAt: '', content: [bashBg] }] })).toBe(false)
    expect(hasForegroundBackgroundableTask({
      status: 'streaming',
      messages: [{ id: 'm1', role: 'assistant', providerId: 'claude', status: 'streaming', createdAt: '', content: [bashFg] }],
      pendingPermissions: [{ toolUseId: 'b1' }],
    })).toBe(false)
    expect(hasForegroundBackgroundableTask({ status: 'streaming', messages: [{ id: 'm1', role: 'assistant', providerId: 'claude', status: 'streaming', createdAt: '', content: [agentFg] }] })).toBe(true)
    expect(hasForegroundBackgroundableTask({
      status: 'idle',
      messages: [{
        id: 'm1',
        role: 'assistant',
        providerId: 'claude',
        status: 'complete',
        createdAt: '',
        content: [agentFg, { type: 'tool_result', toolUseId: 'a1', summary: 'done' } as ContentBlock],
      }],
    })).toBe(false)
  })
})
