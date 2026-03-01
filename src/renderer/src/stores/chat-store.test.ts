import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { AgentEvent } from '../../../shared/agent-types'

vi.mock('./app', () => ({
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
  resetSession: vi.fn().mockResolvedValue(undefined),
  activateSession: vi.fn().mockResolvedValue(undefined),
  readProjectAdditionalDirs: vi.fn().mockResolvedValue([]),
}

const mockWindowApp = {
  createSession: vi.fn().mockResolvedValue(undefined),
  saveSessionState: vi.fn().mockResolvedValue(undefined),
  loadSessionState: vi.fn().mockResolvedValue(null),
  resumeSession: vi.fn().mockResolvedValue(undefined),
  listSessionsForFolder: vi.fn().mockResolvedValue([]),
  codexListModels: vi.fn().mockResolvedValue([]),
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
})

describe('idle eviction', () => {
  it('evicts non-active session from _sessions when it goes idle', () => {
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
      pendingPermission: { requestId: 'r1', toolName: 'Bash', description: 'run ls' } as never,
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
    expect(after._sessions['a'].pendingPermission).toBeTruthy()
    expect(after.hasPendingInteraction).toBe(true)
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

describe('init_ready updates project-level fields', () => {
  it('sets cwd, homedir, sandboxInfo on project', () => {
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
    expect(proj.cwd).toBe('/home/user/project')
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
    expect(proj.cwd).toBe('/home/user')
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
  it('calls activateSession when switching back to a project with active session', async () => {
    setupProject('/proj-a')
    useChatStore.getState().handleAgentEvent(makeEvent({
      type: 'session_init',
      projectPath: '/proj-a',
      session: { sessionId: 'sid-a' } as never,
    }))

    setupProject('/proj-b')

    await useChatStore.getState().switchProject('/proj-b')
    mockWindowAgent.activateSession.mockClear()

    await useChatStore.getState().switchProject('/proj-a')
    expect(mockWindowAgent.activateSession).toHaveBeenCalledWith('/proj-a', 'sid-a')
  })

  it('does NOT call activateSession for DRAFT session', async () => {
    setupProject('/proj-c')
    setupProject('/proj-d')

    await useChatStore.getState().switchProject('/proj-d')
    mockWindowAgent.activateSession.mockClear()

    await useChatStore.getState().switchProject('/proj-c')
    expect(mockWindowAgent.activateSession).not.toHaveBeenCalled()
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
    expect(session.selectedEffort).toBe('high')
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

describe('resumeSession Case A (in _sessions)', () => {
  it('switches pointer to target session and calls activateSession', async () => {
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

    mockWindowAgent.activateSession.mockResolvedValue(undefined)
    await useChatStore.getState().resumeSession('ses-b')

    const after = useChatStore.getState().projectSessions['/test']
    expect(after._activeSessionId).toBe('ses-b')
    expect(mockWindowAgent.activateSession).toHaveBeenCalledWith('/test', 'ses-b')
  })

  it('sets status to idle when activateSession throws', async () => {
    setupProject('/test')
    const proj = useChatStore.getState().projectSessions['/test']

    useChatStore.setState({
      projectSessions: {
        '/test': {
          ...proj,
          _activeSessionId: 'ses-a',
          _sessions: {
            'ses-a': createDefaultPerSessionState(),
            'ses-b': createDefaultPerSessionState(),
          },
        },
      },
    })

    mockWindowAgent.activateSession.mockRejectedValue(new Error('No background session'))
    await useChatStore.getState().resumeSession('ses-b')

    const after = useChatStore.getState().projectSessions['/test']
    expect(after._activeSessionId).toBe('ses-b')
    expect(after._sessions['ses-b'].status).toBe('idle')
  })
})

describe('resumeSession Case B (from DB)', () => {
  it('loads session from DB and sets active', async () => {
    setupProject('/test')

    mockWindowApp.loadSessionState.mockResolvedValue({
      messages: [{ id: 'db-msg', role: 'assistant', content: [], status: 'complete', createdAt: '', providerId: 'claude' }],
      totalCostUsd: 0.05,
      contextTokens: 1000,
      gitBranch: null,
      provider: 'claude',
    })
    mockWindowApp.resumeSession.mockResolvedValue(undefined)

    await useChatStore.getState().resumeSession('db-session')

    const after = useChatStore.getState().projectSessions['/test']
    expect(after._activeSessionId).toBe('db-session')
    expect(after._sessions['db-session']).toBeDefined()
    expect(after._sessions['db-session'].messages).toHaveLength(1)
    expect(after._sessions['db-session'].messages[0].id).toBe('db-msg')
    expect(after._sessions['db-session'].totalCostUsd).toBe(0.05)
    expect(after._sessions['db-session'].contextTokens).toBe(1000)
    expect(after._sessions['db-session'].sessionProvider).toBe('claude')
    expect(after.showHistory).toBe(false)
    expect(mockWindowApp.resumeSession).toHaveBeenCalledWith('/test', 'db-session', undefined)
  })

  it('handles null loadSessionState gracefully', async () => {
    setupProject('/test')
    mockWindowApp.loadSessionState.mockResolvedValue(null)
    mockWindowApp.resumeSession.mockResolvedValue(undefined)

    await useChatStore.getState().resumeSession('missing-session')

    const after = useChatStore.getState().projectSessions['/test']
    expect(after._activeSessionId).toBe('missing-session')
    expect(after._sessions['missing-session'].messages).toHaveLength(0)
    expect(after._sessions['missing-session'].totalCostUsd).toBe(0)
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
              pendingPermission: { requestId: 'r1', toolName: 'Bash', description: 'run ls' } as never,
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
    expect(session.pendingPermission).toBeNull()
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
            a: { ...createDefaultPerSessionState(), pendingPermission: { requestId: 'r1', toolName: 'Bash', description: 'ls' } as never },
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
