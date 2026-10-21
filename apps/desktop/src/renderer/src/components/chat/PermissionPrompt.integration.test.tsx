/** @vitest-environment jsdom */

import { render, screen, act, fireEvent, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { ReactNode, ButtonHTMLAttributes } from 'react'
import type { AgentEvent } from '@superone/shared/agent-types'
import { elicitationFormRequest } from '@superone/shared/schema-form'

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
      clearWorktreeMirror: vi.fn(),
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
  prewarm: vi.fn().mockResolvedValue(undefined),
}

const mockWindowApp = {
  trace: vi.fn(),
  createSession: vi.fn().mockResolvedValue(undefined),
  saveSessionState: vi.fn().mockResolvedValue(undefined),
  worktreeExists: vi.fn().mockResolvedValue(true),
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
      codex: { defaultModel: '', defaultReasoningEffort: '', defaultPermissionPreset: '' },
    },
  }),
}

/** Answers and mode changes reach the session's host; `/proj` is a plain path, so `local`. */
const mockWindowEnvironment = {
  respondSessionPermission: vi.fn().mockResolvedValue(undefined),
  patchSessionSettings: vi.fn().mockResolvedValue({}),
}

Object.defineProperty(window, 'agent', { value: mockWindowAgent, configurable: true })
Object.assign(window.environment, mockWindowEnvironment)
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
vi.mock('./tool-display', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  getToolDisplay: () => ({ icon: 'terminal', summary: 'ls' }),
  extractPartialToolInput: () => ({}),
  parseMcpToolName: (name: string) => {
    const m = name.match(/^mcp__(.+?)__(.+)$/)
    return m ? { serverName: m[1], mcpToolName: m[2] } : null
  },
}))
vi.mock('./ToolBlock', () => ({ EditDiff: () => <span>edit-diff</span>, WriteDiff: () => <span>write-diff</span> }))
vi.mock('./PermissionModeSelector', () => ({ modes: [], PermissionModeSelector: () => null }))
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
            [activeSid]: { ...createDefaultPerSessionState(), cwd: projectPath, status: 'streaming' as const, hostSessionOwned: true },
          },
        },
      },
    }
  })
}

function firePermissionRequest(
  sessionId: string | undefined,
  requestId = 'r1',
  suggestions?: Array<Record<string, unknown>>,
) {
  const event: AgentEvent = {
    type: 'permission_request',
    projectPath: '/proj',
    sessionId,
    request: {
      requestId,
      toolName: 'Edit',
      input: { file_path: '/proj/foo.ts' },
      allowAlwaysAllow: false,
      suggestions,
    },
  } as never
  act(() => {
    useChatStore.getState().handleAgentEvent(event)
  })
}

function enableAutoMode(sessionId: string) {
  useChatStore.setState((s) => ({
    harnessResources: {
      ...s.harnessResources,
      claude: {
        models: [{ id: 'opus', supportsAutoMode: true }],
        account: { subscriptionType: 'Claude Max', apiProvider: 'firstParty' },
      },
    } as never,
  }))
  useChatStore.setState((s) => {
    const proj = s.projectSessions['/proj']
    return {
      projectSessions: {
        ...s.projectSessions,
        '/proj': {
          ...proj,
          _sessions: {
            ...proj._sessions,
            [sessionId]: { ...proj._sessions[sessionId], selectedModel: 'opus' },
          },
        },
      },
    }
  })
}

beforeEach(() => {
  useChatStore.setState({ projectSessions: {}, activeProject: null, remoteSessions: {} })
  useChatStore.setState((s) => ({ harnessResources: { ...s.harnessResources, claude: null } }))
  vi.clearAllMocks()
})

describe('PermissionPrompt + real store integration', () => {
  it('shows semantic directory scope by default and keeps protocol context behind technical details', async () => {
    seedProjectWithActiveSession('/proj', 'alpha')
    act(() => useChatStore.getState().handleAgentEvent({
      type: 'permission_request', projectPath: '/proj', sessionId: 'alpha', request: {
        requestId: 'per_external', toolName: 'external_directory', toolUseId: 'call_read', input: {}, allowAlwaysAllow: false,
        permissionDetails: { action: 'external_directory', resources: ['/outside/reference/*', '/outside/second/*'], save: ['/outside/*'],
          metadata: { reason: 'Inspect the reference implementation' },
          source: { toolName: 'read', toolUseId: 'call_read', messageId: 'msg_a', input: { path: '/outside/reference/spec.md', limit: 200 } },
        },
      },
    }))
    render(<PermissionPrompt />)
    expect(screen.getAllByText(/\/outside\/reference\/\*\s+\/outside\/second\/\*/)[0]).toBeVisible()
    expect(screen.getByText('Access External Directory /outside/reference')).toBeVisible()
    expect(screen.queryByText('read · call_read · msg_a')).toBeNull()
    expect(screen.queryByRole('button', { name: /remember for this project/i })).toBeNull()
    fireEvent.click(screen.getByText('Technical Details'))
    await screen.findByText('read · call_read · msg_a')
    expect(screen.getByText('/outside/*')).toBeVisible()
    expect(screen.getByText(/"path": "\/outside\/reference\/spec.md"/)).toBeVisible()
    expect(screen.getByText(/"limit": 200/)).toBeVisible()
    expect(screen.getByText(/Inspect the reference implementation/)).toBeVisible()
    expect(screen.getByText('read · call_read · msg_a')).toBeVisible()
    fireEvent.click(screen.getByText('Access External Directory /outside/reference'))
    expect(screen.getAllByText(/\/outside\/reference\/\*\s+\/outside\/second\/\*/)[0]).toBeVisible()
    fireEvent.click(screen.getByText('Access External Directory /outside/reference'))
    await act(async () => { fireEvent.click(screen.getByText('Allow Once')) })
    expect(mockWindowEnvironment.respondSessionPermission).toHaveBeenCalledWith('local', { sessionId: 'alpha', interactionId: 'per_external', decision: 'allow' })
  })

  it('previews proposed project rules before saving, and cancel does not approve or reject', async () => {
    seedProjectWithActiveSession('/proj', 'alpha')
    act(() => useChatStore.getState().handleAgentEvent({ type: 'permission_request', projectPath: '/proj', sessionId: 'alpha', request: {
      requestId: 'per_remember', toolName: 'external_directory', input: {}, allowAlwaysAllow: true, supportsAlwaysPersist: true,
      permissionDetails: { action: 'external_directory', resources: ['/outside/reference/*'], save: ['/outside/*'] },
    } }))
    render(<PermissionPrompt />)
    expect(screen.getByRole('button', { name: /allow once/i })).toBeVisible()
    fireEvent.click(screen.getByRole('button', { name: /remember for this project/i }))
    expect(screen.getByText('Remember Permission in This Project?')).toBeVisible()
    expect(screen.getByText('/outside/*')).toBeVisible()
    expect(screen.getByText(/including new sessions and restarts/)).toBeVisible()
    expect(mockWindowEnvironment.respondSessionPermission).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: /cancel/i }))
    expect(mockWindowEnvironment.respondSessionPermission).not.toHaveBeenCalled()
    expect(screen.getByRole('button', { name: /allow once/i })).toBeVisible()
    fireEvent.click(screen.getByRole('button', { name: /remember for this project/i }))
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: /confirm & remember/i })) })
    expect(mockWindowEnvironment.respondSessionPermission).toHaveBeenCalledWith('local', { sessionId: 'alpha', interactionId: 'per_remember', decision: 'allow_always' })
  })

  it('shows the permission message even when a generic tool has no display summary', () => {
    seedProjectWithActiveSession('/proj', 'alpha')
    act(() => useChatStore.getState().handleAgentEvent({ type: 'permission_request', projectPath: '/proj', sessionId: 'alpha', request: {
      requestId: 'per_legacy', toolName: 'external_directory', input: {}, allowAlwaysAllow: false,
      message: '/outside/legacy-directory/*',
    } }))
    render(<PermissionPrompt />)
    expect(screen.getByText('/outside/legacy-directory/*')).toBeVisible()
  })

  it('binds the local Codex form picker and preview to the active permission request', async () => {
    seedProjectWithActiveSession('/proj', 'alpha')
    useChatStore.setState(state => ({ projectSessions: { ...state.projectSessions, '/proj': { ...state.projectSessions['/proj'], _sessions: {
      ...state.projectSessions['/proj']._sessions, alpha: { ...state.projectSessions['/proj']._sessions.alpha, sessionProvider: 'codex' },
    } } } }))
    const original = window.environment
    const pick = vi.fn(async () => ({ ok: true as const, value: [{ uri: 'file:///picked.stl', name: 'picked.stl' }] }))
    const preview = vi.fn(async () => ({ ok: true as const, value: { contents: [{ uri: 'cad://preview', text: 'part details' }] } }))
    Object.defineProperty(window, 'environment', { configurable: true, value: { ...original, mcpFormPickResources: pick, mcpFormPreviewResource: preview } })
    try {
      act(() => useChatStore.getState().handleAgentEvent({ type: 'permission_request', projectPath: '/proj', sessionId: 'alpha', request: {
        requestId: 'native-form', requestKind: 'mcp_elicitation', serverName: 'bits', toolName: 'bits', input: {}, allowAlwaysAllow: false,
        ...elicitationFormRequest({ type: 'object', properties: { part: { type: 'string', format: 'uri', 'x-openai-input': {
          type: 'resource', userOptions: {}, options: [{ uri: 'cad://part', name: 'part.stl', _meta: { 'openai/preview': { target: { type: 'resource_link', uri: 'cad://preview', name: 'preview' } } } }],
        } } } }, { userResources: true }),
      } }))
      render(<PermissionPrompt />)
      fireEvent.click(screen.getByRole('button', { name: 'Preview part.stl' }))
      await screen.findByText('part details')
      expect(preview).toHaveBeenCalledWith('alpha', 'native-form', 'part', 'cad://part')
      fireEvent.click(screen.getByRole('button', { name: 'Add files…' }))
      await screen.findByRole('radio', { name: /picked.stl/ })
      expect(pick).toHaveBeenCalledWith('alpha', 'native-form', 'part')
      fireEvent.click(screen.getByRole('button', { name: /^Submit/ }))
      await waitFor(() => expect(mockWindowEnvironment.respondSessionPermission).toHaveBeenCalledWith('local', { sessionId: 'alpha', interactionId: 'native-form', decision: 'allow', formAnswers: { part: 'file:///picked.stl' } }))
    } finally { Object.defineProperty(window, 'environment', { configurable: true, value: original }) }
  })
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

  it('collapses the prompt when the header (not just the chevron) is clicked', () => {
    seedProjectWithActiveSession('/proj', 'alpha')
    firePermissionRequest('alpha')

    render(<PermissionPrompt />)
    expect(screen.queryByText('write-diff')).toBeNull()
    expect(screen.queryByText('edit-diff')).not.toBeNull()

    fireEvent.click(screen.getByText('Edit'))

    expect(screen.queryByText('edit-diff')).toBeNull()
  })

  it('upgrades an acceptEdits setMode suggestion to auto when the account supports auto mode', async () => {
    seedProjectWithActiveSession('/proj', 'alpha')
    enableAutoMode('alpha')
    firePermissionRequest('alpha', 'r1', [{ type: 'setMode', mode: 'acceptEdits', destination: 'session' }])

    render(<PermissionPrompt />)

    const suggestionBtn = screen.getByText(/Switch to auto/).closest('button')!
    fireEvent.click(suggestionBtn)
    await act(async () => {
      fireEvent.click(screen.getByText('Allow'))
      await Promise.resolve()
    })

    expect(mockWindowEnvironment.respondSessionPermission).toHaveBeenCalledWith(
      'local', { sessionId: expect.any(String), interactionId: 'r1', decision: 'allow' },
    )
    expect(mockWindowEnvironment.patchSessionSettings).toHaveBeenCalledWith('local', 'alpha', { permissionMode: 'auto' })
  })

  it('upgrades acceptEdits setMode suggestions to auto even without account/model metadata', async () => {
    // SuperOne no longer client-gates Auto Mode (remote has no subscription
    // account; Pro/Max/Team all get Auto from Anthropic). Always prefer auto.
    seedProjectWithActiveSession('/proj', 'alpha')
    firePermissionRequest('alpha', 'r1', [{ type: 'setMode', mode: 'acceptEdits', destination: 'session' }])

    render(<PermissionPrompt />)

    const suggestionBtn = screen.getByText(/Switch to auto/).closest('button')!
    fireEvent.click(suggestionBtn)
    await act(async () => {
      fireEvent.click(screen.getByText('Allow'))
      await Promise.resolve()
    })

    expect(mockWindowEnvironment.respondSessionPermission).toHaveBeenCalledWith(
      'local', { sessionId: expect.any(String), interactionId: 'r1', decision: 'allow' },
    )
    expect(mockWindowEnvironment.patchSessionSettings).toHaveBeenCalledWith('local', 'alpha', { permissionMode: 'auto' })
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
