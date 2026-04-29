/** @vitest-environment jsdom */

import { render, screen, act } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { ReactNode, ButtonHTMLAttributes } from 'react'
import type { AgentEvent } from '../../../../shared/agent-types'

const localStorageState = new Map<string, string>()
const mockLocalStorage = {
  getItem: vi.fn((key: string) => localStorageState.get(key) ?? null),
  setItem: vi.fn((key: string, value: string) => { localStorageState.set(key, value) }),
  removeItem: vi.fn((key: string) => { localStorageState.delete(key) }),
  clear: vi.fn(() => { localStorageState.clear() }),
}

vi.mock('@/stores/app', () => ({
  useAppStore: {
    getState: () => ({
      getWorktreeState: () => ({}),
      setActiveWorktree: vi.fn(),
      clearWorktree: vi.fn().mockResolvedValue(undefined),
    }),
  },
}))

const mockWindowAgent = {
  parkSession: vi.fn().mockResolvedValue(undefined),
  parkDraftSession: vi.fn().mockResolvedValue(undefined),
  resetSession: vi.fn().mockResolvedValue(undefined),
  activateSession: vi.fn().mockResolvedValue(undefined),
  getSessionId: vi.fn().mockResolvedValue(''),
  sendMessage: vi.fn().mockResolvedValue(undefined),
  readProjectAdditionalDirs: vi.fn().mockResolvedValue([]),
  respondToPermission: vi.fn().mockResolvedValue(true),
  answerQuestion: vi.fn().mockResolvedValue(undefined),
  dismissQuestion: vi.fn().mockResolvedValue(undefined),
  respondToPlanApproval: vi.fn().mockResolvedValue(undefined),
  setPermissionMode: vi.fn().mockResolvedValue(undefined),
  prewarm: vi.fn().mockResolvedValue(undefined),
}

const mockWindowApp = {
  trace: vi.fn(),
  createSession: vi.fn().mockResolvedValue(undefined),
  saveSessionState: vi.fn().mockResolvedValue(undefined),
  loadSessionState: vi.fn().mockResolvedValue(null),
  pathExists: vi.fn().mockResolvedValue(true),
  resumeSession: vi.fn().mockResolvedValue(undefined),
  listSessionsForFolder: vi.fn().mockResolvedValue([]),
  codexRun: vi.fn(),
  codexReview: vi.fn(),
  codexCompact: vi.fn(),
  codexListModels: vi.fn().mockResolvedValue([]),
  codexSteer: vi.fn().mockResolvedValue(undefined),
  codexPlanApproval: vi.fn().mockResolvedValue(undefined),
  codexCollaborationModeChange: vi.fn().mockResolvedValue(undefined),
  getAppSettings: vi.fn().mockResolvedValue({
    analyticsEnabled: true,
    agentPreference: {
      claude: { defaultModel: '', defaultEffort: '', defaultPermissionMode: '', defaultSandboxMode: '' },
      codex: { defaultModel: '', defaultReasoningEffort: '' },
    },
  }),
}

Object.defineProperty(window, 'agent', { value: mockWindowAgent, configurable: true })
Object.defineProperty(window, 'app', { value: mockWindowApp, configurable: true })
Object.defineProperty(window, 'localStorage', { value: mockLocalStorage, configurable: true })

vi.mock('@/components/ui/button', () => ({
  Button: ({ children, ...props }: ButtonHTMLAttributes<HTMLButtonElement>) => <button {...props}>{children}</button>,
}))
vi.mock('@/components/ui/kbd', () => ({
  Kbd: ({ children }: { children?: ReactNode }) => <span>{children}</span>,
}))
vi.mock('@/components/ui/tooltip', () => ({
  Tooltip: ({ children }: { children: ReactNode }) => <>{children}</>,
  TooltipContent: ({ children }: { children: ReactNode }) => <>{children}</>,
  TooltipProvider: ({ children }: { children: ReactNode }) => <>{children}</>,
  TooltipTrigger: ({ children }: { children: ReactNode }) => <>{children}</>,
}))
vi.mock('./ToolIcon', () => ({ ToolIcon: () => <span>icon</span> }))
vi.mock('./tool-display', () => ({
  getToolDisplay: () => ({ icon: 'terminal', summary: 'ls' }),
  extractPartialToolInput: () => ({}),
  parseMcpToolName: (name: string) => {
    const m = name.match(/^mcp__(.+?)__(.+)$/)
    return m ? { serverName: m[1], mcpToolName: m[2] } : null
  },
}))
vi.mock('./ToolBlock', () => ({ EditDiff: () => <span>edit-diff</span>, WriteDiff: () => <span>write-diff</span> }))
vi.mock('./PermissionModeSelector', () => ({ modes: [] }))
vi.mock('@/stores/miniapp', () => ({
  useMiniAppStore: (selector: (s: { apps: Array<{ id: string; manifest: Record<string, unknown> }> }) => unknown) =>
    selector({ apps: [] }),
}))
vi.mock('@/components/miniapp/MiniAppIcon', () => ({ MiniAppIcon: () => <span>app-icon</span> }))
vi.mock('lucide-react', async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>()
  const stubs: Record<string, () => null> = {}
  for (const key of Object.keys(actual)) {
    stubs[key] = () => null
  }
  return stubs
})

const { useChatStore, createDefaultPerSessionState } = await import('@/stores/chat')
const { PermissionPrompt } = await import('./PermissionPrompt')

function seedProjectWithActiveSession(projectPath: string, activeSid: string) {
  useChatStore.getState().ensureSession(projectPath)
  useChatStore.setState((s) => {
    const proj = s.projectSessions[projectPath]
    return {
      activeProject: projectPath,
      projectSessions: {
        ...s.projectSessions,
        [projectPath]: {
          ...proj,
          _activeSessionId: activeSid,
          _sessions: {
            [activeSid]: { ...createDefaultPerSessionState(), cwd: projectPath, status: 'streaming' as const },
          },
        },
      },
    }
  })
}

function firePermissionRequest(sessionId: string | undefined, requestId = 'r1') {
  const event: AgentEvent = {
    type: 'permission_request',
    projectPath: '/proj',
    sessionId,
    request: {
      requestId,
      toolName: 'Edit',
      input: { file_path: '/proj/foo.ts' },
      allowAlwaysAllow: false,
    },
  } as never
  act(() => {
    useChatStore.getState().handleAgentEvent(event)
  })
}

beforeEach(() => {
  useChatStore.setState({ projectSessions: {}, activeProject: null, remoteSessions: {} })
  vi.clearAllMocks()
})

describe('PermissionPrompt + real store integration', () => {
  it('renders a prompt when permission_request matches the active session id', () => {
    seedProjectWithActiveSession('/proj', 'alpha')
    firePermissionRequest('alpha')

    render(<PermissionPrompt />)

    expect(screen.queryByText('Edit')).not.toBeNull()
  })

  it('renders nothing when permission_request carries an unknown sessionId (drift scenario)', () => {
    seedProjectWithActiveSession('/proj', 'alpha')
    firePermissionRequest('beta')

    const { container } = render(<PermissionPrompt />)

    expect(container.textContent).toBe('')
    const proj = useChatStore.getState().projectSessions['/proj']
    expect(proj._sessions['alpha'].pendingPermissions).toHaveLength(0)
    expect(proj._sessions['beta']?.pendingPermissions).toHaveLength(1)
  })

  it('renders a prompt when permission_request has no sessionId and falls back to active', () => {
    seedProjectWithActiveSession('/proj', 'alpha')
    firePermissionRequest(undefined)

    render(<PermissionPrompt />)

    expect(screen.queryByText('Edit')).not.toBeNull()
  })

  it('clears the prompt DOM after message_interrupted targets the active session', () => {
    seedProjectWithActiveSession('/proj', 'alpha')
    firePermissionRequest('alpha')

    const { container, rerender } = render(<PermissionPrompt />)
    expect(container.textContent).not.toBe('')

    act(() => {
      useChatStore.getState().handleAgentEvent({
        type: 'message_interrupted',
        projectPath: '/proj',
        sessionId: 'alpha',
        messageId: 'msg-a',
      } as never)
    })
    rerender(<PermissionPrompt />)

    expect(container.textContent).toBe('')
  })

  it('leaves the active-session prompt intact when message_interrupted targets a different session', () => {
    seedProjectWithActiveSession('/proj', 'alpha')
    firePermissionRequest('alpha')

    const { container, rerender } = render(<PermissionPrompt />)
    expect(container.textContent).not.toBe('')

    act(() => {
      useChatStore.getState().handleAgentEvent({
        type: 'message_interrupted',
        projectPath: '/proj',
        sessionId: 'beta',
        messageId: 'msg-b',
      } as never)
    })
    rerender(<PermissionPrompt />)

    expect(container.textContent).not.toBe('')
  })
})
