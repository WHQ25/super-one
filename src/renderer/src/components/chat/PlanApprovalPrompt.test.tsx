/** @vitest-environment jsdom */

import { fireEvent, render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { ReactNode, ButtonHTMLAttributes } from 'react'

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
  respondToPermission: vi.fn().mockResolvedValue(undefined),
  answerQuestion: vi.fn().mockResolvedValue(undefined),
  dismissQuestion: vi.fn().mockResolvedValue(undefined),
  respondToPlanApproval: vi.fn().mockResolvedValue(undefined),
  setPermissionMode: vi.fn().mockResolvedValue(undefined),
  prewarm: vi.fn().mockResolvedValue(undefined),
}

const mockWindowApp = {
  createSession: vi.fn().mockResolvedValue(undefined),
  saveSessionState: vi.fn().mockResolvedValue(undefined),
  loadSessionState: vi.fn().mockResolvedValue(null),
  pathExists: vi.fn().mockResolvedValue(true),
  resumeSession: vi.fn().mockResolvedValue(undefined),
  listSessionsForFolder: vi.fn().mockResolvedValue([]),
  getUserPreferences: vi.fn().mockResolvedValue({ outputStyle: '', defaultPermissionMode: '', defaultSandboxMode: '' }),
}

Object.defineProperty(window, 'agent', { value: mockWindowAgent, writable: true, configurable: true })
Object.defineProperty(window, 'app', { value: mockWindowApp, writable: true, configurable: true })
Object.defineProperty(window, 'localStorage', { value: mockLocalStorage, writable: true, configurable: true })
vi.stubGlobal('localStorage', mockLocalStorage)

vi.mock('streamdown', () => ({
  Streamdown: ({ children }: { children?: ReactNode }) => <div data-testid="streamdown">{children}</div>,
}))
vi.mock('@streamdown/code', () => ({ createCodePlugin: () => ({}) }))
vi.mock('./CodeBlock', () => ({ createStreamdownCodeComponent: () => () => null }))
vi.mock('./chat-shared', () => ({
  streamdownLinkSafety: undefined,
  streamdownRehypePlugins: [],
  mathPlugin: {},
}))
vi.mock('@/components/ui/button', () => ({
  Button: ({ children, ...props }: ButtonHTMLAttributes<HTMLButtonElement>) => <button {...props}>{children}</button>,
}))
vi.mock('@/components/ui/kbd', () => ({ Kbd: ({ children }: { children?: ReactNode }) => <span>{children}</span> }))
vi.mock('@/components/chat/PermissionModeList', () => ({
  PERMISSION_MODES: ['default', 'acceptEdits', 'auto', 'plan'],
}))

vi.mock('lucide-react', () => {
  const Stub = () => null
  return {
    PenLine: Stub, Check: Stub, X: Stub, FastForward: Stub,
    Circle: Stub, CheckCircle2: Stub,
  }
})

const { useChatStore, createDefaultPerSessionState } = await import('@/stores/chat')
const { PlanApprovalPrompt } = await import('./PlanApprovalPrompt')

function resetStore() {
  useChatStore.setState({
    projectSessions: {},
    activeProject: null,
    availableModels: [],
    account: {},
    globalSlashCommands: [],
    userSkills: [],
    userCommands: [],
    userAgents: [],
  })
}

function seedPlanApprovalState(initialMode: 'plan' | 'default' = 'plan') {
  useChatStore.getState().ensureSession('/proj')
  useChatStore.setState({ activeProject: '/proj' })
  const proj = useChatStore.getState().projectSessions['/proj']
  const sid = proj._activeSessionId!
  useChatStore.setState({
    projectSessions: {
      '/proj': {
        ...proj,
        _sessions: {
          [sid]: {
            ...createDefaultPerSessionState(),
            permissionMode: initialMode,
            pendingPlanApproval: {
              requestId: 'plan-req-1',
              planContent: '# My plan\n- step A\n- step B',
              planFilePath: '/proj/.plans/plan.md',
              allowedPrompts: [],
            },
          },
        },
      },
    },
  })
  return sid
}

function activeSession() {
  const state = useChatStore.getState()
  const proj = state.projectSessions[state.activeProject!]
  return proj._sessions[proj._activeSessionId!]
}

beforeEach(() => {
  resetStore()
  vi.clearAllMocks()
  mockLocalStorage.clear()
})

describe('PlanApprovalPrompt — integration', () => {
  it('scenario: user in plan mode approves with Accept Edits toggle → both IPCs fire and store reflects acceptEdits', () => {
    seedPlanApprovalState('plan')
    render(<PlanApprovalPrompt />)

    fireEvent.keyDown(window, { key: '1' })
    fireEvent.keyDown(window, { key: 'Enter' })

    expect(mockWindowAgent.respondToPlanApproval).toHaveBeenCalledWith(
      '/proj', 'plan-req-1', true, undefined, expect.any(String),
    )
    expect(mockWindowAgent.setPermissionMode).toHaveBeenCalledWith('/proj', 'acceptEdits')

    const session = activeSession()
    expect(session.permissionMode).toBe('acceptEdits')
    expect(session.pendingPlanApproval).toBeNull()
    expect(session.planApprovalOutcome).toEqual({ approved: true, feedback: undefined })
  })

  it('scenario: Shift+Tab shortcut approves with acceptEdits directly', () => {
    seedPlanApprovalState('plan')
    render(<PlanApprovalPrompt />)

    fireEvent.keyDown(window, { key: 'Tab', shiftKey: true })

    expect(mockWindowAgent.respondToPlanApproval).toHaveBeenCalledWith(
      '/proj', 'plan-req-1', true, undefined, expect.any(String),
    )
    expect(mockWindowAgent.setPermissionMode).toHaveBeenCalledWith('/proj', 'acceptEdits')
    expect(activeSession().permissionMode).toBe('acceptEdits')
  })

  it('scenario: user approves without acceptEdits toggle → setPermissionMode falls back to default', () => {
    seedPlanApprovalState('plan')
    render(<PlanApprovalPrompt />)

    fireEvent.keyDown(window, { key: 'Enter' })

    expect(mockWindowAgent.respondToPlanApproval).toHaveBeenCalledWith(
      '/proj', 'plan-req-1', true, undefined, expect.any(String),
    )
    expect(mockWindowAgent.setPermissionMode).toHaveBeenCalledWith('/proj', 'default')
    expect(activeSession().permissionMode).toBe('default')
  })

  it('scenario: user rejects plan → respondToPlanApproval(false) fires, setPermissionMode is NOT called, session stays in plan mode', () => {
    seedPlanApprovalState('plan')
    render(<PlanApprovalPrompt />)

    fireEvent.keyDown(window, { key: 'Escape' })

    expect(mockWindowAgent.respondToPlanApproval).toHaveBeenCalledWith(
      '/proj', 'plan-req-1', false, undefined, expect.any(String),
    )
    expect(mockWindowAgent.setPermissionMode).not.toHaveBeenCalled()
    const session = activeSession()
    expect(session.permissionMode).toBe('plan')
    expect(session.pendingPlanApproval).toBeNull()
    expect(session.planApprovalOutcome).toEqual({ approved: false, feedback: undefined })
  })

  it('scenario: toggle state persists across re-renders within one pending approval', () => {
    seedPlanApprovalState('plan')
    const { rerender } = render(<PlanApprovalPrompt />)

    fireEvent.keyDown(window, { key: '1' })
    rerender(<PlanApprovalPrompt />)
    fireEvent.keyDown(window, { key: 'Enter' })

    expect(mockWindowAgent.setPermissionMode).toHaveBeenCalledWith('/proj', 'acceptEdits')
  })
})
