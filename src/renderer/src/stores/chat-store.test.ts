import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { AgentEvent } from '../../../shared/agent-types'

const mockSetActiveWorktree = vi.fn()
const mockClearWorktree = vi.fn().mockResolvedValue(undefined)

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
  resetSession: vi.fn().mockResolvedValue(undefined),
  activateSession: vi.fn().mockResolvedValue(undefined),
  getSessionId: vi.fn().mockResolvedValue(''),
  sendMessage: vi.fn().mockResolvedValue(undefined),
  readProjectAdditionalDirs: vi.fn().mockResolvedValue([]),
  respondToPermission: vi.fn().mockResolvedValue(undefined),
  answerQuestion: vi.fn().mockResolvedValue(undefined),
  dismissQuestion: vi.fn().mockResolvedValue(undefined),
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
}

vi.stubGlobal('window', { agent: mockWindowAgent, app: mockWindowApp })

const { useChatStore, DRAFT_SESSION_ID, createDefaultPerSessionState, createDefaultProjectState } = await import('./chat')

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

function makeEvent(overrides: Partial<AgentEvent> & { type: AgentEvent['type'] }): AgentEvent {
  return { projectPath: '/test', sessionId: undefined, ...overrides } as AgentEvent
}

beforeEach(() => {
  resetStore()
  vi.clearAllMocks()
  globalThis.localStorage?.removeItem('super-one.codex.last-selection.v1')
})

describe('ensureSession', () => {
  it('creates project with DRAFT session entry', () => {
    useChatStore.getState().ensureSession('/project-a')
    const proj = useChatStore.getState().projectSessions['/project-a']

    expect(proj).toBeDefined()
    expect(proj._activeSessionId).toBe(DRAFT_SESSION_ID)
    expect(proj._sessions[DRAFT_SESSION_ID]).toBeDefined()
    expect(proj._sessions[DRAFT_SESSION_ID].status).toBe('idle')
  })

  it('does not overwrite existing project', () => {
    setupProject('/project-a')
    const store = useChatStore.getState()
    const proj = store.projectSessions['/project-a']
    proj._sessions[DRAFT_SESSION_ID].draftText = 'hello'
    useChatStore.setState({ projectSessions: { '/project-a': proj } })

    store.ensureSession('/project-a')

    const after = useChatStore.getState().projectSessions['/project-a']
    expect(after._sessions[DRAFT_SESSION_ID].draftText).toBe('hello')
  })
})

describe('session_init re-keying', () => {
  it('re-keys DRAFT to real session ID on session_init', () => {
    setupProject('/test')

    useChatStore.getState().handleAgentEvent(makeEvent({
      type: 'session_init',
      session: { sessionId: 'real-abc' } as never,
    }))

    const proj = useChatStore.getState().projectSessions['/test']
    expect(proj._activeSessionId).toBe('real-abc')
    expect(proj._sessions['real-abc']).toBeDefined()
    expect(proj._sessions[DRAFT_SESSION_ID]).toBeUndefined()
  })

  it('preserves session data during re-keying', () => {
    setupProject('/test')

    useChatStore.getState().handleAgentEvent(makeEvent({
      type: 'message_start',
      message: { id: 'msg1', role: 'assistant', content: [], status: 'streaming', createdAt: '', providerId: 'claude' } as never,
    }))

    useChatStore.getState().handleAgentEvent(makeEvent({
      type: 'session_init',
      session: { sessionId: 'real-xyz' } as never,
    }))

    const proj = useChatStore.getState().projectSessions['/test']
    const session = proj._sessions['real-xyz']
    expect(session.messages).toHaveLength(1)
    expect(session.messages[0].id).toBe('msg1')
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

  it('routes session_init to live draft when switched away before first reply', () => {
    setupProject('/test')
    const proj = useChatStore.getState().projectSessions['/test']

    useChatStore.setState({
      projectSessions: {
        '/test': {
          ...proj,
          _activeSessionId: 'old',
          _sessions: {
            old: createDefaultPerSessionState(),
            [DRAFT_SESSION_ID]: {
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
    expect(after._sessions[DRAFT_SESSION_ID]).toBeUndefined()
    expect(after._sessions['real-new']).toBeDefined()
    expect(after._sessions['real-new'].awaitingAssistantReply).toBe(true)
    expect(after._sessions['old']).toBeDefined()
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
    expect(after._activeSessionId).toBe(DRAFT_SESSION_ID)
    expect(after._sessions[DRAFT_SESSION_ID]).toBeDefined()
    expect(after._sessions[DRAFT_SESSION_ID].messages).toHaveLength(0)
    expect(after._sessions['old-session']).toBeDefined()
    expect(after._sessions['old-session'].messages).toHaveLength(1)
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
    } as never)

    const proj = useChatStore.getState().projectSessions['/test']
    expect(proj._sessions[DRAFT_SESSION_ID].cwd).toBe('/home/user/project')
    expect(proj.homedir).toBe('/home/user')
    expect(proj.sandboxInfo).toEqual({ enabled: false, autoAllowBash: true })
  })
})

describe('lazy session creation on early events', () => {
  it('creates DRAFT session on init_ready when project has no sessions', () => {
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
    expect(proj._activeSessionId).toBe(DRAFT_SESSION_ID)
    expect(proj._sessions[DRAFT_SESSION_ID]).toBeDefined()
    expect(proj._sessions[DRAFT_SESSION_ID].cwd).toBe('/home/user')
  })

  it('creates DRAFT session on session_init when project has no sessions', () => {
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
    expect(proj._sessions[DRAFT_SESSION_ID]).toBeUndefined()
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
  it('calls resumeSession when switching back to a project with active session', async () => {
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

  it('does NOT call resumeSession for DRAFT session', async () => {
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
    const proj = useChatStore.getState().projectSessions['/model-test']
    const session = proj._sessions[DRAFT_SESSION_ID]
    expect(session.selectedModel).toBe('claude-sonnet-4-6')
    expect(session.selectedEffort).toBe('medium')
  })

  it('does not set effort when model has no supportedEffortLevels', () => {
    useChatStore.setState({
      availableModels: [{ id: 'claude-haiku-4-5', name: 'Haiku' }] as never[],
    })

    useChatStore.getState().ensureSession('/no-effort')
    const session = useChatStore.getState().projectSessions['/no-effort']._sessions[DRAFT_SESSION_ID]
    expect(session.selectedModel).toBe('claude-haiku-4-5')
    expect(session.selectedEffort).toBeUndefined()
  })

  it('leaves default model when no models available', () => {
    useChatStore.setState({ availableModels: [] })

    useChatStore.getState().ensureSession('/empty-models')
    const session = useChatStore.getState().projectSessions['/empty-models']._sessions[DRAFT_SESSION_ID]
    expect(session.selectedModel).toBe('')
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
    const session = useChatStore.getState().projectSessions['/codex-cache']._sessions[DRAFT_SESSION_ID]
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
    const session = useChatStore.getState().projectSessions['/codex-memory']._sessions[DRAFT_SESSION_ID]
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
    expect(mockWindowApp.resumeSession).toHaveBeenCalledWith('/test', 'ses-b', '/test')
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
    expect(mockWindowApp.resumeSession).toHaveBeenCalledWith('/test', 'ses-b', '/test')
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
    expect(mockWindowApp.resumeSession).toHaveBeenCalledWith('/test', 'db-session', '/test')
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
            [DRAFT_SESSION_ID]: {
              ...proj._sessions[DRAFT_SESSION_ID],
              preferredProvider: 'codex',
              selectedCodexCollaborationMode: 'default',
            },
          },
        },
      },
    })

    useChatStore.getState().togglePlanModeShortcut()
    expect(useChatStore.getState().projectSessions['/test']._sessions[DRAFT_SESSION_ID].selectedCodexCollaborationMode).toBe('plan')

    useChatStore.getState().togglePlanModeShortcut()
    expect(useChatStore.getState().projectSessions['/test']._sessions[DRAFT_SESSION_ID].selectedCodexCollaborationMode).toBe('default')
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
            [DRAFT_SESSION_ID]: {
              ...proj._sessions[DRAFT_SESSION_ID],
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
              [DRAFT_SESSION_ID]: {
                ...proj._sessions[DRAFT_SESSION_ID],
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
              [DRAFT_SESSION_ID]: {
                ...proj._sessions[DRAFT_SESSION_ID],
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

    const session = useChatStore.getState().projectSessions['/test']._sessions[DRAFT_SESSION_ID]
    expect(session.awaitingAssistantReply).toBe(false)
  })

  it('clears awaitingAssistantReply when sendMessage throws', async () => {
    setupProject('/test')
    useChatStore.setState({
      availableModels: [{ id: 'claude-sonnet-4-6', name: 'Sonnet', supportedEffortLevels: ['low', 'medium', 'high'] }] as never[],
    })
    mockWindowAgent.sendMessage.mockRejectedValueOnce(new Error('send failed'))

    await expect(useChatStore.getState().sendMessage('hello')).rejects.toThrow('send failed')

    const session = useChatStore.getState().projectSessions['/test']._sessions[DRAFT_SESSION_ID]
    expect(session.awaitingAssistantReply).toBe(false)
  })

  it('keeps awaitingAssistantReply on status_change idle', () => {
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
              [DRAFT_SESSION_ID]: {
                ...proj._sessions[DRAFT_SESSION_ID],
                awaitingAssistantReply: true,
              },
            },
          },
        },
      }
    })

    useChatStore.getState().handleAgentEvent(makeEvent({
      type: 'status_change',
      sessionId: DRAFT_SESSION_ID,
      status: 'idle',
    }))

    const session = useChatStore.getState().projectSessions['/test']._sessions[DRAFT_SESSION_ID]
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
              ...proj._sessions[DRAFT_SESSION_ID],
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
    expect(mockWindowApp.codexSteer).toHaveBeenCalledWith(codexSid, 'steer follow-up', lastMessage?.id)
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
            [DRAFT_SESSION_ID]: {
              ...proj._sessions[DRAFT_SESSION_ID],
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

    const session = useChatStore.getState().projectSessions['/test']._sessions[DRAFT_SESSION_ID]
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

    const updatedSession = useChatStore.getState().projectSessions['/test']._sessions[DRAFT_SESSION_ID]
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

    const session = useChatStore.getState().projectSessions['/test']._sessions[DRAFT_SESSION_ID]
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
              ...proj._sessions[DRAFT_SESSION_ID],
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
              ...proj._sessions[DRAFT_SESSION_ID],
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
    const session = useChatStore.getState().projectSessions['/test']._sessions[DRAFT_SESSION_ID]
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
    const session = useChatStore.getState().projectSessions['/test']._sessions[DRAFT_SESSION_ID]
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

    const session = useChatStore.getState().projectSessions['/test']._sessions[DRAFT_SESSION_ID]
    const progress = session.taskProgress['tool-abc']
    expect(progress.description).toBe('late progress')
    expect(progress.totalTokens).toBe(100)
    expect(progress.toolUses).toBe(2)
    expect(progress.completed).toBe(true)
    expect(progress.outputFile).toBe('/tmp/out.log')
  })
})

describe('worktree session save isolation', () => {
  it('saves each worktree session with its own _worktreePath on re-key', () => {
    setupProject('/test')

    useChatStore.setState((s) => {
      const project = s.projectSessions['/test']
      return {
        projectSessions: {
          ...s.projectSessions,
          '/test': {
            ...project,
            _activeSessionId: DRAFT_SESSION_ID,
            _sessions: {
              [DRAFT_SESSION_ID]: {
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

    expect(mockWindowApp.createSession).toHaveBeenCalledWith(
      '/test', 'wt-session-A', true, 'feature-a', '/worktrees/project/wt-A', expect.any(String),
    )

    mockWindowApp.createSession.mockClear()

    useChatStore.setState((s) => {
      const project = s.projectSessions['/test']
      return {
        projectSessions: {
          ...s.projectSessions,
          '/test': {
            ...project,
            _activeSessionId: DRAFT_SESSION_ID,
            _sessions: {
              ...project._sessions,
              [DRAFT_SESSION_ID]: {
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

    expect(mockWindowApp.createSession).toHaveBeenCalledWith(
      '/test', 'wt-session-B', true, 'feature-b', '/worktrees/project/wt-B', expect.any(String),
    )
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

    resolveCodexRun({ threadId: 'thread-iso', finalResponse: 'isolation ok', usage: null, items: [] })
    await sendPromise

    const after = useChatStore.getState().projectSessions['/test']
    expect(after._activeSessionId).toBe('ses-B')

    const codexSession = after._sessions[codexSid]
    const assistantMsg = codexSession.messages.find((m) => m.role === 'assistant')
    expect(assistantMsg?.status).toBe('complete')
    expect(assistantMsg?.content[0]).toEqual({ type: 'text', text: 'isolation ok' })
    expect(codexSession.status).toBe('idle')

    const sesB = after._sessions['ses-B']
    expect(sesB.messages).toHaveLength(1)
    expect(sesB.messages[0].id).toBe('b-msg')

    expect(after.unseenCompletedSessions.has(codexSid)).toBe(true)
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
    expect(after._activeSessionId).toBe(DRAFT_SESSION_ID)
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
    expect(after._activeSessionId).toBe(DRAFT_SESSION_ID)
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
