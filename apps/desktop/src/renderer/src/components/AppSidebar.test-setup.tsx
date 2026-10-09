/** @vitest-environment jsdom */

import { beforeAll, beforeEach, vi } from 'vitest'
import { useSyncExternalStore, type HTMLAttributes, type ReactNode } from 'react'
import type { PinnedSessionEntry } from '@superone/shared/agent-types'
import type { EnvironmentListItem } from '@superone/shared/environment'

export const sessionFixtures = { byFolder: {} as Record<string, Array<{ sessionId: string; title: string; lastActiveAt: string; messageCount: number; isHidden?: boolean; parentSessionId?: string }>> }

export const appState = {
  sidebarTab: 'sessions',
  currentFolder: '/project-a' as string | null,
  recentFolders: [{ name: 'project-a', path: '/project-a', addedAt: '2026-03-02T00:00:00.000Z' }],
  // The sidebar lists local projects only while this host is selected.
  selectedHostConnectionId: 'local',
  setSelectedHostConnectionId: vi.fn(),
  fetchRecentFolders: vi.fn(async () => {}),
  setShowSidebar: vi.fn(),
  navigateTo: vi.fn(),
  selectProject: vi.fn(async () => {}),
  removeRecentFolder: vi.fn(async () => {}),
  setSidebarTab: vi.fn((tab: 'sessions' | 'files') => { appState.sidebarTab = tab }),
  setSettingsTab: vi.fn(),
  experimentalRemoteNodesEnabled: false,
}

let chatVersion = 0
const chatListeners = new Set<() => void>()
export function notifyChat() { chatVersion++; chatListeners.forEach((notify) => notify()) }

export const chatState = {
  activeProject: '/project-a' as string | null,
  resetSession: vi.fn(),
  fetchSessions: vi.fn(),
  removeSessionFromMemory: vi.fn(),
  switchSession: vi.fn(async (_sessionId: string) => {}),
  projectSessions: {} as Record<string, unknown>,
  remoteSessions: {} as Record<string, string[]>,
  agentTitles: {} as Record<string, string>,
  harnessResources: {} as Record<string, unknown>,
}

export const mockWindowApp = {
  listSessionsForFolder: vi.fn(async (folderPath: string) => sessionFixtures.byFolder[folderPath] ?? []),
  listSessionsForFolderPage: vi.fn(async (folderPath: string, limit: number, offset: number) => (sessionFixtures.byFolder[folderPath] ?? []).slice(offset, offset + limit)),
  onSessionChanged: vi.fn((_callback: () => void) => () => {}),
  hideSession: vi.fn(async (sessionId: string, hidden: boolean) => {
    sessionFixtures.byFolder = Object.fromEntries(
      Object.entries(sessionFixtures.byFolder).map(([folderPath, rows]) => [
        folderPath,
        rows.map((row) => row.sessionId === sessionId ? { ...row, isHidden: hidden } : row),
      ]),
    )
  }),
  pinSession: vi.fn(async () => {}),
  deleteSession: vi.fn(async () => {}),
  renameSession: vi.fn(async () => {}),
  listAutomations: vi.fn(async () => []),
  onAutomationsChanged: vi.fn(() => () => {}),
  onAutomationEvent: vi.fn(() => () => {}),
  getAppSettings: vi.fn(async () => ({ miniAppOrder: {} })),
  getMediaServerPort: vi.fn(async () => 0),
  listScheduledSends: vi.fn(async () => []),
  onScheduledSendChanged: vi.fn(() => () => {}),
}

export const mockEnvironment = {
  // Partial of the real type rather than a hand-written shape: these fixtures
  // set only the fields a case exercises, but field names and value types are
  // still checked against what the sidebar actually receives.
  listItems: vi.fn(async (): Promise<Array<Partial<EnvironmentListItem>>> => []),
  onStatusEvent: vi.fn(() => () => {}),
  connect: vi.fn(async () => {}),
  upgradeNode: vi.fn(async () => ({ version: '0.50.3-alpha', warnings: [] as string[] })),
  listProjects: vi.fn(async (): Promise<Array<{
    projectId: string
    path: string
    name: string
    lastActiveAt?: number
    missing?: boolean
  }>> => []),
  listSessions: vi.fn(async (
    _connectionId: string,
    projectId: string,
    options?: { limit?: number; offset?: number },
  ) => {
    // Local Environment API passes folder path as projectId during migration.
    const rows = sessionFixtures.byFolder[projectId] ?? []
    if (options?.limit != null) {
      const offset = options.offset ?? 0
      return rows.slice(offset, offset + options.limit)
    }
    const offset = options?.offset ?? 0
    return offset > 0 ? rows.slice(offset) : rows
  }),
  listPinnedSessions: vi.fn(
    async (_connectionId: string): Promise<PinnedSessionEntry[]> => [],
  ),
  listDrafts: vi.fn(async () => []),
  upsertDraft: vi.fn(async (draft: { id: string }) => draft),
  deleteDraft: vi.fn(async () => {}),
}

export const toastWarning = vi.fn()
export const toastSuccess = vi.fn()
export const toastError = vi.fn()
vi.mock('sonner', () => ({
  toast: {
    warning: (...args: unknown[]) => toastWarning(...args),
    success: (...args: unknown[]) => toastSuccess(...args),
    error: (...args: unknown[]) => toastError(...args),
    loading: () => 'toast-id',
  },
}))

vi.mock('motion/react', () => ({
  AnimatePresence: ({ children }: { children: ReactNode }) => <>{children}</>,
  motion: {
    div: ({ children, ...props }: HTMLAttributes<HTMLDivElement>) => <div {...props}>{children}</div>,
    span: ({ children, ...props }: HTMLAttributes<HTMLSpanElement>) => <span {...props}>{children}</span>,
  },
}))

vi.mock('@/stores/app', () => ({
  useAppStore: Object.assign((selector: (state: typeof appState) => unknown) => selector(appState), { setState: vi.fn(), getState: () => appState }),
  useHasRealProject: () => true,
}))

vi.mock('@/stores/chat', () => ({
  useChatStore: Object.assign(
    (selector: (state: typeof chatState) => unknown) => {
      useSyncExternalStore((notify) => {
        chatListeners.add(notify)
        return () => { chatListeners.delete(notify) }
      }, () => chatVersion)
      return selector(chatState)
    },
    { getState: () => chatState },
  ),
  useActiveSession: (selector: (s: Record<string, unknown>) => unknown) => selector({}),
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
  useMiniAppStore: (selector: (s: Record<string, unknown>) => unknown) => selector({ fetchApps: vi.fn(), apps: [], hosts: [] }),
}))

vi.mock('@/hooks/useFullscreen', () => ({
  useFullscreen: () => false,
}))

vi.mock('@/hooks/useTheme', () => ({
  useTheme: () => ({ mode: 'light', dark: false, setMode: vi.fn() }),
}))

vi.mock('@/components/sidebar/FileTree', () => ({
  FileTree: () => <div>FileTree</div>,
}))

vi.mock('@/components/AdaptiveContextMenu', () => ({
  AdaptiveContextMenu: ({ items, children }: { items: Array<{ kind: string; id?: string; label?: string; onSelect?: () => void }>; children: ReactNode }) => (
    <>
      {children}
      {items.filter((i) => i.kind === 'item').map((i) => (
        <button key={i.id} onClick={i.onSelect}>{i.label}</button>
      ))}
    </>
  ),
}))

vi.mock('@/components/sidebar/BrandColorPopover', () => ({
  BrandColorPopover: () => null,
}))

vi.mock('@/components/sidebar/AnimatedSessionTitle', () => ({
  SessionTitleAnimated: ({ fallback, className }: { fallback: string; className?: string }) => <span className={className}>{fallback}</span>,
  useSessionTitleByAgent: (_sessionId: string | null | undefined, fallback: string | null | undefined) => fallback ?? '',
}))

vi.mock('@superone/ui/components/ui/context-menu', () => ({
  ContextMenu: ({ children }: { children: ReactNode }) => <>{children}</>,
  ContextMenuTrigger: ({ children }: { children: ReactNode }) => <>{children}</>,
  ContextMenuContent: ({ children }: { children: ReactNode }) => <>{children}</>,
  ContextMenuItem: ({ children, onClick }: { children: ReactNode; onClick?: () => void }) => <button onClick={onClick}>{children}</button>,
  ContextMenuSeparator: () => <hr />,
}))

vi.mock('@/components/sidebar/add-project/AddProjectDialog', () => ({
  AddProjectDialog: () => null,
}))
vi.mock('@/components/sidebar/AppDrawer', () => ({
  AppDrawer: () => null,
}))
vi.mock('@/components/sidebar/DraftsSection', () => ({
  DraftsSection: () => null,
}))
vi.mock('@/components/sidebar/MiniAppHostGroup', () => ({
  MiniAppHostGroup: () => null,
}))
vi.mock('@/components/sidebar/ProjectHistoryList', () => ({
  ProjectHistoryList: () => null,
}))
vi.mock('@/components/AutomationDialog', () => ({
  AutomationDialog: () => null,
}))
vi.mock('@/components/UsageStatusIcon', () => ({
  UsageStatusIcon: () => null,
}))
vi.mock('@/components/UpdateStatusIcon', () => ({
  UpdateStatusIcon: () => null,
}))
vi.mock('@/components/coding/LayoutToggle', () => ({
  LayoutToggle: () => null,
}))
vi.mock('@/components/mosaic/mosaic-store', () => ({
  useMosaicStore: Object.assign(() => ({ mode: 'single' }), {
    getState: () => ({ focusOrReplaceFocused: () => false }),
  }),
}))

// AppSidebar pulls the real @superone/ui (radix) graph, so a cold-start
// transform is multi-second; warm once so individual cases stay under the
// default 5s timeout. The budget is generous because the full suite runs 600+
// files concurrently and this import competes for CPU with every other jsdom
// environment — 15s was tight enough to flake there while passing in isolation.
beforeAll(async () => {
  await import('./AppSidebar')
}, 60_000)

beforeEach(() => {
  vi.clearAllMocks()
  mockWindowApp.onSessionChanged.mockImplementation(() => () => {})
  chatState.switchSession.mockImplementation(async () => {})
  mockEnvironment.listPinnedSessions.mockResolvedValue([])
  appState.sidebarTab = 'sessions'
  appState.currentFolder = '/project-a'
  appState.recentFolders = [{ name: 'project-a', path: '/project-a', addedAt: '2026-03-02T00:00:00.000Z' }]
  appState.selectedHostConnectionId = 'local'
  appState.experimentalRemoteNodesEnabled = false
  chatState.activeProject = '/project-a'
  sessionFixtures.byFolder = {
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
          _gitBranch: null,
        },
      },
      unseenCompletedSessions: new Set<string>(),
    },
  }
  ;(window as unknown as { app: unknown }).app = mockWindowApp
  ;(window as unknown as { environment: unknown }).environment = mockEnvironment
})
