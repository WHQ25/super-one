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
  return {
    useAppStore: (selector: (s: { navigateTo: typeof navigateTo; setSettingsTab: typeof setSettingsTab }) => unknown) =>
      selector({ navigateTo, setSettingsTab }),
    __navigateTo: navigateTo,
    __setSettingsTab: setSettingsTab,
  }
})

import { McpSlashPopup } from './McpSlashPopup'
import * as chatMock from '@/stores/chat'
import * as appMock from '@/stores/app'

const setChat = (chatMock as unknown as { __setMockChatState: (n: Record<string, unknown>) => void }).__setMockChatState
const navigateToMock = (appMock as unknown as { __navigateTo: ReturnType<typeof vi.fn> }).__navigateTo
const setSettingsTabMock = (appMock as unknown as { __setSettingsTab: ReturnType<typeof vi.fn> }).__setSettingsTab

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
    expect(screen.getByText('spawn ENOENT')).toBeInTheDocument()
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

    expect(setSettingsTabMock).toHaveBeenCalledWith('mcp')
    expect(navigateToMock).toHaveBeenCalledWith('settings')
    expect(onClose).toHaveBeenCalled()
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
})
