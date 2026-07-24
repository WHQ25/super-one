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
  getAppSettings: vi.fn().mockResolvedValue({
    analyticsEnabled: true,
    agentPreference: {
      claude: { defaultModel: '', defaultEffort: '', defaultPermissionMode: '', defaultSandboxMode: '' },
      codex: { defaultModel: '', defaultReasoningEffort: '', defaultPermissionPreset: '' },
    },
  }),
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
  PERMISSION_MODES: ['default', 'plan', 'auto', 'acceptEdits'],
}))

vi.mock('lucide-react', () => {
  const Stub = () => null
  return {
    PenLine: Stub, Check: Stub, X: Stub, FastForward: Stub, Zap: Stub,
    Circle: Stub, CheckCircle2: Stub, MessageSquarePlus: Stub, Trash2: Stub,
  }
})

const { useChatStore, createDefaultPerSessionState } = await import('@/stores/chat')
const { PlanApprovalPrompt } = await import('./PlanApprovalPrompt')

function resetStore() {
  useChatStore.setState({
    projectSessions: {},
    activeProject: null,
    harnessResources: { claude: null, codex: null, acp: null },
    initializedHarnesses: new Set(),
  })
}

function seedPlanApprovalState(
  initialMode: 'plan' | 'default' = 'plan',
  opts?: { selectedModel?: string; sessionProvider?: 'claude' | 'acp' | 'codex' | null },
) {
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
            selectedModel: opts?.selectedModel ?? '',
            sessionProvider: opts?.sessionProvider ?? 'claude',
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
      expect.any(String), 'plan-req-1', true, undefined,
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
      expect.any(String), 'plan-req-1', true, undefined,
    )
    expect(mockWindowAgent.setPermissionMode).toHaveBeenCalledWith('/proj', 'acceptEdits')
    expect(activeSession().permissionMode).toBe('acceptEdits')
  })

  it('scenario: user approves without acceptEdits toggle → setPermissionMode falls back to default', () => {
    seedPlanApprovalState('plan')
    render(<PlanApprovalPrompt />)

    fireEvent.keyDown(window, { key: 'Enter' })

    expect(mockWindowAgent.respondToPlanApproval).toHaveBeenCalledWith(
      expect.any(String), 'plan-req-1', true, undefined,
    )
    expect(mockWindowAgent.setPermissionMode).toHaveBeenCalledWith('/proj', 'default')
    expect(activeSession().permissionMode).toBe('default')
  })

  it('scenario: user rejects plan → respondToPlanApproval(false) fires, setPermissionMode is NOT called, session stays in plan mode', () => {
    seedPlanApprovalState('plan')
    render(<PlanApprovalPrompt />)

    fireEvent.keyDown(window, { key: 'Escape' })

    expect(mockWindowAgent.respondToPlanApproval).toHaveBeenCalledWith(
      expect.any(String), 'plan-req-1', false, undefined,
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

  it('scenario: account+model support auto mode → toggle switches post-approval mode to "auto"', () => {
    useChatStore.setState({
      harnessResources: {
        claude: {
          account: { subscriptionType: 'Claude Max', apiProvider: 'firstParty' },
          models: [
            {
              id: 'claude-opus-4-7',
              name: 'Claude Opus 4.7',
              description: '',
              supportsAutoMode: true,
            },
          ] as never[],
          slashCommands: [],
          skills: [],
          commands: [],
          agents: [],
          outputStyles: [],
        },
        codex: null,
        acp: null,
      },
    })
    seedPlanApprovalState('plan', { selectedModel: 'claude-opus-4-7' })
    render(<PlanApprovalPrompt />)

    fireEvent.keyDown(window, { key: '1' })
    fireEvent.keyDown(window, { key: 'Enter' })

    expect(mockWindowAgent.respondToPlanApproval).toHaveBeenCalledWith(
      expect.any(String), 'plan-req-1', true, undefined,
    )
    expect(mockWindowAgent.setPermissionMode).toHaveBeenCalledWith('/proj', 'auto')
    expect(activeSession().permissionMode).toBe('auto')
  })

  it('scenario: auto-supported session + Shift+Tab approves directly into auto mode', () => {
    useChatStore.setState({
      harnessResources: {
        claude: {
          account: { subscriptionType: 'Claude Max', apiProvider: 'firstParty' },
          models: [
            {
              id: 'claude-opus-4-7',
              name: 'Claude Opus 4.7',
              description: '',
              supportsAutoMode: true,
            },
          ] as never[],
          slashCommands: [],
          skills: [],
          commands: [],
          agents: [],
          outputStyles: [],
        },
        codex: null,
        acp: null,
      },
    })
    seedPlanApprovalState('plan', { selectedModel: 'claude-opus-4-7' })
    render(<PlanApprovalPrompt />)

    fireEvent.keyDown(window, { key: 'Tab', shiftKey: true })

    expect(mockWindowAgent.setPermissionMode).toHaveBeenCalledWith('/proj', 'auto')
    expect(activeSession().permissionMode).toBe('auto')
  })

  it('scenario: freeform feedback is included when rejecting (Claude)', () => {
    seedPlanApprovalState('plan', { sessionProvider: 'claude' })
    render(<PlanApprovalPrompt />)

    const inputs = screen.getAllByPlaceholderText(/Reject feedback|拒绝反馈/)
    fireEvent.change(inputs[0], { target: { value: 'add error handling' } })
    // Click Reject rather than Enter — Enter without feedback-focus approves.
    fireEvent.click(screen.getAllByRole('button', { name: /Reject|拒绝/ })[0])

    expect(mockWindowAgent.respondToPlanApproval).toHaveBeenCalledWith(
      expect.any(String), 'plan-req-1', false, 'add error handling',
    )
    expect(mockWindowAgent.setPermissionMode).not.toHaveBeenCalled()
  })

  it('scenario: line comment is serialized into reject feedback', () => {
    seedPlanApprovalState('plan', { sessionProvider: 'claude' })
    render(<PlanApprovalPrompt />)

    // Line 2 is "- step A" (1-based: # My plan, - step A, - step B)
    const line = document.querySelector('[data-plan-line="2"]')
    expect(line).toBeTruthy()
    fireEvent.mouseDown(line!)
    fireEvent.doubleClick(line!)

    const draft = screen.getByPlaceholderText(/comment on the selected|针对所选行/i)
    fireEvent.change(draft, { target: { value: 'make this async' } })
    fireEvent.keyDown(draft, { key: 'Enter' })

    fireEvent.keyDown(window, { key: 'Escape' })

    expect(mockWindowAgent.respondToPlanApproval).toHaveBeenCalledWith(
      expect.any(String),
      'plan-req-1',
      false,
      expect.stringContaining('Proposed plan line 2:'),
    )
    const feedback = mockWindowAgent.respondToPlanApproval.mock.calls[0][3] as string
    expect(feedback).toContain('> - step A')
    expect(feedback).toContain('Comment:\nmake this async')
  })

  it('scenario: ACP approve with freeform sends follow-up user message, not feedback on wire', async () => {
    seedPlanApprovalState('plan', { sessionProvider: 'acp' })
    const sendSpy = vi.fn().mockResolvedValue(undefined)
    useChatStore.setState({ sendMessage: sendSpy })

    render(<PlanApprovalPrompt />)

    const inputs = screen.getAllByPlaceholderText(/Overall feedback|总体反馈/)
    fireEvent.change(inputs[0], { target: { value: 'ship after tests' } })
    fireEvent.keyDown(window, { key: 'Enter' })

    expect(mockWindowAgent.respondToPlanApproval).toHaveBeenCalledWith(
      expect.any(String), 'plan-req-1', true, undefined,
    )
    expect(sendSpy).toHaveBeenCalledWith(
      expect.stringContaining('The user approved the plan with the following review comments:'),
    )
    expect(sendSpy.mock.calls[0][0]).toContain('ship after tests')
  })

  it('scenario: Claude approve does not send follow-up even if freeform was typed', () => {
    seedPlanApprovalState('plan', { sessionProvider: 'claude' })
    const sendSpy = vi.fn().mockResolvedValue(undefined)
    useChatStore.setState({ sendMessage: sendSpy })

    render(<PlanApprovalPrompt />)

    const inputs = screen.getAllByPlaceholderText(/Reject feedback|拒绝反馈/)
    fireEvent.change(inputs[0], { target: { value: 'ignore on approve' } })
    fireEvent.keyDown(window, { key: 'Enter' })

    expect(mockWindowAgent.respondToPlanApproval).toHaveBeenCalledWith(
      expect.any(String), 'plan-req-1', true, undefined,
    )
    expect(sendSpy).not.toHaveBeenCalled()
  })
})
