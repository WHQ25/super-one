/** @vitest-environment jsdom */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { AgentEvent, ChatMessage } from '../../../shared/agent-types'

const mockSetActiveWorktree = vi.fn()
const mockClearWorktree = vi.fn().mockResolvedValue(undefined)
const localStorageState = new Map<string, string>()
const mockLocalStorage = {
  getItem: vi.fn((key: string) => localStorageState.get(key) ?? null),
  setItem: vi.fn((key: string, value: string) => {
    localStorageState.set(key, value)
  }),
  removeItem: vi.fn((key: string) => {
    localStorageState.delete(key)
  }),
  clear: vi.fn(() => {
    localStorageState.clear()
  }),
}

vi.mock('./app', () => ({
  useAppStore: {
    getState: () => ({
      getWorktreeState: () => ({}),
      setActiveWorktree: mockSetActiveWorktree,
      clearWorktree: mockClearWorktree,
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
  codexRun: vi.fn().mockResolvedValue({ threadId: 'thread-1', finalResponse: 'done', usage: null, items: [] }),
  codexReview: vi.fn().mockResolvedValue({ threadId: 'thread-1', finalResponse: 'done', usage: null, items: [] }),
  codexCompact: vi.fn().mockResolvedValue({ threadId: 'thread-1', finalResponse: 'done', usage: null, items: [] }),
  codexListModels: vi.fn().mockResolvedValue([]),
  codexSteer: vi.fn().mockResolvedValue(undefined),
  codexAnswerQuestion: vi.fn().mockResolvedValue(true),
  codexDismissQuestion: vi.fn().mockResolvedValue(true),
  codexReset: vi.fn().mockResolvedValue(undefined),
  codexInterrupt: vi.fn().mockResolvedValue(false),
  codexPlanApproval: vi.fn().mockResolvedValue(undefined),
  codexCollaborationModeChange: vi.fn().mockResolvedValue(undefined),
  getUserPreferences: vi.fn().mockResolvedValue({ outputStyle: '', defaultPermissionMode: '', defaultSandboxMode: '' }),
}

const eventTarget = new EventTarget()
vi.stubGlobal('window', {
  agent: mockWindowAgent,
  app: mockWindowApp,
  localStorage: mockLocalStorage,
  dispatchEvent: (e: Event) => eventTarget.dispatchEvent(e),
  addEventListener: (t: string, h: EventListenerOrEventListenerObject) => eventTarget.addEventListener(t, h),
  removeEventListener: (t: string, h: EventListenerOrEventListenerObject) => eventTarget.removeEventListener(t, h),
})
vi.stubGlobal('localStorage', mockLocalStorage)

const { useChatStore, createSessionId, createDefaultPerSessionState, createDefaultProjectState, invalidateDefaultPermissionModeCache, getDefaultEffortForModel } = await import('./chat')
const createDraftSessionId = createSessionId
const isDraftSession = (id: string | null): boolean => !!id

function getActiveDraftSession(path: string) {
  const proj = useChatStore.getState().projectSessions[path]
  const sid = proj._activeSessionId
  if (!sid) return undefined
  return proj._sessions[sid]
}

function getActiveDraftId(path: string) {
  const proj = useChatStore.getState().projectSessions[path]
  return proj._activeSessionId ?? null
}

function draftOf(proj: { _activeSessionId: string | null; _sessions: Record<string, unknown> }) {
  return proj._activeSessionId!
}

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

function setupProject(path: string) {
  const store = useChatStore.getState()
  store.ensureSession(path)
  useChatStore.setState({ activeProject: path })
}

function patchDraftSession(path: string, patch: Record<string, unknown>) {
  const state = useChatStore.getState()
  const proj = state.projectSessions[path]
  const sid = proj._activeSessionId!
  useChatStore.setState({
    projectSessions: {
      ...state.projectSessions,
      [path]: {
        ...proj,
        _sessions: {
          ...proj._sessions,
          [sid]: { ...proj._sessions[sid], ...patch },
        },
      },
    },
  })
}

function makeEvent(overrides: Partial<AgentEvent> & { type: AgentEvent['type'] }): AgentEvent {
  return { projectPath: '/test', sessionId: undefined, ...overrides } as AgentEvent
}

function makeMessage(id: string, role: 'user' | 'assistant'): ChatMessage {
  return {
    id,
    role,
    status: role === 'assistant' ? 'streaming' : 'complete',
    content: [],
    createdAt: '',
    providerId: 'claude',
  }
}

beforeEach(() => {
  resetStore()
  vi.clearAllMocks()
  mockWindowApp.getUserPreferences.mockResolvedValue({ outputStyle: '', defaultPermissionMode: '', defaultSandboxMode: '' })
  mockLocalStorage.clear()
  globalThis.localStorage?.removeItem('super-one.codex.last-selection.v1')
  invalidateDefaultPermissionModeCache()
})

describe('ensureSession', () => {
  it('creates project with DRAFT session entry', () => {
    useChatStore.getState().ensureSession('/project-a')
    const proj = useChatStore.getState().projectSessions['/project-a']

    expect(proj).toBeDefined()
    expect(isDraftSession(proj._activeSessionId)).toBe(true)
    expect(getActiveDraftSession('/project-a')).toBeDefined()
    expect(getActiveDraftSession('/project-a')!.status).toBe('idle')
  })

  it('does not overwrite existing project', () => {
    setupProject('/project-a')
    const draftId = getActiveDraftId('/project-a')!
    const store = useChatStore.getState()
    const proj = store.projectSessions['/project-a']
    proj._sessions[draftId].draftText = 'hello'
    useChatStore.setState({ projectSessions: { '/project-a': proj } })

    store.ensureSession('/project-a')

    const after = useChatStore.getState().projectSessions['/project-a']
    expect(after._sessions[draftId].draftText).toBe('hello')
  })

  it('applies user preference permissionMode to new session', async () => {
    mockWindowApp.getUserPreferences.mockResolvedValue({
      outputStyle: '',
      defaultPermissionMode: 'plan',
      defaultSandboxMode: '',
    })
    invalidateDefaultPermissionModeCache()
    await new Promise((r) => setTimeout(r, 0))

    useChatStore.getState().ensureSession('/perm-test')
    const session = getActiveDraftSession('/perm-test')!
    expect(session.permissionMode).toBe('plan')
  })

  it('triggers prewarm when a new project session is created', () => {
    mockWindowAgent.prewarm.mockClear()
    useChatStore.getState().ensureSession('/prewarm-new')
    expect(mockWindowAgent.prewarm).toHaveBeenCalledTimes(1)
    expect(mockWindowAgent.prewarm).toHaveBeenCalledWith(
      '/prewarm-new',
      expect.objectContaining({ sessionId: expect.any(String) }),
    )
  })

  it('does NOT trigger prewarm when project already exists', () => {
    useChatStore.getState().ensureSession('/prewarm-existing')
    mockWindowAgent.prewarm.mockClear()
    useChatStore.getState().ensureSession('/prewarm-existing')
    expect(mockWindowAgent.prewarm).not.toHaveBeenCalled()
  })
})

describe('no data loss on session switch', () => {
  it('preserves draftText and attachments in _sessions when switching', () => {
    setupProject('/test')
    const proj = useChatStore.getState().projectSessions['/test']

    const sessionA = { ...createDefaultPerSessionState(), draftText: 'my draft', attachments: [{ name: 'img.png', data: 'base64', mimeType: 'image/png' }] as never[] }
    const sessionB = createDefaultPerSessionState()

    useChatStore.setState({
      projectSessions: {
        '/test': {
          ...proj,
          _activeSessionId: 'session-a',
          _sessions: { 'session-a': sessionA, 'session-b': sessionB },
        },
      },
    })

    useChatStore.setState({
      projectSessions: {
        '/test': {
          ...useChatStore.getState().projectSessions['/test'],
          _activeSessionId: 'session-b',
        },
      },
    })

    const after = useChatStore.getState().projectSessions['/test']
    expect(after._sessions['session-a'].draftText).toBe('my draft')
    expect(after._sessions['session-a'].attachments).toHaveLength(1)
    expect(after._activeSessionId).toBe('session-b')
  })

  it('preserves selectedModel per session', () => {
    setupProject('/test')
    const proj = useChatStore.getState().projectSessions['/test']

    const sessionA = { ...createDefaultPerSessionState(), selectedModel: 'claude-opus-4-6' }
    const sessionB = { ...createDefaultPerSessionState(), selectedModel: 'claude-sonnet-4-6' }

    useChatStore.setState({
      projectSessions: {
        '/test': {
          ...proj,
          _activeSessionId: 'a',
          _sessions: { a: sessionA, b: sessionB },
        },
      },
    })

    const result = useChatStore.getState().projectSessions['/test']
    expect(result._sessions['a'].selectedModel).toBe('claude-opus-4-6')
    expect(result._sessions['b'].selectedModel).toBe('claude-sonnet-4-6')
  })

  it('setDraftText only affects active session, not other sessions', () => {
    setupProject('/test')
    const proj = useChatStore.getState().projectSessions['/test']

    const sessionA = { ...createDefaultPerSessionState(), draftText: 'draft-a' }
    const sessionB = { ...createDefaultPerSessionState(), draftText: 'draft-b' }

    useChatStore.setState({
      projectSessions: {
        '/test': {
          ...proj,
          _activeSessionId: 'a',
          _sessions: { a: sessionA, b: sessionB },
        },
      },
    })

    useChatStore.getState().setDraftText('updated-a')

    const after = useChatStore.getState().projectSessions['/test']
    expect(after._sessions['a'].draftText).toBe('updated-a')
    expect(after._sessions['b'].draftText).toBe('draft-b')
  })

  it('switching active session exposes correct draftText without mutating other sessions', () => {
    setupProject('/test')
    const proj = useChatStore.getState().projectSessions['/test']

    const sessionA = { ...createDefaultPerSessionState(), draftText: 'draft-a' }
    const sessionB = { ...createDefaultPerSessionState(), draftText: 'draft-b' }

    useChatStore.setState({
      projectSessions: {
        '/test': {
          ...proj,
          _activeSessionId: 'a',
          _sessions: { a: sessionA, b: sessionB },
        },
      },
    })

    useChatStore.setState({
      projectSessions: {
        '/test': {
          ...useChatStore.getState().projectSessions['/test'],
          _activeSessionId: 'b',
        },
      },
    })

    useChatStore.getState().setDraftText('updated-b')

    const after = useChatStore.getState().projectSessions['/test']
    expect(after._sessions['a'].draftText).toBe('draft-a')
    expect(after._sessions['b'].draftText).toBe('updated-b')
  })

  it('rapid session switches preserve all drafts independently', () => {
    setupProject('/test')
    const proj = useChatStore.getState().projectSessions['/test']

    useChatStore.setState({
      projectSessions: {
        '/test': {
          ...proj,
          _activeSessionId: 'a',
          _sessions: {
            a: { ...createDefaultPerSessionState(), draftText: '' },
            b: { ...createDefaultPerSessionState(), draftText: '' },
            c: { ...createDefaultPerSessionState(), draftText: '' },
          },
        },
      },
    })

    useChatStore.getState().setDraftText('typed-in-a')

    useChatStore.setState({
      projectSessions: {
        '/test': {
          ...useChatStore.getState().projectSessions['/test'],
          _activeSessionId: 'b',
        },
      },
    })
    useChatStore.getState().setDraftText('typed-in-b')

    useChatStore.setState({
      projectSessions: {
        '/test': {
          ...useChatStore.getState().projectSessions['/test'],
          _activeSessionId: 'c',
        },
      },
    })
    useChatStore.getState().setDraftText('typed-in-c')

    useChatStore.setState({
      projectSessions: {
        '/test': {
          ...useChatStore.getState().projectSessions['/test'],
          _activeSessionId: 'a',
        },
      },
    })

    const final = useChatStore.getState().projectSessions['/test']
    expect(final._sessions['a'].draftText).toBe('typed-in-a')
    expect(final._sessions['b'].draftText).toBe('typed-in-b')
    expect(final._sessions['c'].draftText).toBe('typed-in-c')
  })
})

describe('concurrent streaming sessions', () => {
  it('routes events to correct session by sessionId', () => {
    setupProject('/test')
    const proj = useChatStore.getState().projectSessions['/test']

    const sessionA = { ...createDefaultPerSessionState(), status: 'streaming' as const }
    const sessionB = { ...createDefaultPerSessionState(), status: 'streaming' as const }

    useChatStore.setState({
      projectSessions: {
        '/test': {
          ...proj,
          _activeSessionId: 'a',
          _sessions: { a: sessionA, b: sessionB },
        },
      },
    })

    useChatStore.getState().handleAgentEvent(makeEvent({
      type: 'message_start',
      sessionId: 'b',
      message: { id: 'bg-msg', role: 'assistant', content: [], status: 'streaming', createdAt: '', providerId: 'claude' } as never,
    }))

    const after = useChatStore.getState().projectSessions['/test']
    expect(after._sessions['b'].messages).toHaveLength(1)
    expect(after._sessions['b'].messages[0].id).toBe('bg-msg')
    expect(after._sessions['a'].messages).toHaveLength(0)
  })

  it('falls back to active session when event has no sessionId', () => {
    setupProject('/test')
    const proj = useChatStore.getState().projectSessions['/test']

    useChatStore.setState({
      projectSessions: {
        '/test': {
          ...proj,
          _activeSessionId: 'a',
          _sessions: { a: createDefaultPerSessionState(), b: createDefaultPerSessionState() },
        },
      },
    })

    useChatStore.getState().handleAgentEvent(makeEvent({
      type: 'status_change',
      status: 'streaming',
    }))

    const after = useChatStore.getState().projectSessions['/test']
    expect(after._sessions['a'].status).toBe('streaming')
    expect(after._sessions['b'].status).toBe('idle')
  })

  it.skip('routes session_init to live draft when switched away before first reply', () => {
    setupProject('/test')
    const proj = useChatStore.getState().projectSessions['/test']
    const draftId = getActiveDraftId('/test')!

    useChatStore.setState({
      projectSessions: {
        '/test': {
          ...proj,
          _activeSessionId: draftId,
          _sessions: {
            old: createDefaultPerSessionState(),
            [draftId]: {
              ...createDefaultPerSessionState(),
              messages: [{ id: 'u1', role: 'user' as const, content: [{ type: 'text', text: 'hello' }], status: 'complete' as const, createdAt: '', providerId: 'local' }],
              awaitingAssistantReply: true,
            },
          },
        },
      },
    })

    useChatStore.getState().handleAgentEvent(makeEvent({
      type: 'session_init',
      sessionId: 'real-new',
      session: { sessionId: 'real-new' } as never,
    }))

    const after = useChatStore.getState().projectSessions['/test']
    expect(after._sessions[draftId]).toBeUndefined()
    expect(after._sessions['real-new']).toBeDefined()
    expect(after._sessions['real-new'].awaitingAssistantReply).toBe(true)
    expect(after._sessions['old']).toBeDefined()
  })

  it.skip('creates a real session entry for a saved session_init instead of falling back to DRAFT', async () => {
    mockWindowApp.loadSessionState.mockResolvedValue({
      messages: [makeMessage('old-msg', 'assistant')],
      totalCostUsd: 1,
      contextTokens: 2,
      isWorktree: false,
      gitBranch: null,
      worktreePath: null,
      provider: 'claude',
    })

    useChatStore.setState({
      projectSessions: {
        '/test': {
          ...createDefaultProjectState(),
          sessions: [
            {
              sessionId: 'old-session',
              title: 'Old Session',
              lastActiveAt: '2026-03-23T00:00:00.000Z',
              messageCount: 1,
            },
          ],
        },
      },
      activeProject: '/test',
    })

    useChatStore.getState().handleAgentEvent(makeEvent({
      type: 'session_init',
      sessionId: 'old-session',
      session: { sessionId: 'old-session' } as never,
    }))

    await Promise.resolve()
    await Promise.resolve()

    const after = useChatStore.getState().projectSessions['/test']
    expect(after._activeSessionId).toBeNull()
    const hasDraft = Object.keys(after._sessions).some((k) => isDraftSession(k))
    expect(hasDraft).toBe(false)
    expect(after._sessions['old-session']).toBeDefined()
    expect(after._sessions['old-session'].messages.map((message) => message.id)).toEqual(['old-msg'])
  })

  it('routes follow-up events for an unloaded saved session to its real session id', () => {
    setupProject('/test')
    const proj = useChatStore.getState().projectSessions['/test']
    const draftId = getActiveDraftId('/test')!

    useChatStore.setState({
      projectSessions: {
        '/test': {
          ...proj,
          sessions: [
            {
              sessionId: 'old-session',
              title: 'Old Session',
              lastActiveAt: '2026-03-23T00:00:00.000Z',
              messageCount: 1,
            },
          ],
          _sessions: {
            [draftId]: {
              ...proj._sessions[draftId],
              messages: [{
                id: 'draft-user',
                role: 'user' as const,
                content: [{ type: 'text', text: 'new draft' }],
                status: 'complete' as const,
                createdAt: '',
                providerId: 'local',
              }],
              awaitingAssistantReply: true,
            },
          },
        },
      },
    })

    useChatStore.getState().handleAgentEvent(makeEvent({
      type: 'status_change',
      sessionId: 'old-session',
      status: 'streaming',
    }))
    useChatStore.getState().handleAgentEvent(makeEvent({
      type: 'message_start',
      sessionId: 'old-session',
      message: makeMessage('old-follow-up', 'assistant') as never,
    }))

    const after = useChatStore.getState().projectSessions['/test']
    expect(after._sessions[draftId].messages.map((message) => message.id)).toEqual(['draft-user'])
    expect(after._sessions[draftId].awaitingAssistantReply).toBe(true)
    expect(after._sessions['old-session']).toBeDefined()
    expect(after._sessions['old-session'].status).toBe('streaming')
    expect(after._sessions['old-session'].messages.map((message) => message.id)).toContain('old-follow-up')
  })

  it('hydrates subscribed remote sessions and routes follow-up events to them', async () => {
    setupProject('/test')
    const proj = useChatStore.getState().projectSessions['/test']

    useChatStore.setState({
      projectSessions: {
        '/test': {
          ...proj,
          _activeSessionId: 'active',
          _sessions: { active: createDefaultPerSessionState() },
        },
      },
    })

    mockWindowApp.loadSessionState.mockResolvedValue({
      messages: [makeMessage('old-msg', 'assistant')],
      totalCostUsd: 1,
      contextTokens: 2,
      isWorktree: false,
      gitBranch: null,
      worktreePath: null,
      provider: 'claude',
    })

    useChatStore.getState().handleAgentEvent({
      type: 'remote_session_start',
      remoteProjectPath: '/test',
      remoteSessionId: 'remote-1',
      isSubscribe: true,
    } as AgentEvent)

    await Promise.resolve()
    await Promise.resolve()

    useChatStore.getState().handleAgentEvent(makeEvent({
      type: 'message_start',
      sessionId: 'remote-1',
      message: makeMessage('new-msg', 'assistant') as never,
    }))

    const after = useChatStore.getState().projectSessions['/test']
    expect(after._sessions['remote-1'].messages.map((message) => message.id)).toEqual(['old-msg', 'new-msg'])
    expect(after._sessions['active'].messages).toHaveLength(0)
  })

  it('keeps subscribed remote sessions in memory after idle and does not save them from renderer', async () => {
    vi.useFakeTimers()
    try {
      setupProject('/test')
      const proj = useChatStore.getState().projectSessions['/test']

      useChatStore.setState({
        projectSessions: {
          '/test': {
            ...proj,
            _activeSessionId: 'active',
            _sessions: { active: createDefaultPerSessionState() },
          },
        },
      })

      let resolveLoad: (value: unknown) => void = () => {}
      const loadPromise = new Promise((resolve) => {
        resolveLoad = resolve
      })
      mockWindowApp.loadSessionState.mockImplementation(() => loadPromise as Promise<never>)

      useChatStore.getState().handleAgentEvent({
        type: 'remote_session_start',
        remoteProjectPath: '/test',
        remoteSessionId: 'remote-1',
        isSubscribe: true,
      } as AgentEvent)

      useChatStore.getState().handleAgentEvent(makeEvent({
        type: 'message_start',
        sessionId: 'remote-1',
        message: makeMessage('new-msg', 'assistant') as never,
      }))

      useChatStore.getState().handleAgentEvent(makeEvent({
        type: 'status_change',
        sessionId: 'remote-1',
        status: 'idle',
      }))

      resolveLoad({
        messages: [makeMessage('old-msg', 'assistant')],
        totalCostUsd: 1,
        contextTokens: 2,
        isWorktree: false,
        gitBranch: null,
        worktreePath: null,
        provider: 'claude',
      })

      await Promise.resolve()
      await vi.runAllTimersAsync()

      const after = useChatStore.getState().projectSessions['/test']
      expect(after._sessions['remote-1'].messages.map((message) => message.id)).toEqual(['old-msg', 'new-msg'])
      expect(mockWindowApp.saveSessionState).not.toHaveBeenCalled()
    } finally {
      vi.useRealTimers()
    }
  })
})

describe('idle eviction', () => {
  it('evicts non-active session from _sessions when it goes idle', async () => {
    setupProject('/test')
    const proj = useChatStore.getState().projectSessions['/test']

    useChatStore.setState({
      projectSessions: {
        '/test': {
          ...proj,
          _activeSessionId: 'a',
          _sessions: {
            a: createDefaultPerSessionState(),
            b: { ...createDefaultPerSessionState(), status: 'streaming' as const },
          },
        },
      },
    })

    useChatStore.getState().handleAgentEvent(makeEvent({
      type: 'status_change',
      sessionId: 'b',
      status: 'idle',
    }))

    await new Promise((r) => setTimeout(r, 0))
    await new Promise((r) => setTimeout(r, 0))

    const after = useChatStore.getState().projectSessions['/test']
    expect(after._sessions['b']).toBeUndefined()
    expect(after._sessions['a']).toBeDefined()
  })

  it('does NOT evict active session when it goes idle', () => {
    setupProject('/test')
    const proj = useChatStore.getState().projectSessions['/test']

    useChatStore.setState({
      projectSessions: {
        '/test': {
          ...proj,
          _activeSessionId: 'a',
          _sessions: {
            a: { ...createDefaultPerSessionState(), status: 'streaming' as const },
          },
        },
      },
    })

    useChatStore.getState().handleAgentEvent(makeEvent({
      type: 'status_change',
      sessionId: 'a',
      status: 'idle',
    }))

    const after = useChatStore.getState().projectSessions['/test']
    expect(after._sessions['a']).toBeDefined()
    expect(after._sessions['a'].status).toBe('idle')
  })

  it('does NOT evict non-active session when awaitingAssistantReply is true', () => {
    setupProject('/test')
    const proj = useChatStore.getState().projectSessions['/test']

    useChatStore.setState({
      projectSessions: {
        '/test': {
          ...proj,
          _activeSessionId: 'a',
          _sessions: {
            a: createDefaultPerSessionState(),
            b: { ...createDefaultPerSessionState(), awaitingAssistantReply: true },
          },
        },
      },
    })

    useChatStore.getState().handleAgentEvent(makeEvent({
      type: 'status_change',
      sessionId: 'b',
      status: 'idle',
    }))

    const after = useChatStore.getState().projectSessions['/test']
    expect(after._sessions['b']).toBeDefined()
    expect(after.unseenCompletedSessions.has('b')).toBe(false)
  })
})

describe('hasPendingInteraction', () => {
  it('is true when any session has pendingPermission', () => {
    setupProject('/test')
    const proj = useChatStore.getState().projectSessions['/test']

    useChatStore.setState({
      projectSessions: {
        '/test': {
          ...proj,
          _activeSessionId: 'a',
          _sessions: {
            a: createDefaultPerSessionState(),
            b: { ...createDefaultPerSessionState(), status: 'streaming' as const },
          },
        },
      },
    })

    useChatStore.getState().handleAgentEvent(makeEvent({
      type: 'permission_request',
      sessionId: 'b',
      request: { requestId: 'r1', toolName: 'Bash', description: 'run ls' } as never,
    }))

    const after = useChatStore.getState().projectSessions['/test']
    expect(after.hasPendingInteraction).toBe(true)
  })

  it('clears when all pending requests are resolved', () => {
    setupProject('/test')
    const proj = useChatStore.getState().projectSessions['/test']

    const sessionWithPermission = {
      ...createDefaultPerSessionState(),
      pendingPermissions: [{ requestId: 'r1', toolName: 'Bash', description: 'run ls' } as never],
    }

    useChatStore.setState({
      projectSessions: {
        '/test': {
          ...proj,
          _activeSessionId: 'a',
          hasPendingInteraction: true,
          _sessions: { a: sessionWithPermission },
        },
      },
    })

    useChatStore.getState().handleAgentEvent(makeEvent({
      type: 'status_change',
      sessionId: 'a',
      status: 'streaming',
    }))

    const after = useChatStore.getState().projectSessions['/test']
    expect(after._sessions['a'].pendingPermissions.length).toBeGreaterThan(0)
    expect(after.hasPendingInteraction).toBe(true)
  })

  it('queues multiple permission_request events and respondToPermission dequeues by FIFO', () => {
    setupProject('/test')
    const proj = useChatStore.getState().projectSessions['/test']

    useChatStore.setState({
      projectSessions: {
        '/test': {
          ...proj,
          _activeSessionId: 'a',
          _sessions: {
            a: { ...createDefaultPerSessionState(), status: 'streaming' as const },
          },
        },
      },
    })

    useChatStore.getState().handleAgentEvent(makeEvent({
      type: 'permission_request',
      sessionId: 'a',
      request: { requestId: 'r1', toolName: 'Bash', description: 'run ls' } as never,
    }))
    useChatStore.getState().handleAgentEvent(makeEvent({
      type: 'permission_request',
      sessionId: 'a',
      request: { requestId: 'r2', toolName: 'Edit', description: 'edit file' } as never,
    }))
    useChatStore.getState().handleAgentEvent(makeEvent({
      type: 'permission_request',
      sessionId: 'a',
      request: { requestId: 'r3', toolName: 'Write', description: 'write file' } as never,
    }))

    const mid = useChatStore.getState().projectSessions['/test']
    expect(mid._sessions['a'].pendingPermissions).toHaveLength(3)
    expect(mid._sessions['a'].pendingPermissions.map((p: { requestId: string }) => p.requestId)).toEqual(['r1', 'r2', 'r3'])

    useChatStore.getState().respondToPermission('r1', true)

    const after1 = useChatStore.getState().projectSessions['/test']
    expect(after1._sessions['a'].pendingPermissions).toHaveLength(2)
    expect(after1._sessions['a'].pendingPermissions[0].requestId).toBe('r2')

    useChatStore.getState().respondToPermission('r2', false)

    const after2 = useChatStore.getState().projectSessions['/test']
    expect(after2._sessions['a'].pendingPermissions).toHaveLength(1)
    expect(after2._sessions['a'].pendingPermissions[0].requestId).toBe('r3')

    useChatStore.getState().respondToPermission('r3', true)

    const after3 = useChatStore.getState().projectSessions['/test']
    expect(after3._sessions['a'].pendingPermissions).toHaveLength(0)
    expect(after3.hasPendingInteraction).toBe(false)
  })

  it('does not duplicate permission_request with same requestId', () => {
    setupProject('/test')
    const proj = useChatStore.getState().projectSessions['/test']

    useChatStore.setState({
      projectSessions: {
        '/test': {
          ...proj,
          _activeSessionId: 'a',
          _sessions: {
            a: { ...createDefaultPerSessionState(), status: 'streaming' as const },
          },
        },
      },
    })

    useChatStore.getState().handleAgentEvent(makeEvent({
      type: 'permission_request',
      sessionId: 'a',
      request: { requestId: 'r1', toolName: 'Bash', description: 'run ls' } as never,
    }))
    useChatStore.getState().handleAgentEvent(makeEvent({
      type: 'permission_request',
      sessionId: 'a',
      request: { requestId: 'r1', toolName: 'Bash', description: 'run ls' } as never,
    }))

    const after = useChatStore.getState().projectSessions['/test']
    expect(after._sessions['a'].pendingPermissions).toHaveLength(1)
  })
})

describe('resetSession', () => {
  it('creates fresh DRAFT session while keeping old session in _sessions', async () => {
    setupProject('/test')
    const proj = useChatStore.getState().projectSessions['/test']

    const streamingSession = {
      ...createDefaultPerSessionState(),
      status: 'streaming' as const,
      messages: [{ id: 'm1', role: 'user' as const, content: [], status: 'complete' as const, createdAt: '', providerId: 'claude' }],
      session: { sessionId: 'old-session' } as never,
    }

    useChatStore.setState({
      projectSessions: {
        '/test': {
          ...proj,
          _activeSessionId: 'old-session',
          _sessions: { 'old-session': streamingSession },
        },
      },
    })

    await useChatStore.getState().resetSession()

    const after = useChatStore.getState().projectSessions['/test']
    expect(isDraftSession(after._activeSessionId)).toBe(true)
    expect(getActiveDraftSession('/test')).toBeDefined()
    expect(getActiveDraftSession('/test')!.messages).toHaveLength(0)
    expect(after._sessions['old-session']).toBeDefined()
    expect(after._sessions['old-session'].messages).toHaveLength(1)
  })

  it('applies permissionMode and sandboxInfo from agentConfig on idle reset', async () => {
    const agentConfig = {
      permissionMode: 'acceptEdits' as const,
      sandboxInfo: { enabled: false, autoAllowBash: true },
    }
    mockWindowAgent.resetSession.mockReset()
    mockWindowAgent.resetSession.mockResolvedValue(agentConfig)

    setupProject('/test')

    await useChatStore.getState().resetSession()

    expect(getActiveDraftSession('/test')!.permissionMode).toBe('acceptEdits')
    const after = useChatStore.getState().projectSessions['/test']
    expect(after.sandboxInfo).toEqual({ enabled: false, autoAllowBash: true })
  })

  it('triggers prewarm after reset so the new draft session warms up in the background', async () => {
    mockWindowAgent.resetSession.mockReset()
    mockWindowAgent.resetSession.mockResolvedValue({
      permissionMode: 'default' as const,
      sandboxInfo: { enabled: true, autoAllowBash: false },
    })
    setupProject('/prewarm-reset')
    useChatStore.setState({ activeProject: '/prewarm-reset' })
    mockWindowAgent.prewarm.mockClear()

    await useChatStore.getState().resetSession()

    expect(mockWindowAgent.prewarm).toHaveBeenCalledWith(
      '/prewarm-reset',
      expect.objectContaining({ sessionId: expect.any(String) }),
    )
  })

  it('passes newDraftSessionId to resetSession for idle non-streaming sessions', async () => {
    mockWindowAgent.resetSession.mockReset()
    mockWindowAgent.resetSession.mockResolvedValue({
      permissionMode: 'default' as const,
      sandboxInfo: { enabled: false, autoAllowBash: false },
    })

    setupProject('/test')

    await useChatStore.getState().resetSession()

    const after = useChatStore.getState().projectSessions['/test']
    expect(mockWindowAgent.resetSession).toHaveBeenCalledWith('/test', after._activeSessionId)
  })

  it.skip('parks streaming DRAFT session instead of killing it', async () => {
    const agentConfig = {
      permissionMode: 'default' as const,
      sandboxInfo: { enabled: false, autoAllowBash: false },
    }
    mockWindowAgent.parkSession.mockResolvedValueOnce(agentConfig)

    setupProject('/test')
    const proj = useChatStore.getState().projectSessions['/test']
    const oldDraftId = getActiveDraftId('/test')!

    useChatStore.setState({
      projectSessions: {
        '/test': {
          ...proj,
          _activeSessionId: oldDraftId,
          _sessions: {
            [oldDraftId]: {
              ...createDefaultPerSessionState(),
              status: 'streaming' as const,
              messages: [makeMessage('u1', 'user'), makeMessage('a1', 'assistant')],
            },
          },
        },
      },
    })

    await useChatStore.getState().resetSession()

    expect(mockWindowAgent.parkDraftSession).toHaveBeenCalledWith('/test', oldDraftId, expect.stringMatching(/^__draft_/))
    expect(mockWindowAgent.resetSession).not.toHaveBeenCalled()
    const after = useChatStore.getState().projectSessions['/test']
    expect(isDraftSession(after._activeSessionId)).toBe(true)
    expect(after._activeSessionId).not.toBe(oldDraftId)
    expect(getActiveDraftSession('/test')!.messages).toHaveLength(0)
    expect(after._sessions[oldDraftId]).toBeDefined()
    expect(after._sessions[oldDraftId].messages).toHaveLength(2)
  })

  it.skip('parks session when awaitingAssistantReply but not yet streaming', async () => {
    mockWindowAgent.parkSession.mockResolvedValueOnce(undefined)

    setupProject('/test')
    const proj = useChatStore.getState().projectSessions['/test']
    const oldDraftId = getActiveDraftId('/test')!

    useChatStore.setState({
      projectSessions: {
        '/test': {
          ...proj,
          _activeSessionId: oldDraftId,
          _sessions: {
            [oldDraftId]: {
              ...createDefaultPerSessionState(),
              status: 'idle' as const,
              awaitingAssistantReply: true,
              messages: [makeMessage('u1', 'user')],
            },
          },
        },
      },
    })

    await useChatStore.getState().resetSession()

    expect(mockWindowAgent.parkDraftSession).toHaveBeenCalledWith('/test', oldDraftId, expect.stringMatching(/^__draft_/))
    expect(mockWindowAgent.resetSession).not.toHaveBeenCalled()
  })

  it('applies agentConfig from parkSession for non-draft streaming session', async () => {
    const agentConfig = {
      permissionMode: 'bypassPermissions' as const,
      sandboxInfo: { enabled: true, autoAllowBash: true },
    }
    setupProject('/test')
    const proj = useChatStore.getState().projectSessions['/test']

    useChatStore.setState({
      projectSessions: {
        '/test': {
          ...proj,
          _activeSessionId: 'streaming-sid',
          _sessions: {
            'streaming-sid': {
              ...createDefaultPerSessionState(),
              status: 'streaming' as const,
              session: { sessionId: 'streaming-sid' } as never,
            },
          },
        },
      },
    })

    mockWindowAgent.parkSession.mockReset()
    mockWindowAgent.parkSession.mockResolvedValue(agentConfig)

    await useChatStore.getState().resetSession()

    expect(mockWindowAgent.parkSession).toHaveBeenCalledTimes(1)
    expect(getActiveDraftSession('/test')!.permissionMode).toBe('bypassPermissions')
    const after = useChatStore.getState().projectSessions['/test']
    expect(after.sandboxInfo).toEqual({ enabled: true, autoAllowBash: true })
  })
})

describe('init_ready updates session fields', () => {
  it('sets cwd on the active session and updates project metadata', () => {
    setupProject('/test')

    useChatStore.getState().handleAgentEvent({
      type: 'init_ready',
      projectPath: '/test',
      sessionId: undefined,
      cwd: '/home/user/project',
      homedir: '/home/user',
      sandboxInfo: { enabled: false, autoAllowBash: true },
      skills: [],
      projectCommands: [],
      projectAgents: [],
      additionalDirectories: [],
    } as never)

    const proj = useChatStore.getState().projectSessions['/test']
    expect(getActiveDraftSession('/test')!.cwd).toBe('/home/user/project')
    expect(proj.homedir).toBe('/home/user')
    expect(proj.sandboxInfo).toEqual({ enabled: false, autoAllowBash: true })
  })

  it('populates projectAdditionalDirs from event payload', () => {
    setupProject('/proj-add-dir')

    useChatStore.getState().handleAgentEvent({
      type: 'init_ready',
      projectPath: '/proj-add-dir',
      sessionId: undefined,
      cwd: '/proj-add-dir',
      homedir: '/home/user',
      sandboxInfo: { enabled: false, autoAllowBash: true },
      skills: [],
      projectCommands: [],
      projectAgents: [],
      additionalDirectories: ['/proj-add-dir/lib', '/proj-add-dir/shared'],
    } as never)

    const proj = useChatStore.getState().projectSessions['/proj-add-dir']
    expect(proj.projectAdditionalDirs).toEqual(['/proj-add-dir/lib', '/proj-add-dir/shared'])
  })
})

describe('lazy session creation on early events', () => {
  it.skip('creates draft session on init_ready when project has no sessions', () => {
    useChatStore.setState({
      projectSessions: { '/early': { ...createDefaultProjectState(), _activeSessionId: null, _sessions: {} } },
      activeProject: '/early',
    })

    useChatStore.getState().handleAgentEvent({
      type: 'init_ready',
      projectPath: '/early',
      sessionId: undefined,
      cwd: '/home/user',
      homedir: '/home/user',
      sandboxInfo: { enabled: false, autoAllowBash: true },
      skills: [],
      projectCommands: [],
      projectAgents: [],
    } as never)

    const proj = useChatStore.getState().projectSessions['/early']
    expect(isDraftSession(proj._activeSessionId)).toBe(true)
    expect(getActiveDraftSession('/early')).toBeDefined()
    expect(getActiveDraftSession('/early')!.cwd).toBe('/home/user')
  })

  it.skip('creates real session on session_init when project has no sessions', () => {
    useChatStore.setState({
      projectSessions: { '/early2': { ...createDefaultProjectState(), _activeSessionId: null, _sessions: {} } },
      activeProject: '/early2',
    })

    useChatStore.getState().handleAgentEvent(makeEvent({
      type: 'session_init',
      projectPath: '/early2',
      session: { sessionId: 'real-sid' } as never,
    }))

    const proj = useChatStore.getState().projectSessions['/early2']
    expect(proj._activeSessionId).toBe('real-sid')
    expect(proj._sessions['real-sid']).toBeDefined()
    const hasDraft = Object.keys(proj._sessions).some((k) => isDraftSession(k))
    expect(hasDraft).toBe(false)
  })

  it('still drops non-init events when no session exists', () => {
    useChatStore.setState({
      projectSessions: { '/empty': { ...createDefaultProjectState(), _activeSessionId: null, _sessions: {} } },
      activeProject: '/empty',
    })

    useChatStore.getState().handleAgentEvent(makeEvent({
      type: 'message_start',
      projectPath: '/empty',
      message: { id: 'msg1', role: 'assistant', content: [], status: 'streaming', createdAt: '', providerId: 'claude' } as never,
    }))

    const proj = useChatStore.getState().projectSessions['/empty']
    expect(proj._activeSessionId).toBeNull()
    expect(Object.keys(proj._sessions)).toHaveLength(0)
  })
})

describe('switchProject restores parked session', () => {
  it.skip('calls resumeSession when switching back to a project with active session', async () => {
    setupProject('/proj-a')
    useChatStore.getState().handleAgentEvent(makeEvent({
      type: 'session_init',
      projectPath: '/proj-a',
      session: { sessionId: 'sid-a' } as never,
    }))
    useChatStore.setState((s) => {
      const proj = s.projectSessions['/proj-a']
      return {
        projectSessions: {
          ...s.projectSessions,
          '/proj-a': {
            ...proj,
            _sessions: {
              ...proj._sessions,
              'sid-a': { ...proj._sessions['sid-a'], status: 'streaming' as const },
            },
          },
        },
      }
    })

    setupProject('/proj-b')

    await useChatStore.getState().switchProject('/proj-b')
    mockWindowApp.resumeSession.mockClear()

    await useChatStore.getState().switchProject('/proj-a')
    expect(mockWindowApp.resumeSession).toHaveBeenCalledWith('/proj-a', 'sid-a', '/proj-a')
  })

  it.skip('does NOT call resumeSession for DRAFT session', async () => {
    setupProject('/proj-c')
    setupProject('/proj-d')

    await useChatStore.getState().switchProject('/proj-d')
    mockWindowApp.resumeSession.mockClear()

    await useChatStore.getState().switchProject('/proj-c')
    expect(mockWindowApp.resumeSession).not.toHaveBeenCalled()
  })
})

describe('setGlobalResources rebuilds slashCommands', () => {
  it('rebuilds slashCommands for initialized project even with empty skills/commands', () => {
    setupProject('/test')

    useChatStore.getState().setGlobalResources(
      [{ id: 'm1', name: 'model-1' }] as never[],
      {} as never,
      [{ name: '/global-cmd', description: 'global' }] as never[],
      [{ name: '/user-skill', description: 'user skill' }] as never[],
      [{ name: '/user-cmd', description: 'user cmd' }] as never[],
      [] as never[],
    )

    const proj = useChatStore.getState().projectSessions['/test']
    expect(proj.slashCommands.length).toBeGreaterThan(0)
  })
})

describe('applyDefaultModel via ensureSession', () => {
  it('applies first available model to new DRAFT session', () => {
    useChatStore.setState({
      availableModels: [
        { id: 'claude-sonnet-4-6', name: 'Sonnet', supportedEffortLevels: ['low', 'medium', 'high'] },
        { id: 'claude-haiku-4-5', name: 'Haiku' },
      ] as never[],
    })

    useChatStore.getState().ensureSession('/model-test')
    const session = getActiveDraftSession('/model-test')!
    expect(session.selectedModel).toBe('claude-sonnet-4-6')
    expect(session.selectedEffort).toBe('medium')
  })

  it('does not set effort when model has no supportedEffortLevels', () => {
    useChatStore.setState({
      availableModels: [{ id: 'claude-haiku-4-5', name: 'Haiku' }] as never[],
    })

    useChatStore.getState().ensureSession('/no-effort')
    const session = getActiveDraftSession('/no-effort')!
    expect(session.selectedModel).toBe('claude-haiku-4-5')
    expect(session.selectedEffort).toBeUndefined()
  })

  it('defaults to xhigh when model supports xhigh (e.g. Opus 4.7)', () => {
    useChatStore.setState({
      availableModels: [
        { id: 'claude-opus-4-7', name: 'Opus 4.7', supportedEffortLevels: ['low', 'medium', 'high', 'xhigh'] },
      ] as never[],
    })

    useChatStore.getState().ensureSession('/opus-47')
    const session = getActiveDraftSession('/opus-47')!
    expect(session.selectedModel).toBe('claude-opus-4-7')
    expect(session.selectedEffort).toBe('xhigh')
  })

  it('leaves default model when no models available', () => {
    useChatStore.setState({ availableModels: [] })

    useChatStore.getState().ensureSession('/empty-models')
    const session = getActiveDraftSession('/empty-models')!
    expect(session.selectedModel).toBe('')
  })
})

describe('getDefaultEffortForModel', () => {
  it('returns xhigh when model supports xhigh', () => {
    expect(getDefaultEffortForModel({ id: 'claude-opus-4-7', name: 'Opus 4.7', description: '', supportedEffortLevels: ['low', 'medium', 'high', 'xhigh'] })).toBe('xhigh')
  })

  it('returns medium when model supports medium but not xhigh', () => {
    expect(getDefaultEffortForModel({ id: 'claude-sonnet-4-6', name: 'Sonnet', description: '', supportedEffortLevels: ['low', 'medium', 'high'] })).toBe('medium')
  })

  it('returns undefined when model has no effort levels', () => {
    expect(getDefaultEffortForModel({ id: 'claude-haiku-4-5', name: 'Haiku', description: '' })).toBeUndefined()
    expect(getDefaultEffortForModel(undefined)).toBeUndefined()
  })

  it('falls back to first level when neither xhigh nor medium is present', () => {
    expect(getDefaultEffortForModel({ id: 'weird-model', name: 'Weird', description: '', supportedEffortLevels: ['low', 'high'] })).toBe('low')
  })
})

describe('codex model cache + defaults', () => {
  it('seeds new session with cached codex models and prefers GPT-5.4 high', () => {
    useChatStore.getState().setGlobalResources(
      [],
      {},
      [],
      [],
      [],
      [],
      [
        {
          id: 'gpt-5.4',
          name: 'GPT-5.4',
          supportedReasoningEfforts: [{ value: 'low', description: 'low' }, { value: 'high', description: 'high' }],
        } as never,
      ] as never[],
    )

    useChatStore.getState().ensureSession('/codex-cache')
    const session = getActiveDraftSession('/codex-cache')!
    expect(session.selectedCodexModel).toBe('gpt-5.4')
    expect(session.selectedCodexReasoningEffort).toBe('high')
  })

  it('seeds new session with remembered codex selection when available', () => {
    globalThis.localStorage?.setItem('super-one.codex.last-selection.v1', JSON.stringify({
      modelId: 'gpt-5.4',
      reasoningEffort: 'low',
    }))

    useChatStore.getState().setGlobalResources(
      [],
      {},
      [],
      [],
      [],
      [],
      [
        {
          id: 'gpt-5.4',
          name: 'GPT-5.4',
          supportedReasoningEfforts: [{ value: 'low', description: 'low' }, { value: 'high', description: 'high' }],
        } as never,
      ] as never[],
    )

    useChatStore.getState().ensureSession('/codex-memory')
    const session = getActiveDraftSession('/codex-memory')!
    expect(session.selectedCodexModel).toBe('gpt-5.4')
    expect(session.selectedCodexReasoningEffort).toBe('low')
  })

  it('updates global codex cache when refreshing codex models', async () => {
    setupProject('/codex-refresh')
    mockWindowApp.codexListModels.mockResolvedValueOnce([
      {
        id: 'gpt-5.4',
        name: 'GPT-5.4',
        supportedReasoningEfforts: [{ value: 'low', description: 'low' }, { value: 'high', description: 'high' }],
      } as never,
    ])

    await useChatStore.getState().refreshCodexModels(true)
    expect(useChatStore.getState().cachedCodexModels.map((m) => m.id)).toEqual(['gpt-5.4'])
  })

  it('persists codex selection changes to localStorage', () => {
    useChatStore.getState().setGlobalResources(
      [],
      {},
      [],
      [],
      [],
      [],
      [
        {
          id: 'gpt-5.4',
          name: 'GPT-5.4',
          supportedReasoningEfforts: [{ value: 'low', description: 'low' }, { value: 'high', description: 'high' }],
        } as never,
      ] as never[],
    )
    setupProject('/codex-persist')

    useChatStore.getState().setSelectedCodexModel('gpt-5.4')
    useChatStore.getState().setSelectedCodexReasoningEffort('low')

    const raw = globalThis.localStorage?.getItem('super-one.codex.last-selection.v1')
    expect(raw).toBeTruthy()
    expect(JSON.parse(raw!)).toEqual({ modelId: 'gpt-5.4', reasoningEffort: 'low' })
  })
})

describe('switchSession Case A (in _sessions)', () => {
  it('switches pointer to target session and calls resumeSession', async () => {
    setupProject('/test')

    useChatStore.getState().handleAgentEvent(makeEvent({
      type: 'session_init',
      session: { sessionId: 'ses-a' } as never,
    }))

    const proj = useChatStore.getState().projectSessions['/test']
    useChatStore.setState({
      projectSessions: {
        '/test': {
          ...proj,
          _sessions: {
            ...proj._sessions,
            'ses-b': { ...createDefaultPerSessionState(), status: 'streaming' as const },
          },
        },
      },
    })

    mockWindowApp.resumeSession.mockResolvedValue(undefined)
    await useChatStore.getState().switchSession('ses-b')

    const after = useChatStore.getState().projectSessions['/test']
    expect(after._activeSessionId).toBe('ses-b')
    expect(mockWindowApp.resumeSession).toHaveBeenCalledWith('/test', 'ses-b', '/test', 'default')
  })

  it('switches pointer and resumes runtime for non-running target session', async () => {
    setupProject('/test')
    useChatStore.setState({
      availableModels: [{ id: 'claude-sonnet-4-6', name: 'Sonnet', supportedEffortLevels: ['low', 'medium', 'high'] }] as never[],
    })
    const proj = useChatStore.getState().projectSessions['/test']

    useChatStore.setState({
      projectSessions: {
        '/test': {
          ...proj,
          _activeSessionId: 'ses-a',
          _sessions: {
            'ses-a': createDefaultPerSessionState(),
            'ses-b': { ...createDefaultPerSessionState(), sessionProvider: 'claude' },
          },
        },
      },
    })

    mockWindowApp.resumeSession.mockClear()
    await useChatStore.getState().switchSession('ses-b')

    const after = useChatStore.getState().projectSessions['/test']
    expect(after._activeSessionId).toBe('ses-b')
    expect(mockWindowApp.resumeSession).toHaveBeenCalledWith('/test', 'ses-b', '/test', 'default')
    expect(after._sessions['ses-b'].selectedModel).toBe('claude-sonnet-4-6')
    expect(after._sessions['ses-b'].selectedEffort).toBe('medium')
  })

  it('realigns project cwd when switching from worktree session to local session', async () => {
    setupProject('/test')
    const proj = useChatStore.getState().projectSessions['/test']

    useChatStore.setState({
      projectSessions: {
        '/test': {
          ...proj,
          _activeSessionId: 'wt',
          _sessions: {
            wt: { ...createDefaultPerSessionState(), cwd: '/tmp/worktree', sessionProvider: 'claude', _worktreePath: '/tmp/worktree' },
            local: { ...createDefaultPerSessionState(), cwd: '/tmp/worktree', sessionProvider: 'claude' },
          },
        },
      },
    })

    await useChatStore.getState().switchSession('local')

    const after = useChatStore.getState().projectSessions['/test']
    expect(after._sessions.local.cwd).toBe('/test')
  })
})

describe('switchSession Case B (from DB)', () => {
  it('loads session from DB and sets active', async () => {
    setupProject('/test')
    useChatStore.setState({
      availableModels: [{ id: 'claude-sonnet-4-6', name: 'Sonnet', supportedEffortLevels: ['low', 'medium', 'high'] }] as never[],
    })

    mockWindowApp.loadSessionState.mockResolvedValue({
      messages: [{ id: 'db-msg', role: 'assistant', content: [], status: 'complete', createdAt: '', providerId: 'claude' }],
      totalCostUsd: 0.05,
      contextTokens: 1000,
      gitBranch: null,
      provider: 'claude',
    })
    await useChatStore.getState().switchSession('db-session')

    const after = useChatStore.getState().projectSessions['/test']
    expect(after._activeSessionId).toBe('db-session')
    expect(after._sessions['db-session']).toBeDefined()
    expect(after._sessions['db-session'].messages).toHaveLength(1)
    expect(after._sessions['db-session'].messages[0].id).toBe('db-msg')
    expect(after._sessions['db-session'].totalCostUsd).toBe(0.05)
    expect(after._sessions['db-session'].contextTokens).toBe(1000)
    expect(after._sessions['db-session'].sessionProvider).toBe('claude')
    expect(after._sessions['db-session'].selectedModel).toBe('claude-sonnet-4-6')
    expect(after._sessions['db-session'].selectedEffort).toBe('medium')
    expect(after.showHistory).toBe(false)
    expect(mockWindowApp.resumeSession).toHaveBeenCalledWith('/test', 'db-session', '/test', 'default')
  })

  it('handles null loadSessionState gracefully', async () => {
    setupProject('/test')
    mockWindowApp.loadSessionState.mockResolvedValue(null)

    await useChatStore.getState().switchSession('missing-session')

    const after = useChatStore.getState().projectSessions['/test']
    expect(after._activeSessionId).toBe('missing-session')
    expect(after._sessions['missing-session'].messages).toHaveLength(0)
    expect(after._sessions['missing-session'].totalCostUsd).toBe(0)
  })

  it('uses defaultPermissionMode from user preferences', async () => {
    setupProject('/test')
    mockWindowApp.getUserPreferences.mockResolvedValue({
      outputStyle: '',
      defaultPermissionMode: 'acceptEdits',
      defaultSandboxMode: '',
    })
    invalidateDefaultPermissionModeCache()
    await new Promise((r) => setTimeout(r, 0))
    mockWindowApp.loadSessionState.mockResolvedValue({
      messages: [],
      totalCostUsd: 0,
      contextTokens: 0,
      gitBranch: null,
      provider: 'claude',
    })

    await useChatStore.getState().switchSession('pref-session')

    const after = useChatStore.getState().projectSessions['/test']
    expect(after._sessions['pref-session'].permissionMode).toBe('acceptEdits')
    expect(mockWindowApp.resumeSession).toHaveBeenCalledWith('/test', 'pref-session', '/test', 'acceptEdits')
  })

  it('passes permissionMode to resumeSession in Case B', async () => {
    setupProject('/test')
    mockWindowApp.getUserPreferences.mockResolvedValue({ outputStyle: '', defaultPermissionMode: '', defaultSandboxMode: '' })
    mockWindowApp.loadSessionState.mockResolvedValue({
      messages: [],
      totalCostUsd: 0,
      contextTokens: 0,
      gitBranch: null,
      provider: 'claude',
    })
    mockWindowApp.resumeSession.mockResolvedValue(undefined)

    await useChatStore.getState().switchSession('order-session')

    expect(mockWindowApp.resumeSession).toHaveBeenCalledWith('/test', 'order-session', '/test', 'default')
  })
})

describe('switchSession Case A permissionMode sync', () => {
  it('passes target permissionMode to resumeSession atomically', async () => {
    setupProject('/test')
    const proj = useChatStore.getState().projectSessions['/test']

    useChatStore.setState({
      projectSessions: {
        '/test': {
          ...proj,
          _activeSessionId: 'ses-a',
          _sessions: {
            'ses-a': { ...createDefaultPerSessionState(), permissionMode: 'acceptEdits' as never },
            'ses-b': { ...createDefaultPerSessionState(), permissionMode: 'default' as never, sessionProvider: 'claude' },
          },
        },
      },
    })

    mockWindowApp.resumeSession.mockResolvedValue(undefined)

    await useChatStore.getState().switchSession('ses-b')

    expect(mockWindowApp.resumeSession).toHaveBeenCalledWith('/test', 'ses-b', '/test', 'default')
  })

  it('does not overwrite old session permissionMode when switching', async () => {
    setupProject('/test')
    const proj = useChatStore.getState().projectSessions['/test']

    useChatStore.setState({
      projectSessions: {
        '/test': {
          ...proj,
          _activeSessionId: 'ses-a',
          _sessions: {
            'ses-a': { ...createDefaultPerSessionState(), permissionMode: 'acceptEdits' as never },
            'ses-b': { ...createDefaultPerSessionState(), permissionMode: 'default' as never, sessionProvider: 'claude' },
          },
        },
      },
    })

    mockWindowApp.resumeSession.mockResolvedValue(undefined)

    await useChatStore.getState().switchSession('ses-b')

    const after = useChatStore.getState().projectSessions['/test']
    expect(after._sessions['ses-a'].permissionMode).toBe('acceptEdits')
    expect(after._sessions['ses-b'].permissionMode).toBe('default')
  })
})

describe('deferred resume on sendMessage', () => {
  it('resumes non-running Claude session right before send', async () => {
    setupProject('/test')
    const proj = useChatStore.getState().projectSessions['/test']

    useChatStore.setState({
      projectSessions: {
        '/test': {
          ...proj,
          _activeSessionId: 'db-session',
          _sessions: {
            ...proj._sessions,
            'db-session': {
              ...createDefaultPerSessionState(),
              sessionProvider: 'claude',
              messages: [
                { id: 'hist-1', role: 'user', content: [{ type: 'text', text: 'history' }], status: 'complete', createdAt: '', providerId: 'claude' },
              ] as never[],
            },
          },
        },
      },
    })

    mockWindowAgent.getSessionId.mockResolvedValue('another-session')
    mockWindowAgent.activateSession.mockRejectedValue(new Error('No background session'))

    await useChatStore.getState().sendMessage('hello')

    expect(mockWindowApp.resumeSession).toHaveBeenCalledWith('/test', 'db-session', '/test')
    expect(mockWindowAgent.sendMessage).toHaveBeenCalled()
  })
})

describe('codex plan mode', () => {
  it('toggles codex plan mode via the shortcut action', () => {
    setupProject('/test')
    const proj = useChatStore.getState().projectSessions['/test']

    useChatStore.setState({
      projectSessions: {
        '/test': {
          ...proj,
          _sessions: {
            ...proj._sessions,
            [draftOf(proj)]: {
              ...proj._sessions[draftOf(proj)],
              preferredProvider: 'codex',
              selectedCodexCollaborationMode: 'default',
            },
          },
        },
      },
    })

    useChatStore.getState().togglePlanModeShortcut()
    expect(getActiveDraftSession('/test')!.selectedCodexCollaborationMode).toBe('plan')

    useChatStore.getState().togglePlanModeShortcut()
    expect(getActiveDraftSession('/test')!.selectedCodexCollaborationMode).toBe('default')
  })

  it('activates plan mode via /plan slash command without popup or chat messages', async () => {
    setupProject('/test')
    const proj = useChatStore.getState().projectSessions['/test']

    useChatStore.setState({
      projectSessions: {
        '/test': {
          ...proj,
          _sessions: {
            ...proj._sessions,
            [draftOf(proj)]: {
              ...proj._sessions[draftOf(proj)],
              preferredProvider: 'codex',
              selectedCodexCollaborationMode: 'default',
            },
          },
        },
      },
    })

    await useChatStore.getState().sendMessage('/plan')

    const proj2 = useChatStore.getState().projectSessions['/test']
    const activeId = proj2._activeSessionId!
    const session = proj2._sessions[activeId]
    expect(session.selectedCodexCollaborationMode).toBe('plan')
    expect(session.messages).toHaveLength(0)
    expect(session.slashCommandOutput).toBeFalsy()
    expect(mockWindowApp.codexRun).not.toHaveBeenCalled()
  })

  it('passes plan collaboration mode to codex runs', async () => {
    setupProject('/test')
    const proj = useChatStore.getState().projectSessions['/test']

    useChatStore.setState({
      projectSessions: {
        '/test': {
          ...proj,
          _sessions: {
            ...proj._sessions,
            [draftOf(proj)]: {
              ...proj._sessions[draftOf(proj)],
              preferredProvider: 'codex',
              selectedCodexModel: 'gpt-5.1-codex',
              selectedCodexCollaborationMode: 'plan',
            },
          },
        },
      },
    })

    await useChatStore.getState().sendMessage('hello')

    const call = mockWindowApp.codexRun.mock.calls.at(-1)
    expect(call).toBeTruthy()
    expect(call?.[1]).toBe('/test')
    expect(call?.[2]).toBe('hello')
    expect(call?.[6]).toBe('plan')
  })

  it('passes default collaboration mode to codex runs', async () => {
    setupProject('/test')
    const proj = useChatStore.getState().projectSessions['/test']

    useChatStore.setState({
      projectSessions: {
        '/test': {
          ...proj,
          _sessions: {
            ...proj._sessions,
            [draftOf(proj)]: {
              ...proj._sessions[draftOf(proj)],
              preferredProvider: 'codex',
              selectedCodexModel: 'gpt-5.1-codex',
              selectedCodexCollaborationMode: 'default',
            },
          },
        },
      },
    })

    await useChatStore.getState().sendMessage('hello')

    const call = mockWindowApp.codexRun.mock.calls.at(-1)
    expect(call).toBeTruthy()
    expect(call?.[1]).toBe('/test')
    expect(call?.[2]).toBe('hello')
    expect(call?.[6]).toBe('default')
  })

  it('approves codex plan with default collaboration mode without consuming draft attachments or mentions', async () => {
    setupProject('/test')
    const proj = useChatStore.getState().projectSessions['/test']
    const attachment = { name: 'img.png', data: 'base64', mimeType: 'image/png' } as never
    const mention = { kind: 'file', value: '/test/src/app.ts', displayName: 'app.ts' } as never

    useChatStore.setState({
      projectSessions: {
        '/test': {
          ...proj,
          _activeSessionId: 'codex-session',
          hasPendingInteraction: false,
          _sessions: {
            ...proj._sessions,
            'codex-session': {
              ...createDefaultPerSessionState(),
              preferredProvider: 'codex',
              sessionProvider: 'codex',
              selectedCodexCollaborationMode: 'plan',
              draftText: 'keep this draft',
              attachments: [attachment],
              mentions: [mention],
              lastAssistantMessageId: 'assistant-1',
              messages: [{
                id: 'assistant-1',
                role: 'assistant',
                status: 'complete',
                content: [{ type: 'text', text: 'plan' }],
                createdAt: '',
                providerId: 'codex',
                metadata: {
                  codex: {
                    threadId: 'thread-1',
                    usage: null,
                    items: [{ id: 'plan-1', type: 'plan', text: '## Plan' }],
                  },
                },
              }] as never[],
            },
          },
        },
      },
    })

    await useChatStore.getState().approveCodexPlan()

    const call = mockWindowApp.codexRun.mock.calls.at(-1)
    expect(call).toBeTruthy()
    expect(call?.[2]).toBe('Plan approved, start implementation.')
    expect(call?.[6]).toBe('default')
    expect(call?.[9]).toBeUndefined()

    const session = useChatStore.getState().projectSessions['/test']._sessions['codex-session']
    expect(session.selectedCodexCollaborationMode).toBe('default')
    expect(session.draftText).toBe('keep this draft')
    expect(session.attachments).toEqual([attachment])
    expect(session.mentions).toEqual([mention])
    expect(session.messages.find((message) => message.id === 'assistant-1')?.metadata?.codex?.planApproval).toEqual({
      status: 'approved',
    })
    expect(session.messages.findLast((message) => message.role === 'user')?.content).toEqual([{
      type: 'text',
      text: 'Plan approved, start implementation.',
    }])
  })

  it('rejects codex plan with feedback without consuming draft attachments or mentions', async () => {
    setupProject('/test')
    const proj = useChatStore.getState().projectSessions['/test']
    const attachment = { name: 'img.png', data: 'base64', mimeType: 'image/png' } as never
    const mention = { kind: 'file', value: '/test/src/app.ts', displayName: 'app.ts' } as never

    useChatStore.setState({
      projectSessions: {
        '/test': {
          ...proj,
          _activeSessionId: 'codex-session',
          hasPendingInteraction: false,
          _sessions: {
            ...proj._sessions,
            'codex-session': {
              ...createDefaultPerSessionState(),
              preferredProvider: 'codex',
              sessionProvider: 'codex',
              selectedCodexCollaborationMode: 'plan',
              draftText: 'keep this draft',
              attachments: [attachment],
              mentions: [mention],
              lastAssistantMessageId: 'assistant-1',
              messages: [{
                id: 'assistant-1',
                role: 'assistant',
                status: 'complete',
                content: [{ type: 'text', text: 'plan' }],
                createdAt: '',
                providerId: 'codex',
                metadata: {
                  codex: {
                    threadId: 'thread-1',
                    usage: null,
                    items: [{ id: 'plan-1', type: 'plan', text: '## Plan' }],
                  },
                },
              }] as never[],
            },
          },
        },
      },
    })

    await useChatStore.getState().rejectCodexPlan('Only touch the renderer layer.')

    const call = mockWindowApp.codexRun.mock.calls.at(-1)
    expect(call?.[2]).toBe('Only touch the renderer layer.')
    expect(call?.[6]).toBe('plan')
    expect(call?.[9]).toBeUndefined()
    const session = useChatStore.getState().projectSessions['/test']._sessions['codex-session']
    expect(session.selectedCodexCollaborationMode).toBe('plan')
    expect(session.draftText).toBe('keep this draft')
    expect(session.attachments).toEqual([attachment])
    expect(session.mentions).toEqual([mention])
    expect(session.messages.find((message) => message.id === 'assistant-1')?.metadata?.codex?.planApproval).toEqual({
      status: 'rejected',
      feedback: 'Only touch the renderer layer.',
    })
    expect(session.messages.findLast((message) => message.role === 'user')?.content).toEqual([{
      type: 'text',
      text: 'Only touch the renderer layer.',
    }])
  })

  it('focuses chat input instead of sending when rejecting codex plan without feedback', async () => {
    setupProject('/test')
    const proj = useChatStore.getState().projectSessions['/test']

    useChatStore.setState({
      projectSessions: {
        '/test': {
          ...proj,
          _activeSessionId: 'codex-session',
          hasPendingInteraction: false,
          _sessions: {
            ...proj._sessions,
            'codex-session': {
              ...createDefaultPerSessionState(),
              preferredProvider: 'codex',
              sessionProvider: 'codex',
              selectedCodexCollaborationMode: 'plan',
              lastAssistantMessageId: 'assistant-1',
              messages: [{
                id: 'assistant-1',
                role: 'assistant',
                status: 'complete',
                content: [{ type: 'text', text: 'plan' }],
                createdAt: '',
                providerId: 'codex',
                metadata: {
                  codex: {
                    threadId: 'thread-1',
                    usage: null,
                    items: [{ id: 'plan-1', type: 'plan', text: '## Plan' }],
                  },
                },
              }] as never[],
            },
          },
        },
      },
    })

    await useChatStore.getState().rejectCodexPlan()

    expect(mockWindowApp.codexRun).not.toHaveBeenCalled()
    const session = useChatStore.getState().projectSessions['/test']._sessions['codex-session']
    expect(session.selectedCodexCollaborationMode).toBe('plan')
    expect(session.codexPlanRejectHintActive).toBe(true)
    expect(session.chatInputFocusNonce).toBe(1)
    expect(session.messages.find((message) => message.id === 'assistant-1')?.metadata?.codex?.planApproval).toEqual({
      status: 'rejected',
    })
    expect(mockWindowApp.codexPlanApproval).toHaveBeenCalledWith('/test', 'codex-session', 'assistant-1', 'rejected')
  })

  it('approveCodexPlan emits plan approval and mode change IPCs', async () => {
    setupProject('/test')
    const proj = useChatStore.getState().projectSessions['/test']

    useChatStore.setState({
      projectSessions: {
        '/test': {
          ...proj,
          _activeSessionId: 'codex-session',
          hasPendingInteraction: false,
          _sessions: {
            ...proj._sessions,
            'codex-session': {
              ...createDefaultPerSessionState(),
              preferredProvider: 'codex',
              sessionProvider: 'codex',
              selectedCodexCollaborationMode: 'plan',
              lastAssistantMessageId: 'assistant-1',
              messages: [{
                id: 'assistant-1',
                role: 'assistant',
                status: 'complete',
                content: [{ type: 'text', text: 'plan' }],
                createdAt: '',
                providerId: 'codex',
                metadata: {
                  codex: { threadId: 'thread-1', usage: null, items: [{ id: 'plan-1', type: 'plan', text: '## Plan' }] },
                },
              }] as never[],
            },
          },
        },
      },
    })

    await useChatStore.getState().approveCodexPlan()

    expect(mockWindowApp.codexPlanApproval).toHaveBeenCalledWith('/test', 'codex-session', 'assistant-1', 'approved')
    expect(mockWindowApp.codexCollaborationModeChange).toHaveBeenCalledWith('/test', 'codex-session', 'default')
  })

  it('rejectCodexPlan with feedback emits plan approval IPC', async () => {
    setupProject('/test')
    const proj = useChatStore.getState().projectSessions['/test']

    useChatStore.setState({
      projectSessions: {
        '/test': {
          ...proj,
          _activeSessionId: 'codex-session',
          hasPendingInteraction: false,
          _sessions: {
            ...proj._sessions,
            'codex-session': {
              ...createDefaultPerSessionState(),
              preferredProvider: 'codex',
              sessionProvider: 'codex',
              selectedCodexCollaborationMode: 'plan',
              lastAssistantMessageId: 'assistant-1',
              messages: [{
                id: 'assistant-1',
                role: 'assistant',
                status: 'complete',
                content: [{ type: 'text', text: 'plan' }],
                createdAt: '',
                providerId: 'codex',
                metadata: {
                  codex: { threadId: 'thread-1', usage: null, items: [{ id: 'plan-1', type: 'plan', text: '## Plan' }] },
                },
              }] as never[],
            },
          },
        },
      },
    })

    await useChatStore.getState().rejectCodexPlan('Use a different approach.')

    expect(mockWindowApp.codexPlanApproval).toHaveBeenCalledWith('/test', 'codex-session', 'assistant-1', 'rejected', 'Use a different approach.')
  })
})

describe('awaitingAssistantReply state machine', () => {
  it('sets awaitingAssistantReply true when sending a new Claude turn', async () => {
    setupProject('/test')
    useChatStore.setState({
      availableModels: [{ id: 'claude-sonnet-4-6', name: 'Sonnet', supportedEffortLevels: ['low', 'medium', 'high'] }] as never[],
    })

    await useChatStore.getState().sendMessage('hello')

    const projectState = useChatStore.getState().projectSessions['/test']
    const session = projectState._sessions[projectState._activeSessionId!]
    expect(session.awaitingAssistantReply).toBe(true)
  })

  it('clears awaitingAssistantReply on message_start', async () => {
    setupProject('/test')
    useChatStore.setState((s) => {
      const proj = s.projectSessions['/test']
      return {
        projectSessions: {
          ...s.projectSessions,
          '/test': {
            ...proj,
            _sessions: {
              ...proj._sessions,
              [draftOf(proj)]: {
                ...proj._sessions[draftOf(proj)],
                awaitingAssistantReply: true,
              },
            },
          },
        },
      }
    })

    useChatStore.getState().handleAgentEvent(makeEvent({
      type: 'message_start',
      message: { id: 'asst-1', role: 'assistant', content: [], status: 'streaming', createdAt: '', providerId: 'claude' } as never,
    }))

    const projectState = useChatStore.getState().projectSessions['/test']
    const session = projectState._sessions[projectState._activeSessionId!]
    expect(session.awaitingAssistantReply).toBe(false)
  })

  it('clears awaitingAssistantReply on message_error', () => {
    setupProject('/test')
    useChatStore.setState((s) => {
      const proj = s.projectSessions['/test']
      return {
        projectSessions: {
          ...s.projectSessions,
          '/test': {
            ...proj,
            _sessions: {
              ...proj._sessions,
              [draftOf(proj)]: {
                ...proj._sessions[draftOf(proj)],
                awaitingAssistantReply: true,
              },
            },
          },
        },
      }
    })

    useChatStore.getState().handleAgentEvent(makeEvent({
      type: 'message_error',
      messageId: 'missing-msg',
      error: 'network error',
    }))

    const session = getActiveDraftSession('/test')!
    expect(session.awaitingAssistantReply).toBe(false)
  })

  it('clears awaitingAssistantReply when sendMessage throws', async () => {
    setupProject('/test')
    useChatStore.setState({
      availableModels: [{ id: 'claude-sonnet-4-6', name: 'Sonnet', supportedEffortLevels: ['low', 'medium', 'high'] }] as never[],
    })
    mockWindowAgent.sendMessage.mockRejectedValueOnce(new Error('send failed'))

    await expect(useChatStore.getState().sendMessage('hello')).rejects.toThrow('send failed')

    const session = getActiveDraftSession('/test')!
    expect(session.awaitingAssistantReply).toBe(false)
  })

  it('keeps awaitingAssistantReply on status_change idle', () => {
    setupProject('/test')
    const did = getActiveDraftId('/test')!
    useChatStore.setState((s) => {
      const proj = s.projectSessions['/test']
      return {
        projectSessions: {
          ...s.projectSessions,
          '/test': {
            ...proj,
            _sessions: {
              ...proj._sessions,
              [draftOf(proj)]: {
                ...proj._sessions[draftOf(proj)],
                awaitingAssistantReply: true,
              },
            },
          },
        },
      }
    })

    useChatStore.getState().handleAgentEvent(makeEvent({
      type: 'status_change',
      sessionId: did,
      status: 'idle',
    }))

    const session = getActiveDraftSession('/test')!
    expect(session.awaitingAssistantReply).toBe(true)
  })
})

describe('codex steer routing', () => {
  it('creates a new assistant placeholder for steer and retargets codex events to it', async () => {
    setupProject('/test')
    const proj = useChatStore.getState().projectSessions['/test']
    const codexSid = 'codex_local_steer_test'

    useChatStore.setState({
      projectSessions: {
        '/test': {
          ...proj,
          _activeSessionId: codexSid,
          _sessions: {
            [codexSid]: {
              ...proj._sessions[draftOf(proj)],
              status: 'streaming',
              sessionProvider: 'codex',
              preferredProvider: 'codex',
              activeCodexMessageId: 'codex-prev',
              messages: [
                {
                  id: 'codex-prev',
                  role: 'assistant',
                  status: 'streaming',
                  content: [{ type: 'text', text: 'previous response' }],
                  createdAt: '',
                  providerId: 'codex',
                },
              ] as never[],
            },
          },
        },
      },
    })

    await useChatStore.getState().sendMessage('steer follow-up')

    const projectState = useChatStore.getState().projectSessions['/test']
    const session = projectState._sessions[projectState._activeSessionId!]
    const lastMessage = session.messages.at(-1)
    const steerUserMessage = session.messages.at(-2)

    expect(steerUserMessage?.role).toBe('user')
    expect(lastMessage?.role).toBe('assistant')
    expect(lastMessage?.providerId).toBe('codex')
    expect(lastMessage?.status).toBe('streaming')
    expect(lastMessage?.id).toBe(session.activeCodexMessageId)
    expect(session.lastAssistantMessageId).toBe(lastMessage?.id)
    const call = mockWindowApp.codexSteer.mock.calls.at(-1)
    expect(call?.[0]).toBe(codexSid)
    expect(call?.[1]).toBe('steer follow-up')
    expect(call?.[2]).toBe(lastMessage?.id)
    expect(call?.[3]).toBeTruthy()
    expect(call?.[4]).toBe('steer follow-up')
  })
})

describe('codex item streaming behavior', () => {
  it('keeps reasoning visible after non-reasoning codex items arrive', () => {
    setupProject('/test')
    const proj = useChatStore.getState().projectSessions['/test']

    useChatStore.setState({
      projectSessions: {
        '/test': {
          ...proj,
          _sessions: {
            ...proj._sessions,
            [draftOf(proj)]: {
              ...proj._sessions[draftOf(proj)],
              status: 'streaming',
              messages: [
                {
                  id: 'codex-msg',
                  role: 'assistant',
                  status: 'streaming',
                  content: [],
                  createdAt: '',
                  providerId: 'codex',
                  metadata: {
                    codex: {
                      threadId: 'thread-1',
                      usage: null,
                      items: [],
                    },
                  },
                },
              ] as never[],
            },
          },
        },
      },
    })

    useChatStore.getState().handleAgentEvent(makeEvent({
      type: 'codex_item_delta',
      messageId: 'codex-msg',
      phase: 'updated',
      item: { id: 'reason-1', type: 'reasoning', text: 'Thinking' },
    }))

    useChatStore.getState().handleAgentEvent(makeEvent({
      type: 'codex_item_delta',
      messageId: 'codex-msg',
      phase: 'completed',
      item: { id: 'reason-1', type: 'reasoning', text: 'Thinking' },
    }))

    let items = getActiveDraftSession('/test')!.messages[0].metadata?.codex?.items ?? []
    expect(items).toEqual([{ id: 'reason-1', type: 'reasoning', text: 'Thinking' }])

    useChatStore.getState().handleAgentEvent(makeEvent({
      type: 'codex_item_delta',
      messageId: 'codex-msg',
      phase: 'started',
      item: { id: 'cmd-1', type: 'command_execution', command: 'ls', aggregatedOutput: '', status: 'in_progress' },
    }))

    items = getActiveDraftSession('/test')!.messages[0].metadata?.codex?.items ?? []
    expect(items).toEqual([
      { id: 'reason-1', type: 'reasoning', text: 'Thinking' },
      { id: 'cmd-1', type: 'command_execution', command: 'ls', aggregatedOutput: '', status: 'in_progress' },
    ])
  })
})

describe('codex usage semantics', () => {
  it('accumulates fresh last-usage deltas while keeping context tokens separate', () => {
    setupProject('/test')
    const proj = useChatStore.getState().projectSessions['/test']

    useChatStore.setState({
      projectSessions: {
        '/test': {
          ...proj,
          _sessions: {
            ...proj._sessions,
            [draftOf(proj)]: {
              ...proj._sessions[draftOf(proj)],
              sessionProvider: 'codex',
              preferredProvider: 'codex',
            },
          },
        },
      },
    })

    useChatStore.getState().handleAgentEvent(makeEvent({
      type: 'message_usage',
      messageId: 'codex-msg-1',
      inputTokens: 70,
      outputTokens: 15,
      codexUsage: {
        totalInputTokens: 1100,
        totalCachedInputTokens: 560,
        totalOutputTokens: 215,
        lastInputTokens: 70,
        lastCachedInputTokens: 69,
        lastOutputTokens: 15,
        reasoningOutputTokens: 55,
        contextWindow: 258400,
      },
    }))

    const session = getActiveDraftSession('/test')!
    expect(session.contextTokens).toBe(70)
    expect(session.contextWindow).toBe(258400)
    expect(session.streamingTokens).toEqual({ input: 1, output: 15 })
    expect(session.codexUsageSnapshot?.totalInputTokens).toBe(1100)
    useChatStore.getState().handleAgentEvent(makeEvent({
      type: 'message_usage',
      messageId: 'codex-msg-2',
      inputTokens: 30,
      outputTokens: 5,
      codexUsage: {
        totalInputTokens: 1130,
        totalCachedInputTokens: 580,
        totalOutputTokens: 220,
        lastInputTokens: 30,
        lastCachedInputTokens: 20,
        lastOutputTokens: 5,
        reasoningOutputTokens: 55,
        contextWindow: 258400,
      },
    }))

    const updatedSession = getActiveDraftSession('/test')!
    expect(updatedSession.contextTokens).toBe(30)
    expect(updatedSession.streamingTokens).toEqual({ input: 11, output: 20 })
  })

  it('does not double-count duplicate last-usage snapshots', () => {
    setupProject('/test')

    useChatStore.getState().handleAgentEvent(makeEvent({
      type: 'message_usage',
      messageId: 'codex-msg-3',
      inputTokens: 70,
      outputTokens: 15,
      codexUsage: {
        totalInputTokens: 1100,
        totalCachedInputTokens: 560,
        totalOutputTokens: 215,
        lastInputTokens: 70,
        lastCachedInputTokens: 69,
        lastOutputTokens: 15,
        reasoningOutputTokens: 55,
        contextWindow: 258400,
      },
    }))

    useChatStore.getState().handleAgentEvent(makeEvent({
      type: 'message_usage',
      messageId: 'codex-msg-3',
      inputTokens: 70,
      outputTokens: 15,
      codexUsage: {
        totalInputTokens: 1100,
        totalCachedInputTokens: 560,
        totalOutputTokens: 215,
        lastInputTokens: 70,
        lastCachedInputTokens: 69,
        lastOutputTokens: 15,
        reasoningOutputTokens: 55,
        contextWindow: 258400,
      },
    }))

    const session = getActiveDraftSession('/test')!
    expect(session.contextTokens).toBe(70)
    expect(session.streamingTokens).toEqual({ input: 1, output: 15 })
  })
})

describe('codex question routing', () => {
  it('routes answerQuestion through codex IPC for codex sessions', () => {
    setupProject('/test')
    const proj = useChatStore.getState().projectSessions['/test']
    const codexSid = 'codex_local_q_test'

    useChatStore.setState({
      projectSessions: {
        '/test': {
          ...proj,
          _activeSessionId: codexSid,
          _sessions: {
            [codexSid]: {
              ...proj._sessions[draftOf(proj)],
              sessionProvider: 'codex',
              preferredProvider: 'codex',
              pendingQuestion: {
                requestId: 'q1',
                questions: [],
              },
            },
          },
        },
      },
    })

    useChatStore.getState().answerQuestion('q1', { q1: 'Answer' })

    expect(mockWindowApp.codexAnswerQuestion).toHaveBeenCalledWith(codexSid, 'q1', { q1: 'Answer' })
    expect(mockWindowAgent.answerQuestion).not.toHaveBeenCalled()
    expect(useChatStore.getState().projectSessions['/test']._sessions[codexSid].pendingQuestion).toBeNull()
  })

  it('routes dismissQuestion through codex IPC for codex sessions', () => {
    setupProject('/test')
    const proj = useChatStore.getState().projectSessions['/test']
    const codexSid = 'codex_local_d_test'

    useChatStore.setState({
      projectSessions: {
        '/test': {
          ...proj,
          _activeSessionId: codexSid,
          _sessions: {
            [codexSid]: {
              ...proj._sessions[draftOf(proj)],
              sessionProvider: 'codex',
              preferredProvider: 'codex',
              pendingQuestion: {
                requestId: 'q1',
                questions: [],
              },
            },
          },
        },
      },
    })

    useChatStore.getState().dismissQuestion('q1')

    expect(mockWindowApp.codexDismissQuestion).toHaveBeenCalledWith(codexSid, 'q1')
    expect(mockWindowAgent.dismissQuestion).not.toHaveBeenCalled()
    expect(useChatStore.getState().projectSessions['/test']._sessions[codexSid].pendingQuestion).toBeNull()
  })
})

describe('message_interrupted clears pending states', () => {
  it('clears pendingPermission, pendingQuestion, pendingPlanApproval on interrupt', () => {
    setupProject('/test')
    const proj = useChatStore.getState().projectSessions['/test']
    const msgId = 'msg-1'

    useChatStore.setState({
      projectSessions: {
        '/test': {
          ...proj,
          _activeSessionId: 'a',
          hasPendingInteraction: true,
          _sessions: {
            a: {
              ...createDefaultPerSessionState(),
              status: 'streaming' as const,
              messages: [{ id: msgId, role: 'assistant' as const, content: [], status: 'streaming' as const, createdAt: '', providerId: 'claude' }],
              pendingPermissions: [{ requestId: 'r1', toolName: 'Bash', description: 'run ls' } as never],
              pendingQuestion: { requestId: 'q1', questions: [] } as never,
              pendingPlanApproval: { requestId: 'p1', planContent: '' } as never,
            },
          },
        },
      },
    })

    useChatStore.getState().handleAgentEvent(makeEvent({
      type: 'message_interrupted',
      sessionId: 'a',
      messageId: msgId,
    }))

    const after = useChatStore.getState().projectSessions['/test']
    const session = after._sessions['a']
    expect(session.pendingPermissions).toEqual([])
    expect(session.pendingQuestion).toBeNull()
    expect(session.pendingPlanApproval).toBeNull()
    expect(session.messages[0].status).toBe('interrupted')
    expect(after.hasPendingInteraction).toBe(false)
  })
})

describe('hasPendingInteraction across multiple sessions', () => {
  it('stays true until ALL sessions clear pending state', () => {
    setupProject('/test')
    const proj = useChatStore.getState().projectSessions['/test']

    useChatStore.setState({
      projectSessions: {
        '/test': {
          ...proj,
          _activeSessionId: 'a',
          hasPendingInteraction: true,
          _sessions: {
            a: { ...createDefaultPerSessionState(), pendingPermissions: [{ requestId: 'r1', toolName: 'Bash', description: 'ls' } as never] },
            b: { ...createDefaultPerSessionState(), pendingQuestion: { requestId: 'q1', question: 'pick' } as never },
          },
        },
      },
    })

    // Clear only session a's pending — b still has pendingQuestion
    useChatStore.setState({
      projectSessions: {
        '/test': {
          ...useChatStore.getState().projectSessions['/test'],
          _sessions: {
            ...useChatStore.getState().projectSessions['/test']._sessions,
            a: { ...createDefaultPerSessionState() },
          },
        },
      },
    })
    // Trigger recomputation via any event
    useChatStore.getState().handleAgentEvent(makeEvent({
      type: 'status_change', sessionId: 'a', status: 'streaming',
    }))
    expect(useChatStore.getState().projectSessions['/test'].hasPendingInteraction).toBe(true)

    // Clear session b's pending too
    useChatStore.setState({
      projectSessions: {
        '/test': {
          ...useChatStore.getState().projectSessions['/test'],
          _sessions: {
            ...useChatStore.getState().projectSessions['/test']._sessions,
            b: { ...createDefaultPerSessionState() },
          },
        },
      },
    })
    useChatStore.getState().handleAgentEvent(makeEvent({
      type: 'status_change', sessionId: 'a', status: 'idle',
    }))
    expect(useChatStore.getState().projectSessions['/test'].hasPendingInteraction).toBe(false)
  })
})

describe('task_started event', () => {
  it('initializes taskProgress for the toolUseId', () => {
    setupProject('/test')
    useChatStore.getState().handleAgentEvent(makeEvent({
      type: 'task_started',
      taskId: 'task-1',
      toolUseId: 'tool-abc',
      description: 'Running background agent',
    }))
    const session = getActiveDraftSession('/test')!
    const progress = session.taskProgress['tool-abc']
    expect(progress).toBeDefined()
    expect(progress.description).toBe('Running background agent')
    expect(progress.completed).toBe(false)
    expect(progress.toolHistory).toEqual([])
  })

  it('preserves existing taskProgress fields', () => {
    setupProject('/test')
    useChatStore.getState().handleAgentEvent(makeEvent({
      type: 'task_started',
      taskId: 'task-1',
      toolUseId: 'tool-abc',
      description: 'first',
    }))
    useChatStore.getState().handleAgentEvent(makeEvent({
      type: 'task_progress',
      taskId: 'task-1',
      toolUseId: 'tool-abc',
      description: 'progressing',
      lastToolName: 'Bash',
      usage: { totalTokens: 100, toolUses: 2, durationMs: 500 },
    }))
    const session = getActiveDraftSession('/test')!
    const progress = session.taskProgress['tool-abc']
    expect(progress.description).toBe('progressing')
    expect(progress.totalTokens).toBe(100)
    expect(progress.toolUses).toBe(2)
  })

  it('preserves completed background task state across late progress updates', () => {
    setupProject('/test')
    useChatStore.getState().handleAgentEvent(makeEvent({
      type: 'task_started',
      taskId: 'task-1',
      toolUseId: 'tool-abc',
      description: 'starting',
    }))
    useChatStore.getState().handleAgentEvent(makeEvent({
      type: 'task_notification',
      taskId: 'task-1',
      toolUseId: 'tool-abc',
      taskStatus: 'completed',
      outputFile: '/tmp/out.log',
      usage: { totalTokens: 50, toolUses: 1, durationMs: 300 },
    }))
    useChatStore.getState().handleAgentEvent(makeEvent({
      type: 'task_progress',
      taskId: 'task-1',
      toolUseId: 'tool-abc',
      description: 'late progress',
      lastToolName: 'Bash',
      usage: { totalTokens: 100, toolUses: 2, durationMs: 500 },
    }))

    const session = getActiveDraftSession('/test')!
    const progress = session.taskProgress['tool-abc']
    expect(progress.description).toBe('late progress')
    expect(progress.totalTokens).toBe(100)
    expect(progress.toolUses).toBe(2)
    expect(progress.completed).toBe(true)
    expect(progress.outputFile).toBe('/tmp/out.log')
  })

  function seedAgentBlock(toolUseId: string) {
    useChatStore.setState((s) => {
      const project = s.projectSessions['/test']
      const session = project._sessions[draftOf(project)]
      return {
        projectSessions: {
          ...s.projectSessions,
          '/test': {
            ...project,
            _sessions: {
              ...project._sessions,
              [draftOf(project)]: {
                ...session,
                messages: [{
                  id: 'msg-1', role: 'assistant' as const, status: 'streaming' as const,
                  content: [{ type: 'tool_use' as const, toolName: 'Agent', toolUseId, input: '{"run_in_background":true}' }],
                  createdAt: '', providerId: 'claude',
                }],
              },
            },
          },
        },
      }
    })
  }

  it('task_progress patches Agent tool_use block with taskUsage and taskToolHistory', () => {
    setupProject('/test')
    seedAgentBlock('tool-abc')
    useChatStore.getState().handleAgentEvent(makeEvent({
      type: 'task_started',
      taskId: 'task-1',
      toolUseId: 'tool-abc',
      description: 'starting',
    }))
    useChatStore.getState().handleAgentEvent(makeEvent({
      type: 'task_progress',
      taskId: 'task-1',
      toolUseId: 'tool-abc',
      description: 'reading files',
      lastToolName: 'Read',
      usage: { totalTokens: 200, toolUses: 3, durationMs: 1000 },
    }))
    const session = getActiveDraftSession('/test')!
    const block = session.messages[0].content[0]
    expect(block.type).toBe('tool_use')
    if (block.type !== 'tool_use') return
    expect(block.taskUsage).toEqual({ totalTokens: 200, toolUses: 3, durationMs: 1000 })
    expect(block.taskToolHistory).toEqual([{ toolName: '', description: 'starting' }])
  })

  it('task_notification patches Agent tool_use block with final state', () => {
    setupProject('/test')
    seedAgentBlock('tool-abc')
    useChatStore.getState().handleAgentEvent(makeEvent({
      type: 'task_started',
      taskId: 'task-1',
      toolUseId: 'tool-abc',
      description: 'starting',
    }))
    useChatStore.getState().handleAgentEvent(makeEvent({
      type: 'task_progress',
      taskId: 'task-1',
      toolUseId: 'tool-abc',
      description: 'reading files',
      lastToolName: 'Read',
      usage: { totalTokens: 200, toolUses: 3, durationMs: 1000 },
    }))
    useChatStore.getState().handleAgentEvent(makeEvent({
      type: 'task_notification',
      taskId: 'task-1',
      toolUseId: 'tool-abc',
      taskStatus: 'completed',
      summary: 'Done reading all files',
      usage: { totalTokens: 500, toolUses: 8, durationMs: 3000 },
    }))
    const session = getActiveDraftSession('/test')!
    const block = session.messages[0].content[0]
    expect(block.type).toBe('tool_use')
    if (block.type !== 'tool_use') return
    expect(block.taskUsage).toEqual({ totalTokens: 500, toolUses: 8, durationMs: 3000 })
    expect(block.taskToolHistory).toEqual([{ toolName: '', description: 'starting' }])
    expect(block.taskSummary).toBe('Done reading all files')
  })

  it('task data persists in block even without task_notification (interrupt case)', () => {
    setupProject('/test')
    seedAgentBlock('tool-abc')
    useChatStore.getState().handleAgentEvent(makeEvent({
      type: 'task_started',
      taskId: 'task-1',
      toolUseId: 'tool-abc',
      description: 'step 1',
    }))
    useChatStore.getState().handleAgentEvent(makeEvent({
      type: 'task_progress',
      taskId: 'task-1',
      toolUseId: 'tool-abc',
      description: 'step 2',
      lastToolName: 'Bash',
      summary: 'partial work',
      usage: { totalTokens: 100, toolUses: 2, durationMs: 500 },
    }))
    const session = getActiveDraftSession('/test')!
    const block = session.messages[0].content[0]
    expect(block.type).toBe('tool_use')
    if (block.type !== 'tool_use') return
    expect(block.taskUsage).toEqual({ totalTokens: 100, toolUses: 2, durationMs: 500 })
    expect(block.taskToolHistory).toEqual([{ toolName: '', description: 'step 1' }])
    expect(block.taskSummary).toBe('partial work')
  })
})

describe('worktree session save isolation', () => {
  it.skip('keeps each worktree session isolated in renderer state on re-key', () => {
    setupProject('/test')

    useChatStore.setState((s) => {
      const project = s.projectSessions['/test']
      return {
        projectSessions: {
          ...s.projectSessions,
          '/test': {
            ...project,
            _activeSessionId: draftOf(project),
            _sessions: {
              [draftOf(project)]: {
                ...createDefaultPerSessionState(),
                messages: [{ id: 'm1', role: 'user', content: [{ type: 'text', text: 'hello' }], status: 'complete', createdAt: '' }] as never[],
                _worktreeBaseBranch: 'feature-a',
                _worktreePath: '/worktrees/project/wt-A',
              },
            },
          },
        },
      }
    })

    useChatStore.getState().handleAgentEvent(makeEvent({
      type: 'session_init',
      session: { sessionId: 'wt-session-A' } as never,
    }))

    let project = useChatStore.getState().projectSessions['/test']
    expect(project._sessions['wt-session-A']._worktreePath).toBe('/worktrees/project/wt-A')

    const draftB = createDraftSessionId()
    useChatStore.setState((s) => {
      const project = s.projectSessions['/test']
      return {
        projectSessions: {
          ...s.projectSessions,
          '/test': {
            ...project,
            _activeSessionId: draftB,
            _sessions: {
              ...project._sessions,
              [draftB]: {
                ...createDefaultPerSessionState(),
                messages: [{ id: 'm2', role: 'user', content: [{ type: 'text', text: 'world' }], status: 'complete', createdAt: '' }] as never[],
                _worktreeBaseBranch: 'feature-b',
                _worktreePath: '/worktrees/project/wt-B',
              },
            },
          },
        },
      }
    })

    useChatStore.getState().handleAgentEvent(makeEvent({
      type: 'session_init',
      session: { sessionId: 'wt-session-B' } as never,
    }))

    project = useChatStore.getState().projectSessions['/test']
    expect(project._sessions['wt-session-B']._worktreePath).toBe('/worktrees/project/wt-B')
    expect(mockWindowApp.createSession).not.toHaveBeenCalled()
  })
})

describe('switchSession Case B codex usage restore', () => {
  it('restores codex context window from saved message metadata', async () => {
    setupProject('/test')
    mockWindowApp.loadSessionState.mockResolvedValue({
      messages: [{
        id: 'db-codex',
        role: 'assistant',
        content: [{ type: 'text', text: 'done' }],
        status: 'complete',
        createdAt: '',
        providerId: 'codex',
        metadata: {
          codex: {
            threadId: 'thread-1',
            usage: {
              totalInputTokens: 1320345,
              totalCachedInputTokens: 1155840,
              totalOutputTokens: 4200,
              lastInputTokens: 70105,
              lastCachedInputTokens: 69376,
              lastOutputTokens: 300,
              reasoningOutputTokens: 120,
              contextWindow: 258400,
            },
            items: [],
          },
        },
      }] as never[],
      totalCostUsd: 0.05,
      contextTokens: 139481,
      gitBranch: null,
      provider: 'codex',
    })

    await useChatStore.getState().switchSession('db-codex-session')

    const session = useChatStore.getState().projectSessions['/test']._sessions['db-codex-session']
    expect(session.sessionProvider).toBe('codex')
    expect(session.contextTokens).toBe(139481)
    expect(session.contextWindow).toBe(258400)
    expect(session.codexUsageSnapshot?.lastCachedInputTokens).toBe(69376)
    expect(mockWindowApp.resumeSession).not.toHaveBeenCalled()
  })
})

describe('codex run session isolation', () => {
  it('writes run result to the originating session even after switching away', async () => {
    setupProject('/test')
    const proj = useChatStore.getState().projectSessions['/test']
    const codexSid = 'codex_local_A'

    useChatStore.setState({
      projectSessions: {
        '/test': {
          ...proj,
          _activeSessionId: codexSid,
          _sessions: {
            [codexSid]: {
              ...createDefaultPerSessionState(),
              sessionProvider: 'codex',
              preferredProvider: 'codex',
            },
            'ses-B': {
              ...createDefaultPerSessionState(),
              messages: [{ id: 'b-msg', role: 'user' as const, content: [{ type: 'text', text: 'hi' }], status: 'complete' as const, createdAt: '', providerId: 'claude' }] as never[],
            },
          },
        },
      },
    })

    let resolveCodexRun!: (v: unknown) => void
    mockWindowApp.codexRun.mockReturnValueOnce(
      new Promise((r) => { resolveCodexRun = r }),
    )

    const sendPromise = useChatStore.getState().sendMessage('test codex')

    await vi.waitFor(() => {
      expect(mockWindowApp.codexRun).toHaveBeenCalled()
    })

    useChatStore.setState((s) => ({
      projectSessions: {
        ...s.projectSessions,
        '/test': {
          ...s.projectSessions['/test'],
          _activeSessionId: 'ses-B',
        },
      },
    }))

    resolveCodexRun({
      threadId: 'thread-iso',
      finalResponse: 'isolation ok',
      usage: null,
      items: [
        { id: 'reason-1', type: 'reasoning', text: 'summary kept' },
        { id: 'agent-1', type: 'agent_message', text: 'isolation ok' },
      ],
    })
    await sendPromise

    const after = useChatStore.getState().projectSessions['/test']
    expect(after._activeSessionId).toBe('ses-B')

    const codexSession = after._sessions[codexSid]
    const assistantMsg = codexSession.messages.find((m) => m.role === 'assistant')
    expect(assistantMsg?.status).toBe('complete')
    expect(assistantMsg?.content[0]).toEqual({ type: 'text', text: 'isolation ok' })
    expect(assistantMsg?.metadata?.codex?.items).toEqual([
      { id: 'reason-1', type: 'reasoning', text: 'summary kept' },
      { id: 'agent-1', type: 'agent_message', text: 'isolation ok' },
    ])
    expect(codexSession.status).toBe('idle')

    const sesB = after._sessions['ses-B']
    expect(sesB.messages).toHaveLength(1)
    expect(sesB.messages[0].id).toBe('b-msg')

    expect(after.unseenCompletedSessions.has(codexSid)).toBe(true)
    expect(mockWindowApp.createSession).not.toHaveBeenCalled()
    expect(mockWindowApp.saveSessionState).not.toHaveBeenCalled()
  })
})

describe('resetSession codex handling', () => {
  it('calls codexReset for idle codex session instead of claude resetSession', async () => {
    setupProject('/test')
    const proj = useChatStore.getState().projectSessions['/test']
    const codexSid = 'codex_local_reset'

    useChatStore.setState({
      projectSessions: {
        '/test': {
          ...proj,
          _activeSessionId: codexSid,
          _sessions: {
            [codexSid]: {
              ...createDefaultPerSessionState(),
              sessionProvider: 'codex',
              preferredProvider: 'codex',
              messages: [{ id: 'cx1', role: 'user' as const, content: [], status: 'complete' as const, createdAt: '', providerId: 'codex' }] as never[],
            },
          },
        },
      },
    })

    await useChatStore.getState().resetSession()

    expect(mockWindowApp.codexReset).toHaveBeenCalledWith(codexSid)
    expect(mockWindowAgent.resetSession).not.toHaveBeenCalled()
    expect(mockWindowAgent.parkSession).not.toHaveBeenCalled()

    const after = useChatStore.getState().projectSessions['/test']
    expect(isDraftSession(after._activeSessionId)).toBe(true)
  })

  it('lets streaming codex session continue in background without interrupt', async () => {
    setupProject('/test')
    const proj = useChatStore.getState().projectSessions['/test']
    const codexSid = 'codex_local_streaming_reset'

    useChatStore.setState({
      projectSessions: {
        '/test': {
          ...proj,
          _activeSessionId: codexSid,
          _sessions: {
            [codexSid]: {
              ...createDefaultPerSessionState(),
              status: 'streaming' as const,
              sessionProvider: 'codex',
              preferredProvider: 'codex',
            },
          },
        },
      },
    })

    await useChatStore.getState().resetSession()

    expect(mockWindowApp.codexInterrupt).not.toHaveBeenCalled()
    expect(mockWindowApp.codexReset).not.toHaveBeenCalled()
    expect(mockWindowAgent.parkSession).not.toHaveBeenCalled()
    expect(mockWindowAgent.resetSession).not.toHaveBeenCalled()

    const after = useChatStore.getState().projectSessions['/test']
    expect(isDraftSession(after._activeSessionId)).toBe(true)
    expect(after._sessions[codexSid]).toBeDefined()
  })
})

describe('switchSession Case A codex worktree', () => {
  it('handles worktree for codex sessions and skips resumeSession', async () => {
    setupProject('/test')
    const proj = useChatStore.getState().projectSessions['/test']
    const codexWtSid = 'codex_local_wt'

    useChatStore.setState({
      projectSessions: {
        '/test': {
          ...proj,
          _sessions: {
            ...proj._sessions,
            [codexWtSid]: {
              ...createDefaultPerSessionState(),
              sessionProvider: 'codex',
              preferredProvider: 'codex',
              _worktreePath: '/test/.worktrees/feat',
              _worktreeBaseBranch: 'main',
            },
          },
        },
      },
    })

    mockWindowApp.pathExists.mockResolvedValueOnce(true)
    await useChatStore.getState().switchSession(codexWtSid)

    const after = useChatStore.getState().projectSessions['/test']
    expect(after._activeSessionId).toBe(codexWtSid)
    expect(mockSetActiveWorktree).toHaveBeenCalledWith('/test', '/test/.worktrees/feat')
    expect(mockWindowApp.resumeSession).not.toHaveBeenCalled()
  })
})

describe('slash_command_output for compact', () => {
  it('removes /compact user message without setting slashCommandOutput', () => {
    setupProject('/test')

    const proj = useChatStore.getState().projectSessions['/test']
    const session = proj._sessions[proj._activeSessionId]
    session._pendingSlashCommand = 'compact'
    session.messages = [
      { id: 'prev-msg', role: 'assistant', content: [{ type: 'text', text: 'hello' }], status: 'complete', createdAt: '', providerId: 'claude' },
      { id: 'compact-user', role: 'user', content: [{ type: 'text', text: '/compact' }], status: 'complete', createdAt: '', providerId: 'claude' },
      { id: 'compact-assist', role: 'assistant', content: [{ type: 'text', text: 'compacted' }], status: 'complete', createdAt: '', providerId: 'claude' },
    ] as never[]
    useChatStore.setState({ projectSessions: { '/test': proj } })

    useChatStore.getState().handleAgentEvent(makeEvent({
      type: 'slash_command_output',
      messageId: 'compact-assist',
      content: 'Conversation compacted',
    } as never))

    const after = useChatStore.getState().projectSessions['/test']
    const afterSession = after._sessions[after._activeSessionId]
    expect(afterSession.slashCommandOutput).toBeNull()
    expect(afterSession._pendingSlashCommand).toBe('')
    expect(afterSession.messages.find((m: { id: string }) => m.id === 'compact-user')).toBeUndefined()
    expect(afterSession.messages.find((m: { id: string }) => m.id === 'compact-assist')).toBeUndefined()
    expect(afterSession.messages).toHaveLength(1)
    expect(afterSession.messages[0].id).toBe('prev-msg')
  })
})

describe('createDefaultPerSessionState', () => {
  it('returns correct default values', () => {
    const state = createDefaultPerSessionState()
    expect(state.cwd).toBe('')
    expect(state.messages).toEqual([])
    expect(state.status).toBe('idle')
    expect(state.awaitingAssistantReply).toBe(false)
    expect(state.session).toBeNull()
    expect(state.sessionProvider).toBeNull()
    expect(state.totalCostUsd).toBe(0)
    expect(state.contextTokens).toBe(0)
    expect(state.contextWindow).toBeNull()
    expect(state.subagentTokens).toEqual({})
    expect(state.taskProgress).toEqual({})
    expect(state.streamingTokens).toEqual({ input: 0, output: 0 })
    expect(state.codexUsageSnapshot).toBeNull()
    expect(state.codexTurnLastUsage).toBeNull()
    expect(state.selectedModel).toBe('')
    expect(state.selectedEffort).toBeUndefined()
    expect(state.selectedCodexModel).toBe('')
    expect(state.selectedCodexReasoningEffort).toBeUndefined()
    expect(state.selectedCodexPermissionPreset).toBe('default')
    expect(state.selectedCodexCollaborationMode).toBe('default')
    expect(state.preferredProvider).toBe('claude')
    expect(state.draftText).toBe('')
    expect(state.promptSuggestion).toBeNull()
    expect(state.attachments).toEqual([])
    expect(state.mentions).toEqual([])
    expect(state.pendingPermissions).toEqual([])
    expect(state.permissionMode).toBe('default')
    expect(state.pendingQuestion).toBeNull()
    expect(state.pendingPlanApproval).toBeNull()
    expect(state.planApprovalOutcome).toBeNull()
    expect(state.slashCommandOutput).toBeNull()
    expect(state._pendingSlashCommand).toBe('')
    expect(state.todos).toEqual({})
    expect(state.showTodos).toBe(false)
    expect(state._todosUserDismissed).toBe(false)
    expect(state._nextTodoId).toBe(1)
    expect(state.isCompacting).toBe(false)
    expect(state.rateLimitInfo).toBeNull()
    expect(state._worktreeBaseBranch).toBeNull()
    expect(state._worktreePath).toBeNull()
    expect(state._worktreeRemoved).toBe(false)
    expect(state.additionalDirs).toEqual([])
    expect(state.lastEventAt).toBe(0)
    expect(state.activeCodexMessageId).toBeNull()
    expect(state.lastAssistantMessageId).toBeNull()
  })
})

describe('createDefaultProjectState', () => {
  it('returns correct default values', () => {
    const state = createDefaultProjectState()
    expect(state._activeSessionId).toBeNull()
    expect(state._sessions).toEqual({})
    expect(state.slashCommands).toEqual([])
    expect(state._projectSkills).toEqual([])
    expect(state._projectCommands).toEqual([])
    expect(state.agents).toEqual([])
    expect(state.homedir).toBe('')
    expect(state.sandboxInfo).toEqual({ enabled: true, autoAllowBash: false })
    expect(state.sessions).toEqual([])
    expect(state.sessionsPage).toBe(0)
    expect(state.sessionsHasMore).toBe(true)
    expect(state.showHistory).toBe(false)
    expect(state.hasUnseenActivity).toBe(false)
    expect(state.hasPendingInteraction).toBe(false)
    expect(state.unseenCompletedSessions).toEqual(new Set())
    expect(state.codexModels).toEqual([])
    expect(state.codexModelsLoading).toBe(false)
    expect(state.projectAdditionalDirs).toEqual([])
    expect(state.showDirManager).toBe(false)
    expect(state.showReviewPanel).toBe(false)
  })
})

describe('handleAgentEvent supplemental', () => {
  describe('message_start', () => {
    it('creates a new assistant message with correct defaults', () => {
      setupProject('/test')

      useChatStore.getState().handleAgentEvent(makeEvent({
        type: 'message_start',
        message: { id: 'msg-a1', role: 'assistant', content: [], status: 'streaming', createdAt: '2024-01-01', providerId: 'claude' } as never,
      }))

      const session = getActiveDraftSession('/test')!
      expect(session.messages).toHaveLength(1)
      expect(session.messages[0].id).toBe('msg-a1')
      expect(session.messages[0].role).toBe('assistant')
      expect(session.messages[0].status).toBe('streaming')
      expect(session.messages[0].content).toEqual([])
      expect(session.promptSuggestion).toBeNull()
      expect(session.awaitingAssistantReply).toBe(false)
      expect(session.lastAssistantMessageId).toBe('msg-a1')
    })

    it('does not set lastAssistantMessageId for user messages', () => {
      setupProject('/test')

      useChatStore.getState().handleAgentEvent(makeEvent({
        type: 'message_start',
        message: { id: 'msg-u1', role: 'user', content: [], status: 'complete', createdAt: '', providerId: 'claude' } as never,
      }))

      const session = getActiveDraftSession('/test')!
      expect(session.lastAssistantMessageId).toBeNull()
    })
  })

  describe('content_delta', () => {
    it('appends text to last message via text delta', () => {
      setupProject('/test')

      useChatStore.getState().handleAgentEvent(makeEvent({
        type: 'message_start',
        message: { id: 'msg-d1', role: 'assistant', content: [{ type: 'text', text: 'Hello' }], status: 'streaming', createdAt: '', providerId: 'claude' } as never,
      }))

      useChatStore.getState().handleAgentEvent(makeEvent({
        type: 'content_delta',
        messageId: 'msg-d1',
        delta: { type: 'text', text: ' world' },
      }))

      const session = getActiveDraftSession('/test')!
      const msg = session.messages.find((m) => m.id === 'msg-d1')
      const textBlock = msg?.content.find((b) => b.type === 'text')
      expect(textBlock).toBeDefined()
      expect((textBlock as { text: string }).text).toBe('Hello world')
    })

    it('appends thinking block via thinking delta', () => {
      setupProject('/test')

      useChatStore.getState().handleAgentEvent(makeEvent({
        type: 'message_start',
        message: { id: 'msg-t1', role: 'assistant', content: [], status: 'streaming', createdAt: '', providerId: 'claude' } as never,
      }))

      useChatStore.getState().handleAgentEvent(makeEvent({
        type: 'content_delta',
        messageId: 'msg-t1',
        delta: { type: 'thinking', text: 'Let me think...' },
      }))

      const session = getActiveDraftSession('/test')!
      const msg = session.messages.find((m) => m.id === 'msg-t1')
      const thinkingBlock = msg?.content.find((b) => b.type === 'thinking')
      expect(thinkingBlock).toBeDefined()
      expect((thinkingBlock as { text: string }).text).toBe('Let me think...')
    })
  })

  describe('message_complete', () => {
    it('sets message status to complete and updates cost', () => {
      setupProject('/test')

      useChatStore.getState().handleAgentEvent(makeEvent({
        type: 'message_start',
        message: { id: 'msg-c1', role: 'assistant', content: [{ type: 'text', text: 'done' }], status: 'streaming', createdAt: '', providerId: 'claude' } as never,
      }))

      useChatStore.getState().handleAgentEvent(makeEvent({
        type: 'message_complete',
        messageId: 'msg-c1',
        metadata: {
          costUsd: 0.02,
          usage: { inputTokens: 100, outputTokens: 50, cacheReadInputTokens: 10, cacheCreationInputTokens: 5 },
        },
      }))

      const session = getActiveDraftSession('/test')!
      const msg = session.messages.find((m) => m.id === 'msg-c1')
      expect(msg?.status).toBe('complete')
      expect(session.totalCostUsd).toBe(0.02)
      expect(session.contextTokens).toBe(115)
    })
  })

  describe('permission_request', () => {
    it('sets pendingPermission on session state', () => {
      setupProject('/test')

      useChatStore.getState().handleAgentEvent(makeEvent({
        type: 'permission_request',
        request: { requestId: 'perm-1', toolName: 'Bash', description: 'run command' } as never,
      }))

      const proj = useChatStore.getState().projectSessions['/test']
      const session = proj._sessions[draftOf(proj)]
      expect(session.pendingPermissions).toHaveLength(1)
      expect(session.pendingPermissions[0].requestId).toBe('perm-1')
      expect(session.pendingPermissions[0].toolName).toBe('Bash')
      expect(proj.hasPendingInteraction).toBe(true)
    })
  })

  describe('message_error', () => {
    it('adds error content block and sets status to error', () => {
      setupProject('/test')

      useChatStore.getState().handleAgentEvent(makeEvent({
        type: 'message_start',
        message: { id: 'msg-e1', role: 'assistant', content: [], status: 'streaming', createdAt: '', providerId: 'claude' } as never,
      }))

      useChatStore.getState().handleAgentEvent(makeEvent({
        type: 'message_error',
        messageId: 'msg-e1',
        error: 'API timeout',
      }))

      const session = getActiveDraftSession('/test')!
      const msg = session.messages.find((m) => m.id === 'msg-e1')
      expect(msg?.status).toBe('error')
      const errorBlock = msg?.content.find((b) => b.type === 'text' && (b as { text: string }).text.includes('Error:'))
      expect(errorBlock).toBeDefined()
      expect((errorBlock as { text: string }).text).toBe('Error: API timeout')
    })
  })
})

describe('cyclePermissionMode', () => {
  it('skips auto when ineligible: default → acceptEdits → plan → default', async () => {
    setupProject('/test')

    const session = getActiveDraftSession('/test')!
    expect(session.permissionMode).toBe('default')

    await useChatStore.getState().cyclePermissionMode()
    expect(getActiveDraftSession('/test')!.permissionMode).toBe('acceptEdits')

    await useChatStore.getState().cyclePermissionMode()
    expect(getActiveDraftSession('/test')!.permissionMode).toBe('plan')

    await useChatStore.getState().cyclePermissionMode()
    expect(getActiveDraftSession('/test')!.permissionMode).toBe('default')
  })

  it('includes auto when account + model qualify: default → acceptEdits → auto → plan → default', async () => {
    setupProject('/test')
    useChatStore.setState({
      account: { subscriptionType: 'max', apiProvider: 'firstParty' },
      availableModels: [
        { id: 'claude-opus-4-7', name: 'Opus 4.7', description: '', supportsAutoMode: true },
      ],
    })
    patchDraftSession('/test', { selectedModel: 'claude-opus-4-7' })

    await useChatStore.getState().cyclePermissionMode()
    expect(getActiveDraftSession('/test')!.permissionMode).toBe('acceptEdits')

    await useChatStore.getState().cyclePermissionMode()
    expect(getActiveDraftSession('/test')!.permissionMode).toBe('auto')

    await useChatStore.getState().cyclePermissionMode()
    expect(getActiveDraftSession('/test')!.permissionMode).toBe('plan')

    await useChatStore.getState().cyclePermissionMode()
    expect(getActiveDraftSession('/test')!.permissionMode).toBe('default')
  })
})

describe('setSelectedModel auto-mode downgrade', () => {
  it('downgrades permissionMode from auto to default when new model does not support auto mode', () => {
    setupProject('/test')
    useChatStore.setState({
      account: { subscriptionType: 'max', apiProvider: 'firstParty' },
      availableModels: [
        { id: 'claude-opus-4-7', name: 'Opus 4.7', description: '', supportsAutoMode: true },
        { id: 'claude-haiku-4-5', name: 'Haiku 4.5', description: '' },
      ],
    })
    patchDraftSession('/test', { selectedModel: 'claude-opus-4-7', permissionMode: 'auto' })

    expect(getActiveDraftSession('/test')!.permissionMode).toBe('auto')

    useChatStore.getState().setSelectedModel('claude-haiku-4-5')

    expect(getActiveDraftSession('/test')!.permissionMode).toBe('default')
    expect(getActiveDraftSession('/test')!.selectedModel).toBe('claude-haiku-4-5')
  })

  it('keeps permissionMode when new model still qualifies for auto', () => {
    setupProject('/test')
    useChatStore.setState({
      account: { subscriptionType: 'team', apiProvider: 'firstParty' },
      availableModels: [
        { id: 'claude-opus-4-7', name: 'Opus 4.7', description: '', supportsAutoMode: true },
        { id: 'claude-sonnet-4-6', name: 'Sonnet 4.6', description: '', supportsAutoMode: true },
      ],
    })
    patchDraftSession('/test', { selectedModel: 'claude-opus-4-7', permissionMode: 'auto' })

    useChatStore.getState().setSelectedModel('claude-sonnet-4-6')

    expect(getActiveDraftSession('/test')!.permissionMode).toBe('auto')
  })
})

describe('cost/token via message_complete', () => {
  it('uses latest cumulative cost from SDK (not additive)', () => {
    setupProject('/test')

    useChatStore.getState().handleAgentEvent(makeEvent({
      type: 'message_start',
      message: { id: 'mc-1', role: 'assistant', content: [], status: 'streaming', createdAt: '', providerId: 'claude' } as never,
    }))
    useChatStore.getState().handleAgentEvent(makeEvent({
      type: 'message_complete',
      messageId: 'mc-1',
      metadata: {
        costUsd: 0.01,
        usage: { inputTokens: 50, outputTokens: 20, cacheReadInputTokens: 0, cacheCreationInputTokens: 0 },
      },
    }))

    useChatStore.getState().handleAgentEvent(makeEvent({
      type: 'message_start',
      message: { id: 'mc-2', role: 'assistant', content: [], status: 'streaming', createdAt: '', providerId: 'claude' } as never,
    }))
    useChatStore.getState().handleAgentEvent(makeEvent({
      type: 'message_complete',
      messageId: 'mc-2',
      metadata: {
        costUsd: 0.03,
        usage: { inputTokens: 200, outputTokens: 80, cacheReadInputTokens: 50, cacheCreationInputTokens: 10 },
      },
    }))

    const session = getActiveDraftSession('/test')!
    expect(session.totalCostUsd).toBe(0.03)
    expect(session.contextTokens).toBe(260)
  })

  it('updates contextWindow from modelUsage metadata', () => {
    setupProject('/test')

    useChatStore.getState().handleAgentEvent(makeEvent({
      type: 'message_start',
      message: { id: 'cw-1', role: 'assistant', content: [], status: 'streaming', createdAt: '', providerId: 'claude' } as never,
    }))
    useChatStore.getState().handleAgentEvent(makeEvent({
      type: 'message_complete',
      messageId: 'cw-1',
      metadata: {
        costUsd: 0,
        usage: { inputTokens: 100, outputTokens: 50, cacheReadInputTokens: 0, cacheCreationInputTokens: 0 },
        modelUsage: { 'claude-sonnet-4-6': { contextWindow: 200000 } },
      },
    }))

    const session = getActiveDraftSession('/test')!
    expect(session.contextWindow).toBe(200000)
  })

  it('handles message_complete with no metadata gracefully', () => {
    setupProject('/test')

    useChatStore.getState().handleAgentEvent(makeEvent({
      type: 'message_start',
      message: { id: 'nm-1', role: 'assistant', content: [], status: 'streaming', createdAt: '', providerId: 'claude' } as never,
    }))
    useChatStore.getState().handleAgentEvent(makeEvent({
      type: 'message_complete',
      messageId: 'nm-1',
    }))

    const session = getActiveDraftSession('/test')!
    expect(session.totalCostUsd).toBe(0)
    expect(session.contextTokens).toBe(0)
    const msg = session.messages.find((m) => m.id === 'nm-1')
    expect(msg?.status).toBe('complete')
  })
})

describe('remote session interaction routing', () => {
  beforeEach(() => {
    resetStore()
    vi.clearAllMocks()
  })

  function setupRemoteSession() {
    setupProject('/test')
    const proj = useChatStore.getState().projectSessions['/test']
    useChatStore.setState({
      projectSessions: {
        '/test': {
          ...proj,
          _activeSessionId: 'desktop-session',
          _sessions: {
            'desktop-session': { ...createDefaultPerSessionState(), status: 'streaming' as const },
          },
        },
      },
    })
    useChatStore.getState().handleAgentEvent({
      type: 'remote_session_start',
      remoteProjectPath: '/test',
      remoteSessionId: 'remote-1',
    } as AgentEvent)
  }

  it('routes remote session permission_request to its own session, not active session', () => {
    setupRemoteSession()

    useChatStore.getState().handleAgentEvent(makeEvent({
      type: 'permission_request',
      sessionId: 'remote-1',
      request: { requestId: 'r1', toolName: 'Bash', input: {} } as never,
    }))

    const after = useChatStore.getState().projectSessions['/test']
    expect(after._sessions['remote-1'].pendingPermissions).toHaveLength(1)
    expect(after._sessions['remote-1'].pendingPermissions[0].requestId).toBe('r1')
    expect(after._sessions['desktop-session'].pendingPermissions).toHaveLength(0)
  })

  it('routes remote session ask_user_question to its own session', () => {
    setupRemoteSession()

    useChatStore.getState().handleAgentEvent(makeEvent({
      type: 'ask_user_question',
      sessionId: 'remote-1',
      request: { requestId: 'q1', questions: [{ question: 'test?', header: '', options: [], multiSelect: false }] } as never,
    }))

    const after = useChatStore.getState().projectSessions['/test']
    expect(after._sessions['remote-1'].pendingQuestion).toBeTruthy()
    expect(after._sessions['remote-1'].pendingQuestion!.requestId).toBe('q1')
    expect(after._sessions['desktop-session'].pendingQuestion).toBeNull()
  })

  it('routes bg session permission_request to its own session', () => {
    setupRemoteSession()

    useChatStore.getState().handleAgentEvent(makeEvent({
      type: 'permission_request',
      sessionId: 'bg-agent-1',
      request: { requestId: 'r2', toolName: 'Bash', input: {} } as never,
    }))

    const after = useChatStore.getState().projectSessions['/test']
    expect(after._sessions['desktop-session'].pendingPermissions).toHaveLength(0)
    expect(after._sessions['bg-agent-1'].pendingPermissions).toHaveLength(1)
    expect(after._sessions['bg-agent-1'].pendingPermissions[0].requestId).toBe('r2')
  })
})

describe('interaction response routing', () => {
  beforeEach(() => {
    resetStore()
    vi.clearAllMocks()
  })

  it('respondToPermission calls IPC without sessionId', () => {
    setupProject('/test')
    const proj = useChatStore.getState().projectSessions['/test']
    useChatStore.setState({
      projectSessions: {
        '/test': {
          ...proj,
          _activeSessionId: 'a',
          _sessions: {
            a: {
              ...createDefaultPerSessionState(),
              status: 'streaming' as const,
              pendingPermissions: [{ requestId: 'r1', toolName: 'Bash', input: {}, allowAlwaysAllow: false }],
            },
          },
        },
      },
    })

    useChatStore.getState().respondToPermission('r1', true)

    expect(mockWindowAgent.respondToPermission).toHaveBeenCalledWith(
      '/test', 'r1', true, undefined, undefined, undefined,
    )
  })

  it('answerQuestion calls IPC without sessionId', () => {
    setupProject('/test')
    const proj = useChatStore.getState().projectSessions['/test']
    useChatStore.setState({
      projectSessions: {
        '/test': {
          ...proj,
          _activeSessionId: 'a',
          _sessions: {
            a: {
              ...createDefaultPerSessionState(),
              status: 'streaming' as const,
              pendingQuestion: { requestId: 'q1', questions: [] } as never,
            },
          },
        },
      },
    })

    useChatStore.getState().answerQuestion('q1', { q: 'a' })

    expect(mockWindowAgent.answerQuestion).toHaveBeenCalledWith(
      '/test', 'q1', { q: 'a' }, undefined,
    )
  })

  it('dismissQuestion calls IPC without sessionId', () => {
    setupProject('/test')
    const proj = useChatStore.getState().projectSessions['/test']
    useChatStore.setState({
      projectSessions: {
        '/test': {
          ...proj,
          _activeSessionId: 'a',
          _sessions: {
            a: {
              ...createDefaultPerSessionState(),
              status: 'streaming' as const,
              pendingQuestion: { requestId: 'q1', questions: [] } as never,
            },
          },
        },
      },
    })

    useChatStore.getState().dismissQuestion('q1')

    expect(mockWindowAgent.dismissQuestion).toHaveBeenCalledWith(
      '/test', 'q1',
    )
  })

  it('respondToPlanApproval calls IPC without sessionId', () => {
    setupProject('/test')
    const proj = useChatStore.getState().projectSessions['/test']
    useChatStore.setState({
      projectSessions: {
        '/test': {
          ...proj,
          _activeSessionId: 'a',
          _sessions: {
            a: {
              ...createDefaultPerSessionState(),
              status: 'streaming' as const,
              pendingPlanApproval: { requestId: 'p1', planContent: 'plan', planFilePath: '/plan', allowedPrompts: [] } as never,
            },
          },
        },
      },
    })

    useChatStore.getState().respondToPlanApproval('p1', true, 'ok')

    expect(mockWindowAgent.respondToPlanApproval).toHaveBeenCalledWith(
      '/test', 'p1', true, 'ok',
    )
  })
})

describe('cross-session event routing race conditions', () => {
  it.skip('does not route events with stale draftSessionId to the active session (fallback_active)', () => {
    setupProject('/test')
    const proj = useChatStore.getState().projectSessions['/test']
    const originalDraftId = proj._activeSessionId!

    useChatStore.getState().handleAgentEvent(makeEvent({
      type: 'session_init',
      session: { sessionId: 'real-A' } as never,
    }))

    const afterRekey = useChatStore.getState().projectSessions['/test']
    expect(afterRekey._activeSessionId).toBe('real-A')
    expect(afterRekey._sessions[originalDraftId]).toBeUndefined()

    const newDraftId = createDraftSessionId()
    useChatStore.setState({
      projectSessions: {
        '/test': {
          ...afterRekey,
          _activeSessionId: newDraftId,
          _sessions: {
            ...afterRekey._sessions,
            [newDraftId]: createDefaultPerSessionState(),
          },
        },
      },
    })

    useChatStore.getState().handleAgentEvent(makeEvent({
      type: 'message_start',
      draftSessionId: originalDraftId,
      message: makeMessage('leaked-msg', 'assistant'),
    } as never))

    const final = useChatStore.getState().projectSessions['/test']
    const activeSession = final._sessions[newDraftId]
    expect(activeSession.messages).toHaveLength(0)
  })

  it('does not route content_delta with stale draftSessionId to the active session', () => {
    setupProject('/test')
    const proj = useChatStore.getState().projectSessions['/test']
    const originalDraftId = proj._activeSessionId!

    useChatStore.getState().handleAgentEvent(makeEvent({
      type: 'message_start',
      message: makeMessage('msg-A', 'assistant'),
    }))

    useChatStore.getState().handleAgentEvent(makeEvent({
      type: 'session_init',
      session: { sessionId: 'real-A' } as never,
    }))

    const afterRekey = useChatStore.getState().projectSessions['/test']

    const newDraftId = createDraftSessionId()
    useChatStore.setState({
      projectSessions: {
        '/test': {
          ...afterRekey,
          _activeSessionId: newDraftId,
          _sessions: {
            ...afterRekey._sessions,
            [newDraftId]: createDefaultPerSessionState(),
          },
        },
      },
    })

    useChatStore.getState().handleAgentEvent(makeEvent({
      type: 'content_delta',
      draftSessionId: originalDraftId,
      messageId: 'msg-A',
      delta: { type: 'text', text: 'leaked text' },
    } as never))

    const final = useChatStore.getState().projectSessions['/test']
    const activeSession = final._sessions[newDraftId]
    expect(activeSession.messages).toHaveLength(0)
  })

  it('does not promote background session_init to a different active draft', () => {
    setupProject('/test')
    const proj = useChatStore.getState().projectSessions['/test']
    const draftB = proj._activeSessionId!

    useChatStore.setState({
      projectSessions: {
        '/test': {
          ...proj,
          _sessions: {
            [draftB]: {
              ...createDefaultPerSessionState(),
              awaitingAssistantReply: true,
            },
          },
        },
      },
    })

    useChatStore.getState().handleAgentEvent(makeEvent({
      type: 'session_init',
      draftSessionId: '__draft_stale_xyz',
      session: { sessionId: 'real-A' } as never,
    } as never))

    const final = useChatStore.getState().projectSessions['/test']
    expect(final._activeSessionId).toBe(draftB)
    expect(final._sessions[draftB]).toBeDefined()
    expect(final._sessions['real-A']).toBeUndefined()
  })
})

describe('queued_message_consumed', () => {
  it('moves matching queued message into messages immediately', () => {
    setupProject('/test')
    const draftId = getActiveDraftId('/test')!

    const userMsg = makeMessage('user-q1', 'user')
    const asstMsg = makeMessage('asst-1', 'assistant')

    const proj = useChatStore.getState().projectSessions['/test']
    proj._sessions[draftId].messages = [asstMsg]
    proj._sessions[draftId].queuedMessages = [userMsg]
    proj._sessions[draftId].status = 'streaming'
    useChatStore.setState({ projectSessions: { '/test': proj } })

    useChatStore.getState().handleAgentEvent(makeEvent({
      type: 'queued_message_consumed',
      clientMessageId: 'user-q1',
    } as never))

    const session = useChatStore.getState().projectSessions['/test']._sessions[draftId]
    expect(session.messages).toHaveLength(2)
    expect(session.messages[1].id).toBe('user-q1')
    expect(session.queuedMessages).toHaveLength(0)
  })

  it('does nothing when clientMessageId is not in queue', () => {
    setupProject('/test')
    const draftId = getActiveDraftId('/test')!

    const userMsg = makeMessage('user-q1', 'user')
    const proj = useChatStore.getState().projectSessions['/test']
    proj._sessions[draftId].queuedMessages = [userMsg]
    useChatStore.setState({ projectSessions: { '/test': proj } })

    useChatStore.getState().handleAgentEvent(makeEvent({
      type: 'queued_message_consumed',
      clientMessageId: 'nonexistent',
    } as never))

    const session = useChatStore.getState().projectSessions['/test']._sessions[draftId]
    expect(session.queuedMessages).toHaveLength(1)
    expect(session.messages).toHaveLength(0)
  })

  it('message_start no longer dequeues from queuedMessages', () => {
    setupProject('/test')
    const draftId = getActiveDraftId('/test')!

    const userMsg = makeMessage('user-q1', 'user')
    const proj = useChatStore.getState().projectSessions['/test']
    proj._sessions[draftId].queuedMessages = [userMsg]
    useChatStore.setState({ projectSessions: { '/test': proj } })

    useChatStore.getState().handleAgentEvent(makeEvent({
      type: 'message_start',
      message: makeMessage('asst-new', 'assistant'),
    }))

    const session = useChatStore.getState().projectSessions['/test']._sessions[draftId]
    expect(session.queuedMessages).toHaveLength(1)
    expect(session.messages.find((m) => m.id === 'user-q1')).toBeUndefined()
  })
})

describe('mini-app context injection', () => {
  beforeEach(() => {
    setupProject('/test')
  })

  it('setMiniAppContext adds a context slot to the session', () => {
    useChatStore.getState().setMiniAppContext('my-app', {
      appName: 'My App',
      summary: 'selected items',
      content: 'item1\nitem2',
      mode: 'inject',
      color: '#4a7fbf',
    })
    const sess = getActiveDraftSession('/test')!
    expect(sess.miniAppContexts['my-app']).toEqual({
      appId: 'my-app',
      appName: 'My App',
      summary: 'selected items',
      content: 'item1\nitem2',
      mode: 'inject',
      color: '#4a7fbf',
      checked: true,
    })
  })

  it('setMiniAppContext with suggest mode defaults checked to false', () => {
    useChatStore.getState().setMiniAppContext('my-app', {
      appName: 'My App',
      summary: 'notes',
      content: 'some notes',
      mode: 'suggest',
    })
    const sess = getActiveDraftSession('/test')!
    expect(sess.miniAppContexts['my-app'].checked).toBe(false)
  })

  it('setMiniAppContext overwrites previous context for same app', () => {
    const store = useChatStore.getState()
    store.setMiniAppContext('my-app', { appName: 'My App', summary: 'v1', content: 'old', mode: 'inject' })
    store.setMiniAppContext('my-app', { appName: 'My App', summary: 'v2', content: 'new', mode: 'inject' })
    const sess = getActiveDraftSession('/test')!
    expect(sess.miniAppContexts['my-app'].summary).toBe('v2')
    expect(sess.miniAppContexts['my-app'].content).toBe('new')
  })

  it('clearMiniAppContext removes the context slot', () => {
    useChatStore.getState().setMiniAppContext('my-app', {
      appName: 'My App', summary: 'test', content: 'test', mode: 'inject',
    })
    useChatStore.getState().clearMiniAppContext('my-app')
    const sess = getActiveDraftSession('/test')!
    expect(sess.miniAppContexts['my-app']).toBeUndefined()
  })

  it('toggleMiniAppContext flips checked state', () => {
    useChatStore.getState().setMiniAppContext('my-app', {
      appName: 'My App', summary: 'notes', content: 'abc', mode: 'suggest',
    })
    expect(getActiveDraftSession('/test')!.miniAppContexts['my-app'].checked).toBe(false)
    useChatStore.getState().toggleMiniAppContext('my-app')
    expect(getActiveDraftSession('/test')!.miniAppContexts['my-app'].checked).toBe(true)
    useChatStore.getState().toggleMiniAppContext('my-app')
    expect(getActiveDraftSession('/test')!.miniAppContexts['my-app'].checked).toBe(false)
  })

  it('clearMiniAppContext can be used to dismiss inject-mode context', () => {
    useChatStore.getState().setMiniAppContext('my-app', {
      appName: 'My App', summary: 'test', content: 'test', mode: 'inject',
    })
    useChatStore.getState().clearMiniAppContext('my-app')
    expect(getActiveDraftSession('/test')!.miniAppContexts['my-app']).toBeUndefined()
  })

  it('sendMessage attaches active contexts to user message and clears them', async () => {
    useChatStore.getState().setMiniAppContext('app-a', {
      appName: 'App A', summary: 'data', content: 'context-content', mode: 'inject', color: '#ff0000',
    })
    await useChatStore.getState().sendMessage('hello')
    const sess = getActiveDraftSession('/test')!
    const userMsg = sess.messages.find((m) => m.role === 'user')
    expect(userMsg?.contexts).toEqual([
      { appId: 'app-a', appName: 'App A', summary: 'data', content: 'context-content', color: '#ff0000' },
    ])
    expect(sess.miniAppContexts).toEqual({})
  })

  it('sendMessage appends context as suffix in agent payload', async () => {
    useChatStore.getState().setMiniAppContext('app-a', {
      appName: 'App A', summary: 'info', content: 'ctx-data', mode: 'inject',
    })
    await useChatStore.getState().sendMessage('my question')
    expect(mockWindowAgent.sendMessage).toHaveBeenCalled()
    const payload = mockWindowAgent.sendMessage.mock.calls[0][1]
    expect(payload.content).toContain('my question')
    expect(payload.content).toContain('<app-context app="App A" summary="info">')
    expect(payload.content).toContain('ctx-data')
    expect(payload.content.indexOf('my question')).toBeLessThan(payload.content.indexOf('<app-context'))
  })

  it('sendMessage excludes cleared inject contexts', async () => {
    useChatStore.getState().setMiniAppContext('app-a', {
      appName: 'App A', summary: 'data', content: 'ctx', mode: 'inject',
    })
    useChatStore.getState().clearMiniAppContext('app-a')
    await useChatStore.getState().sendMessage('hello')
    const payload = mockWindowAgent.sendMessage.mock.calls[0][1]
    expect(payload.content).not.toContain('<app-context')
  })

  it('sendMessage excludes unchecked suggest contexts', async () => {
    useChatStore.getState().setMiniAppContext('app-a', {
      appName: 'App A', summary: 'notes', content: 'ctx', mode: 'suggest',
    })
    await useChatStore.getState().sendMessage('hello')
    const payload = mockWindowAgent.sendMessage.mock.calls[0][1]
    expect(payload.content).not.toContain('<app-context')
  })

  it('sendMessage includes checked suggest contexts', async () => {
    useChatStore.getState().setMiniAppContext('app-a', {
      appName: 'App A', summary: 'notes', content: 'suggest-ctx', mode: 'suggest',
    })
    useChatStore.getState().toggleMiniAppContext('app-a')
    await useChatStore.getState().sendMessage('hello')
    const payload = mockWindowAgent.sendMessage.mock.calls[0][1]
    expect(payload.content).toContain('suggest-ctx')
  })

  it('sendMessage dispatches miniapp-context-consumed event', async () => {
    const handler = vi.fn()
    window.addEventListener('miniapp-context-consumed', handler)
    useChatStore.getState().setMiniAppContext('app-a', {
      appName: 'App A', summary: 'data', content: 'ctx', mode: 'inject',
    })
    await useChatStore.getState().sendMessage('hello')
    expect(handler).toHaveBeenCalledTimes(1)
    const detail = (handler.mock.calls[0][0] as CustomEvent).detail
    expect(detail.appIds).toEqual(['app-a'])
    window.removeEventListener('miniapp-context-consumed', handler)
  })

  it('sendMessage does not dispatch consumed event when no contexts', async () => {
    const handler = vi.fn()
    window.addEventListener('miniapp-context-consumed', handler)
    await useChatStore.getState().sendMessage('hello')
    expect(handler).not.toHaveBeenCalled()
    window.removeEventListener('miniapp-context-consumed', handler)
  })
})

describe('streamingTokens lifecycle around turn boundaries', () => {
  it('clears streamingTokens and freezes consumedTokens on message_interrupted', () => {
    setupProject('/test')

    useChatStore.getState().handleAgentEvent(makeEvent({
      type: 'message_start',
      message: { id: 'int-1', role: 'assistant', content: [], status: 'streaming', createdAt: '', providerId: 'claude' } as never,
    }))
    useChatStore.getState().handleAgentEvent(makeEvent({
      type: 'message_usage',
      messageId: 'int-1',
      inputTokens: 1234,
      outputTokens: 567,
    }))

    const before = getActiveDraftSession('/test')!
    expect(before.streamingTokens).toEqual({ input: 1234, output: 567 })

    useChatStore.getState().handleAgentEvent(makeEvent({
      type: 'message_interrupted',
      messageId: 'int-1',
    }))

    const after = getActiveDraftSession('/test')!
    expect(after.streamingTokens).toEqual({ input: 0, output: 0 })
    const msg = after.messages.find((m) => m.id === 'int-1')!
    expect(msg.status).toBe('interrupted')
    expect(msg.metadata?.consumedTokens).toEqual({ input: 1234, output: 567 })
  })

  it('clears streamingTokens on message_error', () => {
    setupProject('/test')

    useChatStore.getState().handleAgentEvent(makeEvent({
      type: 'message_start',
      message: { id: 'err-1', role: 'assistant', content: [], status: 'streaming', createdAt: '', providerId: 'claude' } as never,
    }))
    useChatStore.getState().handleAgentEvent(makeEvent({
      type: 'message_usage',
      messageId: 'err-1',
      inputTokens: 88,
      outputTokens: 42,
    }))

    useChatStore.getState().handleAgentEvent(makeEvent({
      type: 'message_error',
      messageId: 'err-1',
      error: 'boom',
    }))

    const after = getActiveDraftSession('/test')!
    expect(after.streamingTokens).toEqual({ input: 0, output: 0 })
  })

  it('new assistant message_start resets any leaked streamingTokens', () => {
    setupProject('/test')

    useChatStore.getState().handleAgentEvent(makeEvent({
      type: 'message_start',
      message: { id: 'prev-1', role: 'assistant', content: [], status: 'streaming', createdAt: '', providerId: 'claude' } as never,
    }))
    useChatStore.getState().handleAgentEvent(makeEvent({
      type: 'message_usage',
      messageId: 'prev-1',
      inputTokens: 999,
      outputTokens: 111,
    }))

    expect(getActiveDraftSession('/test')!.streamingTokens).toEqual({ input: 999, output: 111 })

    useChatStore.getState().handleAgentEvent(makeEvent({
      type: 'message_start',
      message: { id: 'next-1', role: 'assistant', content: [], status: 'streaming', createdAt: '', providerId: 'claude' } as never,
    }))

    const after = getActiveDraftSession('/test')!
    expect(after.streamingTokens).toEqual({ input: 0, output: 0 })
  })

  it('does not reset streamingTokens when a user message_start arrives mid-turn', () => {
    setupProject('/test')

    useChatStore.getState().handleAgentEvent(makeEvent({
      type: 'message_start',
      message: { id: 'assist-1', role: 'assistant', content: [], status: 'streaming', createdAt: '', providerId: 'claude' } as never,
    }))
    useChatStore.getState().handleAgentEvent(makeEvent({
      type: 'message_usage',
      messageId: 'assist-1',
      inputTokens: 50,
      outputTokens: 20,
    }))

    useChatStore.getState().handleAgentEvent(makeEvent({
      type: 'message_start',
      message: { id: 'user-1', role: 'user', content: [], status: 'complete', createdAt: '', providerId: 'claude' } as never,
    }))

    const after = getActiveDraftSession('/test')!
    expect(after.streamingTokens).toEqual({ input: 50, output: 20 })
  })
})
