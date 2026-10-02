/** @vitest-environment jsdom */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { OpenCodeResources } from '@superone/shared/agent-types'
import { useChatStore } from '@/stores/chat'
import { StatusBarPermission } from './chat-status-bar/StatusBarPermission'
import { OpenCodeModelSelector } from './model-selector/OpenCodeModelSelector'

const catalog: OpenCodeResources = {
  models: [{ id: 'openai/gpt', name: 'GPT', description: '', supportedEffortLevels: ['low', 'high'] }],
  agents: [{ id: 'build', name: 'Build' }, { id: 'plan', name: 'Plan' }, { id: 'reviewer', name: 'Reviewer', modelId: 'another/model' }],
  commands: [],
}
const path = '/opencode-native-agent-test'
const connect = vi.fn<(force?: boolean) => Promise<OpenCodeResources>>()
const broadcast = vi.fn(async () => undefined)

function session() {
  const project = useChatStore.getState().projectSessions[path]!
  return project._sessions[project._activeSessionId!]!
}

beforeEach(() => {
  vi.clearAllMocks()
  Object.assign(window.app, { connectOpenCode: connect })
  Object.assign(window.agent, { broadcastSessionSetting: broadcast })
  useChatStore.setState({ projectSessions: {}, activeProject: null })
  useChatStore.getState().ensureSession(path)
  const project = useChatStore.getState().projectSessions[path]!
  const sid = project._activeSessionId!
  useChatStore.setState({ activeProject: path, projectSessions: {
    [path]: { ...project, _sessions: { [sid]: { ...project._sessions[sid]!,
      sessionProvider: 'opencode', preferredProvider: 'opencode', permissionMode: 'default',
      selectedModel: 'openai/gpt', selectedEffort: 'high', openCodeAgentId: 'plan',
    } } },
  } })
  useChatStore.getState().setHarnessResources('opencode', catalog)
})
afterEach(cleanup)

describe('OpenCode native agent controls', () => {
  it('uses the former permission slot to switch agents without changing model or effort', async () => {
    const user = userEvent.setup()
    render(<StatusBarPermission activeProvider="opencode" compactIndicators={false} />)
    await user.click(screen.getByRole('button', { name: 'Agent: Plan' }))
    expect(screen.queryByText('Accept Edits')).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Plan' })).toHaveAttribute('aria-pressed', 'true')
    await user.click(screen.getByRole('button', { name: 'Reviewer' }))
    expect(session()).toMatchObject({ openCodeAgentId: 'reviewer', selectedModel: 'openai/gpt', selectedEffort: 'high', permissionMode: 'default' })
    expect(screen.queryByRole('button', { name: 'Reviewer' })).not.toBeInTheDocument()
    expect(broadcast).toHaveBeenCalledWith(expect.any(String), { openCodeAgentId: 'reviewer', permissionMode: 'default' })
  })

  it('focuses the selected agent on open without displaying the refresh tooltip', async () => {
    const user = userEvent.setup()
    render(<StatusBarPermission activeProvider="opencode" compactIndicators={false} />)
    await user.click(screen.getByRole('button', { name: 'Agent: Plan' }))
    expect(screen.getByRole('button', { name: 'Plan' })).toHaveFocus()
    expect(screen.queryByRole('tooltip')).not.toBeInTheDocument()
    await user.hover(screen.getByRole('button', { name: 'Refresh Agents' }))
    expect(await screen.findByRole('tooltip')).toHaveTextContent('Refresh Agents')
  })

  it('refreshes agents in its own panel, retaining the catalog after failure and allowing retry', async () => {
    const user = userEvent.setup()
    let reject!: (error: Error) => void
    connect.mockImplementationOnce(() => new Promise((_resolve, fail) => { reject = fail }))
      .mockResolvedValueOnce({ ...catalog, agents: [...catalog.agents, { id: 'writer', name: 'Writer' }] })
    render(<StatusBarPermission activeProvider="opencode" compactIndicators={false} />)
    await user.click(screen.getByRole('button', { name: 'Agent: Plan' }))
    await user.click(screen.getByRole('button', { name: 'Refresh Agents' }))
    expect(connect).toHaveBeenCalledWith(true)
    expect(screen.getByRole('button', { name: 'Refresh Agents' })).toBeDisabled()
    await act(async () => reject(new Error('offline')))
    expect(await screen.findByRole('alert')).toHaveTextContent('Could not refresh OpenCode agents.')
    expect(screen.getByRole('button', { name: 'Plan' })).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Refresh Agents' }))
    expect(await screen.findByRole('button', { name: 'Writer' })).toBeInTheDocument()
    expect(session().openCodeAgentId).toBe('plan')
  })

  it('offers agent refresh even with an empty catalog', async () => {
    const user = userEvent.setup()
    useChatStore.getState().setOpenCodeAgentId(null)
    useChatStore.getState().setHarnessResources('opencode', { ...catalog, agents: [] })
    connect.mockResolvedValue(catalog)
    render(<StatusBarPermission activeProvider="opencode" compactIndicators />)
    await user.click(screen.getByRole('button', { name: 'Agent: Default Agent' }))
    expect(screen.getByText('No agents available. Refresh to try again.')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Refresh Agents' }))
    expect(await screen.findByRole('button', { name: 'Build' })).toBeInTheDocument()
  })

  it('lists the session project agents over the global catalog', async () => {
    const user = userEvent.setup()
    const project = useChatStore.getState().projectSessions[path]!
    const sid = project._activeSessionId!
    useChatStore.setState({ projectSessions: { [path]: { ...project, _sessions: { [sid]: { ...session(),
      openCodeAgentId: 'local-docs', sessionAgents: [{ id: 'build', name: 'Build' }, { id: 'local-docs', name: 'Local Docs' }],
    } } } } })
    useChatStore.getState().setHarnessResources('opencode', catalog)
    expect(session().openCodeAgentId).toBe('local-docs')
    render(<StatusBarPermission activeProvider="opencode" compactIndicators={false} />)
    await user.click(screen.getByRole('button', { name: 'Agent: Local Docs' }))
    expect(screen.getByRole('button', { name: 'Local Docs' })).toHaveAttribute('aria-pressed', 'true')
    expect(screen.queryByRole('button', { name: 'Reviewer' })).not.toBeInTheDocument()
  })

  it('keeps native agents out of the model and effort menu', async () => {
    const user = userEvent.setup()
    render(<OpenCodeModelSelector />)
    await user.click(screen.getByRole('button'))
    expect(screen.queryByText('Agent')).not.toBeInTheDocument()
    expect(screen.queryByText('Plan')).not.toBeInTheDocument()
    expect(screen.queryByText('Reviewer')).not.toBeInTheDocument()
  })

  it('cycles native agents and toggles Plan through the same session selection', async () => {
    act(() => useChatStore.getState().cyclePermissionMode())
    expect(session().openCodeAgentId).toBe('reviewer')
    act(() => useChatStore.getState().togglePlanModeShortcut())
    expect(session().openCodeAgentId).toBe('plan')
    act(() => useChatStore.getState().togglePlanModeShortcut())
    expect(session().openCodeAgentId).toBe('reviewer')
    expect(session().permissionMode).toBe('default')
  })

  it('leaves Plan without a remembered agent for build, or another agent without build', () => {
    act(() => useChatStore.getState().togglePlanModeShortcut())
    expect(session().openCodeAgentId).toBe('build')

    act(() => useChatStore.getState().setOpenCodeAgentId('plan'))
    useChatStore.getState().setHarnessResources('opencode', { ...catalog, agents: catalog.agents.filter((agent) => agent.id !== 'build') })
    act(() => useChatStore.getState().togglePlanModeShortcut())
    expect(session().openCodeAgentId).toBe('reviewer')
  })
})
