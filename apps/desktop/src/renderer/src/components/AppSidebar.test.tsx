/** @vitest-environment jsdom */

import { createEvent, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { ButtonHTMLAttributes, HTMLAttributes, ReactNode } from 'react'

let sessionsByFolder: Record<string, Array<{ sessionId: string; title: string; lastActiveAt: string; messageCount: number; isHidden?: boolean }>> = {}

const appState = {
  sidebarTab: 'sessions',
  currentFolder: '/project-a',
  recentFolders: [{ name: 'project-a', path: '/project-a', addedAt: '2026-03-02T00:00:00.000Z' }],
  setShowSidebar: vi.fn(),
  navigateTo: vi.fn(),
  selectAndOpenFolder: vi.fn(),
  openFolder: vi.fn(async () => {}),
  removeRecentFolder: vi.fn(async () => {}),
  setSidebarTab: vi.fn((tab: 'sessions' | 'files') => { appState.sidebarTab = tab }),
}

const chatState = {
  resetSession: vi.fn(),
  fetchSessions: vi.fn(),
  removeSessionFromMemory: vi.fn(),
  switchSession: vi.fn(async () => {}),
  projectSessions: {} as Record<string, unknown>,
  remoteSessions: {} as Record<string, string[]>,
  agentTitles: {} as Record<string, string>,
}

const mockWindowApp = {
  listPinnedSessions: vi.fn(async () => []),
  listSessionsForFolder: vi.fn(async (folderPath: string) => sessionsByFolder[folderPath] ?? []),
  listSessionsForFolderPage: vi.fn(async (folderPath: string, limit: number, offset: number) => (sessionsByFolder[folderPath] ?? []).slice(offset, offset + limit)),
  onSessionChanged: vi.fn(() => () => {}),
  hideSession: vi.fn(async (sessionId: string, hidden: boolean) => {
    sessionsByFolder = Object.fromEntries(
      Object.entries(sessionsByFolder).map(([folderPath, rows]) => [
        folderPath,
        rows.map((row) => row.sessionId === sessionId ? { ...row, isHidden: hidden } : row),
      ]),
    )
  }),
  pinSession: vi.fn(async () => {}),
  deleteSession: vi.fn(async () => {}),
  renameSession: vi.fn(async () => {}),
  listAutomations: vi.fn(async () => []),
}

vi.mock('motion/react', () => ({
  AnimatePresence: ({ children }: { children: ReactNode }) => <>{children}</>,
  motion: {
    div: ({ children, ...props }: HTMLAttributes<HTMLDivElement>) => <div {...props}>{children}</div>,
    span: ({ children, ...props }: HTMLAttributes<HTMLSpanElement>) => <span {...props}>{children}</span>,
  },
}))

vi.mock('@/stores/app', () => ({
  useAppStore: Object.assign((selector: (state: typeof appState) => unknown) => selector(appState), { setState: vi.fn() }),
  useHasRealProject: () => true,
}))

vi.mock('@/stores/chat', () => ({
  useChatStore: Object.assign(
    (selector: (state: typeof chatState) => unknown) => selector(chatState),
    { getState: () => chatState },
  ),
  isDraftSession: (id: string | null) => id === '__draft__' || (!!id && id.startsWith('__draft_')),
  selectClaudeModels: () => [],
  selectCodexModels: () => [],
  selectClaudeAccount: () => ({}),
  selectClaudeSlashCommands: () => [],
  selectClaudeSkills: () => [],
  selectClaudeCommands: () => [],
  selectClaudeAgents: () => [],
  selectClaudeOutputStyles: () => [],
}))

vi.mock('@/stores/miniapp', () => ({
  useMiniAppStore: (selector: (s: Record<string, unknown>) => unknown) => selector({ fetchApps: vi.fn(), apps: [], workers: [] }),
}))

vi.mock('@/hooks/useFullscreen', () => ({
  useFullscreen: () => false,
}))

vi.mock('@/hooks/useTheme', () => ({
  useTheme: () => ({ dark: false, toggle: vi.fn() }),
}))

vi.mock('@/components/sidebar/FileTree', () => ({
  FileTree: () => <div>FileTree</div>,
}))

vi.mock('@/components/sidebar/BrandColorPopover', () => ({
  BrandColorPopover: () => null,
}))

vi.mock('@/components/sidebar/AnimatedSessionTitle', () => ({
  SessionTitleAnimated: ({ fallback, className }: { fallback: string; className?: string }) => <span className={className}>{fallback}</span>,
  useSessionTitleByAgent: (_sessionId: string | null | undefined, fallback: string | null | undefined) => fallback ?? '',
}))

vi.mock('@/components/ui/button', () => ({
  Button: ({ children, ...props }: ButtonHTMLAttributes<HTMLButtonElement>) => <button {...props}>{children}</button>,
}))

vi.mock('@/components/ui/tooltip', () => ({
  TooltipProvider: ({ children }: { children: ReactNode }) => <>{children}</>,
  Tooltip: ({ children }: { children: ReactNode }) => <>{children}</>,
  TooltipTrigger: ({ children }: { children: ReactNode }) => <>{children}</>,
  TooltipContent: ({ children }: { children: ReactNode }) => <div>{children}</div>,
}))

vi.mock('@/components/ui/command', () => ({
  CommandShortcut: ({ children }: { children: ReactNode }) => <span>{children}</span>,
}))

vi.mock('@/components/ui/scroll-area', () => ({
  ScrollArea: ({ children, className }: { children: ReactNode; className?: string }) => <div className={className}>{children}</div>,
}))

vi.mock('@/components/ui/dropdown-menu', () => ({
  DropdownMenu: ({ children }: { children: ReactNode }) => <>{children}</>,
  DropdownMenuTrigger: ({ children }: { children: ReactNode }) => <>{children}</>,
  DropdownMenuContent: ({ children }: { children: ReactNode }) => <>{children}</>,
  DropdownMenuItem: ({ children, onClick }: { children: ReactNode; onClick?: () => void }) => <button onClick={onClick}>{children}</button>,
}))

vi.mock('@superone/ui/components/ui/context-menu', () => ({
  ContextMenu: ({ children }: { children: ReactNode }) => <>{children}</>,
  ContextMenuTrigger: ({ children }: { children: ReactNode }) => <>{children}</>,
  ContextMenuContent: ({ children }: { children: ReactNode }) => <>{children}</>,
  ContextMenuItem: ({ children, onClick }: { children: ReactNode; onClick?: () => void }) => <button onClick={onClick}>{children}</button>,
  ContextMenuSeparator: () => <hr />,
}))

vi.mock('@/components/ui/dialog', () => ({
  Dialog: ({ children }: { children: ReactNode }) => <>{children}</>,
  DialogContent: ({ children }: { children: ReactNode }) => <>{children}</>,
  DialogDescription: ({ children }: { children: ReactNode }) => <>{children}</>,
  DialogFooter: ({ children }: { children: ReactNode }) => <>{children}</>,
  DialogHeader: ({ children }: { children: ReactNode }) => <>{children}</>,
  DialogTitle: ({ children }: { children: ReactNode }) => <>{children}</>,
}))

vi.mock('@/components/ui/tabs', () => ({
  Tabs: ({ children }: { children: ReactNode }) => <>{children}</>,
  TabsList: ({ children }: { children: ReactNode }) => <>{children}</>,
  TabsTrigger: ({ children }: { children: ReactNode }) => <>{children}</>,
}))

beforeEach(() => {
  vi.clearAllMocks()
  appState.sidebarTab = 'sessions'
  appState.currentFolder = '/project-a'
  appState.recentFolders = [{ name: 'project-a', path: '/project-a', addedAt: '2026-03-02T00:00:00.000Z' }]
  sessionsByFolder = {
    '/project-a': [
      { sessionId: 'sid-1', title: 'Old Session', lastActiveAt: '2026-03-02T00:00:00.000Z', messageCount: 2 },
    ],
  }
  chatState.projectSessions = {
    '/project-a': {
      _activeSessionId: 'sid-1',
      _sessions: {
        'sid-1': {
          messages: [{ role: 'user', content: [{ type: 'text', text: 'hello' }] }],
          status: 'idle',
          pendingPermissions: [],
          pendingQuestion: null,
          pendingPlanApproval: null,
          awaitingAssistantReply: false,
          sessionProvider: 'claude',
          _worktreeBaseBranch: null,
        },
      },
      unseenCompletedSessions: new Set<string>(),
    },
  }
  ;(window as unknown as { app: unknown }).app = mockWindowApp
})

describe('AppSidebar interactions', () => {
  it('hides a normal session when clicking hide icon', async () => {
    const { AppSidebar } = await import('./AppSidebar')
    render(<AppSidebar />)

    fireEvent.click(screen.getByText('project-a'))
    await screen.findByText('Old Session')

    const title = screen.getByText('Old Session')
    const row = title.closest('.group\\/session') as HTMLElement
    const buttons = row.querySelectorAll('button')
    fireEvent.click(buttons[0] as HTMLButtonElement)

    await waitFor(() => {
      expect(mockWindowApp.hideSession).toHaveBeenCalledWith('sid-1', true)
    })
    await waitFor(() => {
      expect(screen.queryByText('Old Session')).toBeNull()
    })
  })

  it('shows collapsed live session when awaitingAssistantReply is true', async () => {
    const project = chatState.projectSessions['/project-a'] as {
      _activeSessionId: string
      _sessions: Record<string, unknown>
      unseenCompletedSessions: Set<string>
    }
    const session = project._sessions['sid-1'] as { awaitingAssistantReply: boolean }
    session.awaitingAssistantReply = true

    const { AppSidebar } = await import('./AppSidebar')
    render(<AppSidebar />)

    await screen.findByText('Old Session')
  })

  it('does not show a phantom New session for an unhydrated live session without user text', async () => {
    sessionsByFolder = {
      '/project-a': [],
    }
    chatState.projectSessions = {
      '/project-a': {
        _activeSessionId: 'sid-1',
        _sessions: {
          'sid-1': {
            messages: [{ role: 'user', content: [{ type: 'text', text: 'hello' }] }],
            status: 'idle',
            pendingPermissions: [],
            pendingQuestion: null,
            pendingPlanApproval: null,
            awaitingAssistantReply: false,
            sessionProvider: 'claude',
            _worktreeBaseBranch: null,
            _historyHydrated: true,
          },
          'sid-old': {
            messages: [{ role: 'assistant', content: [] }],
            status: 'streaming',
            pendingPermissions: [],
            pendingQuestion: null,
            pendingPlanApproval: null,
            awaitingAssistantReply: false,
            sessionProvider: 'claude',
            _worktreeBaseBranch: null,
            _historyHydrated: false,
          },
        },
        unseenCompletedSessions: new Set<string>(),
      },
    }

    const { AppSidebar } = await import('./AppSidebar')
    render(<AppSidebar />)

    await waitFor(() => {
      expect(mockWindowApp.listSessionsForFolderPage).toHaveBeenCalledWith('/project-a', 11, 0)
    })
    expect(screen.queryByText('New session')).toBeNull()
  })

  it('keeps session order after clicking another session in the same project', async () => {
    sessionsByFolder = {
      '/project-a': [
        { sessionId: 'sid-a', title: 'Session A', lastActiveAt: '2026-03-02T00:00:00.000Z', messageCount: 2 },
        { sessionId: 'sid-b', title: 'Session B', lastActiveAt: '2026-03-02T00:01:00.000Z', messageCount: 3 },
      ],
    }
    chatState.projectSessions = {
      '/project-a': {
        _activeSessionId: 'sid-a',
        _sessions: {
          'sid-a': {
            messages: [{ role: 'user', content: [{ type: 'text', text: 'a' }] }],
            status: 'idle',
            pendingPermissions: [],
            pendingQuestion: null,
            pendingPlanApproval: null,
            awaitingAssistantReply: false,
            sessionProvider: 'claude',
            _worktreeBaseBranch: null,
          },
          'sid-b': {
            messages: [{ role: 'user', content: [{ type: 'text', text: 'b' }] }],
            status: 'idle',
            pendingPermissions: [],
            pendingQuestion: null,
            pendingPlanApproval: null,
            awaitingAssistantReply: false,
            sessionProvider: 'claude',
            _worktreeBaseBranch: null,
          },
        },
        unseenCompletedSessions: new Set<string>(),
      },
    }

    const { AppSidebar } = await import('./AppSidebar')
    render(<AppSidebar />)

    fireEvent.click(screen.getByText('project-a'))
    await screen.findByText('Session A')
    await screen.findByText('Session B')

    const firstA = screen.getByText('Session A')
    const firstB = screen.getByText('Session B')
    expect(firstA.compareDocumentPosition(firstB) & Node.DOCUMENT_POSITION_FOLLOWING).not.toBe(0)

    fireEvent.click(firstB)
    await waitFor(() => {
      expect(chatState.switchSession).toHaveBeenCalledWith('sid-b')
    })

    const afterA = screen.getByText('Session A')
    const afterB = screen.getByText('Session B')
    expect(afterA.compareDocumentPosition(afterB) & Node.DOCUMENT_POSITION_FOLLOWING).not.toBe(0)
  })

  it('keeps showing a switched-away draft session while awaiting first reply', async () => {
    appState.currentFolder = '/project-b'
    appState.recentFolders = [
      { name: 'project-a', path: '/project-a', addedAt: '2026-03-02T00:00:00.000Z' },
      { name: 'project-b', path: '/project-b', addedAt: '2026-03-02T00:01:00.000Z' },
    ]
    sessionsByFolder = {
      '/project-a': [
        { sessionId: 'sid-1', title: 'Old Session', lastActiveAt: '2026-03-02T00:00:00.000Z', messageCount: 2 },
      ],
      '/project-b': [
        { sessionId: 'sid-b', title: 'Current Project Session', lastActiveAt: '2026-03-02T00:01:00.000Z', messageCount: 1 },
      ],
    }
    chatState.projectSessions = {
      '/project-a': {
        _activeSessionId: 'sid-1',
        _sessions: {
          'sid-1': {
            messages: [{ role: 'user', content: [{ type: 'text', text: 'old' }] }],
            status: 'idle',
            pendingPermissions: [],
            pendingQuestion: null,
            pendingPlanApproval: null,
            awaitingAssistantReply: false,
            sessionProvider: 'claude',
            _worktreeBaseBranch: null,
          },
          '__draft__': {
            messages: [{ role: 'user', content: [{ type: 'text', text: 'Pending first reply' }] }],
            status: 'idle',
            pendingPermissions: [],
            pendingQuestion: null,
            pendingPlanApproval: null,
            awaitingAssistantReply: true,
            sessionProvider: 'claude',
            _worktreeBaseBranch: null,
          },
        },
        unseenCompletedSessions: new Set<string>(),
      },
      '/project-b': {
        _activeSessionId: 'sid-b',
        _sessions: {
          'sid-b': {
            messages: [{ role: 'user', content: [{ type: 'text', text: 'current project' }] }],
            status: 'idle',
            pendingPermissions: [],
            pendingQuestion: null,
            pendingPlanApproval: null,
            awaitingAssistantReply: false,
            sessionProvider: 'claude',
            _worktreeBaseBranch: null,
          },
        },
        unseenCompletedSessions: new Set<string>(),
      },
    }

    const { AppSidebar } = await import('./AppSidebar')
    render(<AppSidebar />)

    await screen.findByText('Pending first reply')
  })

  it('does not prepend idle sessions from _sessions that are beyond the DB pagination limit', async () => {
    sessionsByFolder = {
      '/project-a': Array.from({ length: 10 }, (_, i) => ({
        sessionId: `sid-${i}`,
        title: `Session ${i}`,
        lastActiveAt: new Date(2026, 3, 7, 10 - i).toISOString(),
        messageCount: 2,
      })),
    }
    chatState.projectSessions = {
      '/project-a': {
        _activeSessionId: 'sid-0',
        _sessions: {
          'sid-0': {
            messages: [{ role: 'user', content: [{ type: 'text', text: 'current' }] }],
            status: 'streaming',
            pendingPermissions: [],
            pendingQuestion: null,
            pendingPlanApproval: null,
            awaitingAssistantReply: false,
            sessionProvider: 'claude',
            _worktreeBaseBranch: null,
          },
          'sid-old-beyond-page': {
            messages: [{ role: 'user', content: [{ type: 'text', text: 'old browsed session' }] }],
            status: 'idle',
            pendingPermissions: [],
            pendingQuestion: null,
            pendingPlanApproval: null,
            awaitingAssistantReply: false,
            sessionProvider: 'claude',
            _worktreeBaseBranch: null,
            _historyHydrated: true,
          },
        },
        unseenCompletedSessions: new Set<string>(),
      },
    }

    const { AppSidebar } = await import('./AppSidebar')
    render(<AppSidebar />)

    fireEvent.click(screen.getByText('project-a'))
    await screen.findByText('Session 0')

    expect(screen.queryByText('old browsed session')).toBeNull()
  })

  it('does not submit session rename while IME composition is active', async () => {
    const { AppSidebar } = await import('./AppSidebar')
    render(<AppSidebar />)

    fireEvent.click(screen.getByText('project-a'))
    await screen.findByText('Old Session')

    fireEvent.click(screen.getAllByText('Rename')[0] as HTMLButtonElement)

    const input = screen.getByDisplayValue('Old Session')
    fireEvent.change(input, { target: { value: '新标题' } })

    const composingEnter = createEvent.keyDown(input, { key: 'Enter' })
    Object.defineProperty(composingEnter, 'isComposing', { value: true })
    fireEvent(input, composingEnter)

    expect(mockWindowApp.renameSession).not.toHaveBeenCalled()

    fireEvent.keyDown(input, { key: 'Enter' })

    await waitFor(() => {
      expect(mockWindowApp.renameSession).toHaveBeenCalledWith('sid-1', '新标题')
    })
  })

  it('keeps project order stable when the store re-sorts after recent activity', async () => {
    appState.recentFolders = [
      { name: 'project-a', path: '/project-a', addedAt: '2026-03-01T00:00:00.000Z' },
      { name: 'project-b', path: '/project-b', addedAt: '2026-03-02T00:00:00.000Z' },
      { name: 'project-c', path: '/project-c', addedAt: '2026-03-03T00:00:00.000Z' },
    ]
    sessionsByFolder = { '/project-a': [], '/project-b': [], '/project-c': [] }
    chatState.projectSessions = {}

    const { AppSidebar } = await import('./AppSidebar')
    render(<AppSidebar />)

    appState.recentFolders = [
      { name: 'project-c', path: '/project-c', addedAt: '2026-03-03T00:00:00.000Z' },
      { name: 'project-a', path: '/project-a', addedAt: '2026-03-01T00:00:00.000Z' },
      { name: 'project-b', path: '/project-b', addedAt: '2026-03-02T00:00:00.000Z' },
    ]
    fireEvent.click(screen.getByText('project-a'))

    await waitFor(() => {
      const a = screen.getByText('project-a')
      const b = screen.getByText('project-b')
      const c = screen.getByText('project-c')
      expect(a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING).not.toBe(0)
      expect(b.compareDocumentPosition(c) & Node.DOCUMENT_POSITION_FOLLOWING).not.toBe(0)
    })
  })

  it('puts a newly added project at the top of the frozen recent order', async () => {
    appState.recentFolders = [
      { name: 'project-a', path: '/project-a', addedAt: '2026-03-01T00:00:00.000Z' },
      { name: 'project-b', path: '/project-b', addedAt: '2026-03-02T00:00:00.000Z' },
    ]
    sessionsByFolder = { '/project-a': [], '/project-b': [] }
    chatState.projectSessions = {}

    const { AppSidebar } = await import('./AppSidebar')
    render(<AppSidebar />)

    appState.recentFolders = [
      { name: 'project-c', path: '/project-c', addedAt: '2026-03-03T00:00:00.000Z' },
      { name: 'project-a', path: '/project-a', addedAt: '2026-03-01T00:00:00.000Z' },
      { name: 'project-b', path: '/project-b', addedAt: '2026-03-02T00:00:00.000Z' },
    ]
    fireEvent.click(screen.getByText('project-a'))

    await screen.findByText('project-c')

    const c = screen.getByText('project-c')
    const a = screen.getByText('project-a')
    const b = screen.getByText('project-b')
    expect(c.compareDocumentPosition(a) & Node.DOCUMENT_POSITION_FOLLOWING).not.toBe(0)
    expect(a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING).not.toBe(0)
  })
})
