/** @vitest-environment jsdom */

import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { describe, it, expect, beforeEach, vi } from 'vitest'
import type { McpServerInfo } from '@superone/shared/agent-types'

vi.mock('@/stores/chat', () => {
  const state = {
    activeProject: '/project',
    sessionProvider: null as 'claude' | 'codex' | null,
    preferredProvider: 'claude' as 'claude' | 'codex',
  }
  return {
    useChatStore: (selector: (s: typeof state) => unknown) => selector(state),
    useActiveSession: (selector: (s: typeof state) => unknown) => selector(state),
    __setMockChatState: (next: Partial<typeof state>) => Object.assign(state, next),
  }
})

vi.mock('@/stores/app', () => {
  const navigateTo = vi.fn()
  const setSettingsTab = vi.fn()
  const setSettingsProvider = vi.fn()
  return {
    useAppStore: (selector: (s: { navigateTo: typeof navigateTo; setSettingsTab: typeof setSettingsTab; setSettingsProvider: typeof setSettingsProvider }) => unknown) =>
      selector({ navigateTo, setSettingsTab, setSettingsProvider }),
    __navigateTo: navigateTo,
    __setSettingsTab: setSettingsTab,
    __setSettingsProvider: setSettingsProvider,
  }
})

import { McpSlashPopup } from './McpSlashPopup'
import * as chatMock from '@/stores/chat'
import * as appMock from '@/stores/app'

const setChat = (chatMock as unknown as { __setMockChatState: (n: Record<string, unknown>) => void }).__setMockChatState
const navigateToMock = (appMock as unknown as { __navigateTo: ReturnType<typeof vi.fn> }).__navigateTo
const setSettingsTabMock = (appMock as unknown as { __setSettingsTab: ReturnType<typeof vi.fn> }).__setSettingsTab
const setSettingsProviderMock = (appMock as unknown as { __setSettingsProvider: ReturnType<typeof vi.fn> }).__setSettingsProvider

function mockWindow(agentStatus: McpServerInfo[], probeStatus: McpServerInfo[]) {
  const w = window as unknown as Record<string, unknown>
  w.agent = {
    getMcpServerStatus: vi.fn().mockResolvedValue(agentStatus),
  }
  w.app = {
    checkMcpServers: vi.fn().mockResolvedValue({ status: probeStatus, meta: {} }),
  }
}

describe('McpSlashPopup', () => {
  beforeEach(() => {
    setChat({ activeProject: '/project', sessionProvider: null, preferredProvider: 'claude' })
    navigateToMock.mockClear()
    setSettingsTabMock.mockClear()
    setSettingsProviderMock.mockClear()
  })

  it('renders live status when active session exposes MCP servers', async () => {
    mockWindow(
      [
        { name: 'context7', status: 'connected', toolCount: 3, tools: [
          { name: 'query-docs', description: 'Fetch library documentation' },
          { name: 'resolve-library-id', description: 'Resolve library names' },
          { name: 'list-versions' },
        ] },
        { name: 'broken', status: 'failed', error: 'spawn ENOENT' },
      ],
      [],
    )

    render(<McpSlashPopup onClose={vi.fn()} />)

    expect(await screen.findByText('context7')).toBeInTheDocument()
    expect(screen.getByText('broken')).toBeInTheDocument()
    expect(screen.getByText(/Live · Claude session/)).toBeInTheDocument()
    expect(screen.getByText('3 tools')).toBeInTheDocument()
    // The error renders as a compact badge after the name, not inline; the detail is collapsed.
    expect(screen.getByText('error')).toBeInTheDocument()
    expect(screen.queryByText('spawn ENOENT')).not.toBeInTheDocument()
  })

  it('renders the server name + error badge for a failed server and reveals the detail on expand', async () => {
    const longError = 'Streamable HTTP error: Error POSTing to endpoint: {"error":"invalid_token","error_description":"Missing or invalid access token"}'
    mockWindow([{ name: 'linear', status: 'failed', error: longError }], [])

    render(<McpSlashPopup onClose={vi.fn()} />)

    // Name stays visible; the long error is NOT rendered inline (it used to squeeze the name out).
    const name = await screen.findByText('linear')
    expect(name).toBeInTheDocument()
    expect(screen.getByText('error')).toBeInTheDocument()
    expect(screen.queryByText(longError)).not.toBeInTheDocument()

    fireEvent.mouseDown(name.closest('button')!)

    expect(await screen.findByText(longError)).toBeInTheDocument()
  })

  it('falls back to probe results when session has no MCP servers loaded', async () => {
    mockWindow(
      [],
      [
        { name: 'planner', status: 'connected', toolCount: 2 },
      ],
    )

    render(<McpSlashPopup onClose={vi.fn()} />)

    expect(await screen.findByText('planner')).toBeInTheDocument()
    expect(screen.getByText(/Probed from config/)).toBeInTheDocument()
  })

  it('shows empty state when neither live nor probe returns servers', async () => {
    mockWindow([], [])

    render(<McpSlashPopup onClose={vi.fn()} />)

    expect(await screen.findByText('No MCP servers configured for this project')).toBeInTheDocument()
  })

  it('expands tools list on row click when tools are available', async () => {
    mockWindow(
      [{ name: 'context7', status: 'connected', toolCount: 1, tools: [{ name: 'query-docs', description: 'Fetch docs' }] }],
      [],
    )

    render(<McpSlashPopup onClose={vi.fn()} />)

    const row = await screen.findByText('context7')
    fireEvent.mouseDown(row.closest('button')!)

    expect(await screen.findByText('query-docs')).toBeInTheDocument()
    expect(screen.getByText('Fetch docs')).toBeInTheDocument()
  })

  it('navigates to MCP settings when settings button clicked', async () => {
    mockWindow([], [])

    const onClose = vi.fn()
    render(<McpSlashPopup onClose={onClose} />)

    await waitFor(() => expect(screen.getByText(/No MCP servers configured/)).toBeInTheDocument())

    const settingsBtn = screen.getByTitle('Manage in Settings')
    fireEvent.click(settingsBtn)

    expect(setSettingsProviderMock).toHaveBeenCalledWith('claude')
    expect(setSettingsTabMock).toHaveBeenCalledWith('mcp')
    expect(navigateToMock).toHaveBeenCalledWith('settings')
    expect(onClose).toHaveBeenCalled()
  })

  it('opens the codex MCP settings when the session is codex', async () => {
    setChat({ sessionProvider: 'codex' })
    mockWindow([], [])
    render(<McpSlashPopup onClose={vi.fn()} />)

    const settingsBtn = await screen.findByTitle('Manage in Settings')
    fireEvent.click(settingsBtn)

    expect(setSettingsProviderMock).toHaveBeenCalledWith('codex')
    expect(setSettingsTabMock).toHaveBeenCalledWith('mcp')
    expect(navigateToMock).toHaveBeenCalledWith('settings')
  })

  it('calls onClose when X button clicked', async () => {
    mockWindow([], [])
    const onClose = vi.fn()
    render(<McpSlashPopup onClose={onClose} />)

    await waitFor(() => expect(screen.getByText(/No MCP servers configured/)).toBeInTheDocument())

    fireEvent.click(screen.getByTitle('Close'))
    expect(onClose).toHaveBeenCalled()
  })

  it('shows Codex harness label when sessionProvider is codex', async () => {
    setChat({ sessionProvider: 'codex' })
    mockWindow([{ name: 'srv', status: 'connected', toolCount: 0 }], [])

    render(<McpSlashPopup onClose={vi.fn()} />)

    expect(await screen.findByText(/Live · Codex session/)).toBeInTheDocument()
  })

  it('probes the codex config (not claude) when a codex session has no live status', async () => {
    setChat({ sessionProvider: 'codex' })
    // No active codex connection → live empty → fall back to a probe scoped to codex,
    // so the handler reads codex config.toml rather than Claude's MCP config.
    mockWindow([], [{ name: 'codex-srv', status: 'connected', toolCount: 2 }])

    render(<McpSlashPopup onClose={vi.fn()} />)

    expect(await screen.findByText('codex-srv')).toBeInTheDocument()
    expect((window as unknown as { app: { checkMcpServers: ReturnType<typeof vi.fn> } }).app.checkMcpServers)
      .toHaveBeenCalledWith('/project', 'codex')
  })

  it('probes the claude config for a claude session', async () => {
    setChat({ sessionProvider: 'claude' })
    mockWindow([], [{ name: 'context7', status: 'connected', toolCount: 2 }])

    render(<McpSlashPopup onClose={vi.fn()} />)

    expect(await screen.findByText('context7')).toBeInTheDocument()
    expect((window as unknown as { app: { checkMcpServers: ReturnType<typeof vi.fn> } }).app.checkMcpServers)
      .toHaveBeenCalledWith('/project', 'claude')
  })
})
