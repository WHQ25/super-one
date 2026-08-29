/** @vitest-environment jsdom */

import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { ReactElement, ReactNode, ButtonHTMLAttributes } from 'react'

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
  // Forward className so plan body keeps `.chat-md` (CopyableMarkdown contract).
  Streamdown: ({ children, className }: { children?: ReactNode; className?: string }) => (
    <div data-testid="streamdown" className={className}>{children}</div>
  ),
}))
vi.mock('@streamdown/code', () => ({ createCodePlugin: () => ({}) }))
vi.mock('./CodeBlock', () => ({ createStreamdownCodeComponent: () => () => null }))
vi.mock('./chat-shared', () => ({
  streamdownLinkSafety: undefined,
  streamdownRehypePlugins: [],
  mathPlugin: {},
  // CopyableMarkdown — rendered by PlanLineReview — pulls these too
  streamdownPlugins: {},
  streamdownControls: {},
  streamdownComponents: {},
  getMathPluginSync: () => null,
  loadMathPlugin: () => Promise.resolve(null),
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
    harnessResources: { claude: null, codex: null, acp: null, opencode: null, cursor: null },
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

/** Shortcuts only fire while focus is inside [data-chat-root]. */
function renderInChat(ui: ReactElement) {
  const result = render(<div data-chat-root="" tabIndex={-1}>{ui}</div>)
  ;(result.container.querySelector('[data-chat-root]') as HTMLElement).focus()
  return result
}

beforeEach(() => {
  resetStore()
  vi.clearAllMocks()
  mockLocalStorage.clear()
})

describe('PlanApprovalPrompt — integration', () => {
  it('scenario: user in plan mode approves with Auto toggle → both IPCs fire and store reflects auto', () => {
    seedPlanApprovalState('plan')
    renderInChat(<PlanApprovalPrompt />)

    fireEvent.keyDown(window, { key: '1' })
    fireEvent.keyDown(window, { key: 'Enter' })

    expect(mockWindowAgent.respondToPlanApproval).toHaveBeenCalledWith(
      expect.any(String), 'plan-req-1', true, undefined,
    )
    expect(mockWindowAgent.setPermissionMode).toHaveBeenCalledWith('/proj', expect.any(String), 'auto')

    const session = activeSession()
    expect(session.permissionMode).toBe('auto')
    expect(session.pendingPlanApproval).toBeNull()
    expect(session.planApprovalOutcome).toEqual({ approved: true, feedback: undefined })
  })

  it('scenario: Shift+Tab shortcut approves with auto directly', () => {
    seedPlanApprovalState('plan')
    renderInChat(<PlanApprovalPrompt />)

    fireEvent.keyDown(window, { key: 'Tab', shiftKey: true })

    expect(mockWindowAgent.respondToPlanApproval).toHaveBeenCalledWith(
      expect.any(String), 'plan-req-1', true, undefined,
    )
    expect(mockWindowAgent.setPermissionMode).toHaveBeenCalledWith('/proj', expect.any(String), 'auto')
    expect(activeSession().permissionMode).toBe('auto')
  })

  it('scenario: user approves without acceptEdits toggle → setPermissionMode falls back to default', () => {
    seedPlanApprovalState('plan')
    renderInChat(<PlanApprovalPrompt />)

    fireEvent.keyDown(window, { key: 'Enter' })

    expect(mockWindowAgent.respondToPlanApproval).toHaveBeenCalledWith(
      expect.any(String), 'plan-req-1', true, undefined,
    )
    expect(mockWindowAgent.setPermissionMode).toHaveBeenCalledWith('/proj', expect.any(String), 'default')
    expect(activeSession().permissionMode).toBe('default')
  })

  it('scenario: user rejects plan → respondToPlanApproval(false) fires, setPermissionMode is NOT called, session stays in plan mode', () => {
    seedPlanApprovalState('plan')
    renderInChat(<PlanApprovalPrompt />)

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
    const { rerender, container } = renderInChat(<PlanApprovalPrompt />)

    fireEvent.keyDown(window, { key: '1' })
    rerender(<div data-chat-root="" tabIndex={-1}><PlanApprovalPrompt /></div>)
    ;(container.querySelector('[data-chat-root]') as HTMLElement).focus()
    fireEvent.keyDown(window, { key: 'Enter' })

    expect(mockWindowAgent.setPermissionMode).toHaveBeenCalledWith('/proj', expect.any(String), 'auto')
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
    renderInChat(<PlanApprovalPrompt />)

    fireEvent.keyDown(window, { key: '1' })
    fireEvent.keyDown(window, { key: 'Enter' })

    expect(mockWindowAgent.respondToPlanApproval).toHaveBeenCalledWith(
      expect.any(String), 'plan-req-1', true, undefined,
    )
    expect(mockWindowAgent.setPermissionMode).toHaveBeenCalledWith('/proj', expect.any(String), 'auto')
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
    renderInChat(<PlanApprovalPrompt />)

    fireEvent.keyDown(window, { key: 'Tab', shiftKey: true })

    expect(mockWindowAgent.setPermissionMode).toHaveBeenCalledWith('/proj', expect.any(String), 'auto')
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

  it('scenario: sticky line comment is serialized into reject feedback', async () => {
    seedPlanApprovalState('plan', { sessionProvider: 'claude' })
    render(<PlanApprovalPrompt />)

    // Plan body is rendered markdown (no data-plan-line gutter). Select text, open sticky, save.
    await waitFor(() => {
      expect(document.querySelector('.chat-md')).toBeTruthy()
    })
    const md = document.querySelector('.chat-md')!
    const walker = document.createTreeWalker(md, NodeFilter.SHOW_TEXT)
    let textNode: Text | null = null
    let n: Node | null
    while ((n = walker.nextNode())) {
      if ((n.textContent ?? '').includes('step A')) {
        textNode = n as Text
        break
      }
    }
    expect(textNode).toBeTruthy()
    const full = textNode!.textContent ?? ''
    const start = full.indexOf('step A')
    const range = document.createRange()
    range.setStart(textNode!, start)
    range.setEnd(textNode!, start + 'step A'.length)
    const sel = window.getSelection()!
    sel.removeAllRanges()
    sel.addRange(range)
    // Capture-phase mouseup on document opens sticky from selection (jsdom-safe fireEvent).
    fireEvent.mouseUp(document)

    const draft = await waitFor(() => {
      const el = document.querySelector('textarea[data-plan-draft]') as HTMLTextAreaElement | null
      expect(el).toBeTruthy()
      return el!
    })
    fireEvent.change(draft, { target: { value: 'make this async' } })
    // Sticky saves on ⌘/Ctrl+Enter (plain Enter is newline)
    fireEvent.keyDown(draft, { key: 'Enter', metaKey: true })

    // Blur/save may be async; reject once sticky is closed
    await waitFor(() => {
      expect(document.querySelector('textarea[data-plan-draft]')).toBeNull()
    })
    fireEvent.click(screen.getAllByRole('button', { name: /Reject|拒绝/ })[0])

    expect(mockWindowAgent.respondToPlanApproval).toHaveBeenCalledWith(
      expect.any(String),
      'plan-req-1',
      false,
      expect.stringMatching(/Proposed plan line|Comment:\nmake this async/),
    )
    const feedback = mockWindowAgent.respondToPlanApproval.mock.calls[0][3] as string
    expect(feedback).toContain('make this async')
    expect(feedback).toMatch(/step A/)
  })

  it('scenario: ACP approve with freeform sends follow-up user message, not feedback on wire', async () => {
    seedPlanApprovalState('plan', { sessionProvider: 'acp' })
    const sendSpy = vi.fn().mockResolvedValue(undefined)
    useChatStore.setState({ sendMessage: sendSpy })

    renderInChat(<PlanApprovalPrompt />)

    const inputs = screen.getAllByPlaceholderText(/Overall feedback|总体反馈/)
    fireEvent.change(inputs[0], { target: { value: 'ship after tests' } })
    // Approve path: focus must not stay on the feedback field (Enter there rejects).
    ;(document.querySelector('[data-chat-root]') as HTMLElement).focus()
    fireEvent.keyDown(window, { key: 'Enter' })

    expect(mockWindowAgent.respondToPlanApproval).toHaveBeenCalledWith(
      expect.any(String), 'plan-req-1', true, undefined,
    )
    // The follow-up is now addressed to the pane's own session; outside a
    // SessionScopeProvider that resolves to undefined (= the active session).
    expect(sendSpy).toHaveBeenCalledWith(
      expect.stringContaining('The user approved the plan with the following review comments:'),
      undefined,
      undefined,
      undefined,
      undefined,
    )
    expect(sendSpy.mock.calls[0][0]).toContain('ship after tests')
  })

  it('scenario: Claude approve does not send follow-up even if freeform was typed', () => {
    seedPlanApprovalState('plan', { sessionProvider: 'claude' })
    const sendSpy = vi.fn().mockResolvedValue(undefined)
    useChatStore.setState({ sendMessage: sendSpy })

    renderInChat(<PlanApprovalPrompt />)

    const inputs = screen.getAllByPlaceholderText(/Reject feedback|拒绝反馈/)
    fireEvent.change(inputs[0], { target: { value: 'ignore on approve' } })
    ;(document.querySelector('[data-chat-root]') as HTMLElement).focus()
    fireEvent.keyDown(window, { key: 'Enter' })

    expect(mockWindowAgent.respondToPlanApproval).toHaveBeenCalledWith(
      expect.any(String), 'plan-req-1', true, undefined,
    )
    expect(sendSpy).not.toHaveBeenCalled()
  })
})
