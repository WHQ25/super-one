/** @vitest-environment jsdom */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { AgentEvent, ChatMessage } from '@superone/shared/agent-types'

const mockLocalStorage = {
  getItem: vi.fn().mockReturnValue(null),
  setItem: vi.fn(),
  removeItem: vi.fn(),
  clear: vi.fn(),
}

vi.mock('../../app', () => ({
  useAppStore: {
    getState: () => ({
      getWorktreeState: () => ({}),
      setActiveWorktree: vi.fn(),
      clearWorktree: vi.fn().mockResolvedValue(undefined),
    }),
  },
}))

const mockGetLiveSnapshots = vi.fn()
const mockTrace = vi.fn()

const mockWindowAgent = {
  getLiveSnapshots: mockGetLiveSnapshots,
  parkSession: vi.fn().mockResolvedValue(undefined),
  activateSession: vi.fn().mockResolvedValue(undefined),
  sendMessage: vi.fn().mockResolvedValue(undefined),
  prewarm: vi.fn().mockResolvedValue(undefined),
  watchBashOutput: vi.fn(),
}

const mockWindowApp = {
  trace: mockTrace,
  saveSessionState: vi.fn().mockResolvedValue(undefined),
  loadSessionState: vi.fn().mockResolvedValue(null),
  listSessionsForFolder: vi.fn().mockResolvedValue([]),
  readProjectAdditionalDirs: vi.fn().mockResolvedValue([]),
  codexListModels: vi.fn().mockResolvedValue([]),
  watchBashOutput: vi.fn(),
  getAppSettings: vi.fn().mockResolvedValue({
    analyticsEnabled: true,
    agentPreference: {
      claude: { defaultModel: '', defaultEffort: '', defaultPermissionMode: '', defaultSandboxMode: '' },
      codex: { defaultModel: '', defaultReasoningEffort: '', defaultPermissionPreset: '' },
    },
  }),
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

const { useChatStore, createDefaultPerSessionState, createDefaultProjectState } = await import('../../chat')

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

function resetStore() {
  useChatStore.setState({
    projectSessions: {},
    activeProject: null,
    remoteSessions: {},
    mountedSessions: {},
    _previousFocusedSession: null,
    agentTitles: {},
    _bashOutputs: {},
    _shareProgress: {},
  })
}

beforeEach(() => {
  resetStore()
  mockGetLiveSnapshots.mockReset()
  mockTrace.mockReset()
  vi.clearAllMocks()
})

describe('remote_session_start', () => {
  it('subscribe=true seeds remoteSessions, creates session with _historyHydrated=false, and infers provider from harnessId', () => {
    useChatStore.getState().handleAgentEvent({
      type: 'remote_session_start',
      remoteProjectPath: '/p',
      remoteSessionId: 'sess-A',
      isSubscribe: true,
      harnessId: 'codex',
    } as AgentEvent)

    const state = useChatStore.getState()
    expect(state.remoteSessions['/p']).toEqual(['sess-A'])
    const session = state.projectSessions['/p']._sessions['sess-A']
    expect(session).toBeDefined()
    expect(session._historyHydrated).toBe(false)
    expect(session.sessionProvider).toBe('codex')
    expect(session.preferredProvider).toBe('codex')
  })

  it('subscribe=false does NOT add to remoteSessions but still creates the session entry', () => {
    useChatStore.getState().handleAgentEvent({
      type: 'remote_session_start',
      remoteProjectPath: '/p',
      remoteSessionId: 'sess-B',
      isSubscribe: false,
      harnessId: 'claude',
    } as AgentEvent)

    const state = useChatStore.getState()
    expect(state.remoteSessions['/p']).toBeUndefined()
    const session = state.projectSessions['/p']._sessions['sess-B']
    expect(session).toBeDefined()
    expect(session._historyHydrated).toBe(true)
    expect(session.sessionProvider).toBe('claude')
  })
})

describe('mounted session eviction protection', () => {
  function seedTwoSessions() {
    const proj = createDefaultProjectState()
    proj._activeSessionId = 'sid-active'
    proj._sessions = {
      'sid-active': { ...createDefaultPerSessionState(), _historyHydrated: true },
      'sid-mounted': { ...createDefaultPerSessionState(), _historyHydrated: true, status: 'streaming' },
    }
    useChatStore.setState({ projectSessions: { '/p': proj }, activeProject: '/p', mountedSessions: {} })
  }

  it('evicts a non-active session that goes idle when it is not mounted', () => {
    seedTwoSessions()
    useChatStore.getState().handleAgentEvent({ type: 'status_change', projectPath: '/p', sessionId: 'sid-mounted', status: 'idle' } as AgentEvent)
    expect(useChatStore.getState().projectSessions['/p']._sessions['sid-mounted']).toBeUndefined()
  })

  it('keeps a non-active session that goes idle while it is mounted', () => {
    seedTwoSessions()
    useChatStore.setState({ mountedSessions: { '/p': ['sid-mounted'] } })
    useChatStore.getState().handleAgentEvent({ type: 'status_change', projectPath: '/p', sessionId: 'sid-mounted', status: 'idle' } as AgentEvent)
    const sess = useChatStore.getState().projectSessions['/p']._sessions['sid-mounted']
    expect(sess).toBeDefined()
    expect(sess.status).toBe('idle')
  })

  it('mountSession registers protection and ensures a session entry (even cross-project)', async () => {
    await useChatStore.getState().mountSession('/q', 'sid-x')
    const state = useChatStore.getState()
    expect(state.mountedSessions['/q']).toEqual(['sid-x'])
    expect(state.projectSessions['/q']._sessions['sid-x']).toBeDefined()
  })

  it('unmountSession removes protection so the session can be evicted again', () => {
    seedTwoSessions()
    useChatStore.setState({ mountedSessions: { '/p': ['sid-mounted'] } })
    useChatStore.getState().unmountSession('/p', 'sid-mounted')
    expect(useChatStore.getState().mountedSessions['/p']).toBeUndefined()
    useChatStore.getState().handleAgentEvent({ type: 'status_change', projectPath: '/p', sessionId: 'sid-mounted', status: 'idle' } as AgentEvent)
    expect(useChatStore.getState().projectSessions['/p']._sessions['sid-mounted']).toBeUndefined()
  })

  it('does NOT evict a remote node project session (no desktop SQLite backup)', () => {
    // remote:<connectionId>:<hostPath> sessions only live in renderer memory + node.
    // Idle eviction forced cold rehydrate and occasionally dropped stream-only
    // assistant turns (interrupted / catalog lag).
    const projectKey = 'remote:env-1:/work/app'
    const proj = createDefaultProjectState()
    proj._activeSessionId = 'sid-active'
    proj._sessions = {
      'sid-active': { ...createDefaultPerSessionState(), _historyHydrated: true },
      'sid-bg': {
        ...createDefaultPerSessionState(),
        _historyHydrated: true,
        status: 'streaming',
        messages: [makeMessage('asst-keep', 'assistant')],
      },
    }
    useChatStore.setState({
      projectSessions: { [projectKey]: proj },
      activeProject: projectKey,
      mountedSessions: {},
      remoteSessions: {},
    })

    useChatStore.getState().handleAgentEvent({
      type: 'status_change',
      projectPath: projectKey,
      sessionId: 'sid-bg',
      status: 'idle',
    } as AgentEvent)

    const bg = useChatStore.getState().projectSessions[projectKey]!._sessions['sid-bg']
    expect(bg).toBeDefined()
    expect(bg.status).toBe('idle')
    expect(bg.messages.map((m) => m.id)).toEqual(['asst-keep'])
  })
})

describe('shared_file_progress', () => {
  it('records upload progress keyed by file path without needing a session entry', () => {
    useChatStore.getState().handleAgentEvent({
      type: 'shared_file_progress',
      path: '/p/assets/screenshot.png',
      loaded: 112,
      total: 180,
      projectPath: '/p',
      sessionId: 'sess-A',
    } as AgentEvent)

    expect(useChatStore.getState()._shareProgress['/p/assets/screenshot.png']).toEqual({ loaded: 112, total: 180 })
  })
})

describe('remote_session_end', () => {
  it('subscribe=true removes the entry from remoteSessions', () => {
    useChatStore.getState().handleAgentEvent({
      type: 'remote_session_start',
      remoteProjectPath: '/p',
      remoteSessionId: 'sess-A',
      isSubscribe: true,
    } as AgentEvent)
    expect(useChatStore.getState().remoteSessions['/p']).toEqual(['sess-A'])

    useChatStore.getState().handleAgentEvent({
      type: 'remote_session_end',
      remoteProjectPath: '/p',
      remoteSessionId: 'sess-A',
      isSubscribe: true,
    } as AgentEvent)

    expect(useChatStore.getState().remoteSessions['/p']).toBeUndefined()
  })

  it('subscribe=false is a noop and leaves remoteSessions unchanged', () => {
    useChatStore.getState().handleAgentEvent({
      type: 'remote_session_start',
      remoteProjectPath: '/p',
      remoteSessionId: 'sess-A',
      isSubscribe: true,
    } as AgentEvent)
    const before = useChatStore.getState().remoteSessions

    useChatStore.getState().handleAgentEvent({
      type: 'remote_session_end',
      remoteProjectPath: '/p',
      remoteSessionId: 'sess-A',
    } as AgentEvent)

    expect(useChatStore.getState().remoteSessions).toBe(before)
  })
})

describe('provider_changed', () => {
  it('triggers refreshCodexModels(true) when harnessId=codex', () => {
    const refreshSpy = vi.fn().mockResolvedValue(undefined)
    useChatStore.setState({ refreshCodexModels: refreshSpy } as never)

    useChatStore.getState().handleAgentEvent({
      type: 'provider_changed',
      harnessId: 'codex',
    } as AgentEvent)

    expect(refreshSpy).toHaveBeenCalledTimes(1)
    expect(refreshSpy).toHaveBeenCalledWith(true)
  })

  it('does NOT trigger refreshCodexModels for non-codex harness', () => {
    const refreshSpy = vi.fn().mockResolvedValue(undefined)
    useChatStore.setState({ refreshCodexModels: refreshSpy } as never)

    useChatStore.getState().handleAgentEvent({
      type: 'provider_changed',
      harnessId: 'claude',
    } as AgentEvent)

    expect(refreshSpy).not.toHaveBeenCalled()
  })
})

describe('additional_dirs_changed', () => {
  function seedProviderDirs() {
    const project = createDefaultProjectState()
    project._activeSessionId = 'sid-1'
    project._sessions = {
      'sid-1': {
        ...createDefaultPerSessionState(),
        additionalDirs: ['/old-session'],
        additionalDirsDirty: true,
      },
    }
    project.userAdditionalDirs = ['/claude-user']
    project.projectAdditionalDirs = ['/claude-project']
    project.codexUserAdditionalDirs = ['/old-codex-user']
    project.codexProjectAdditionalDirs = ['/old-codex-project']
    useChatStore.setState({ projectSessions: { '/p': project }, activeProject: '/p' })
  }

  it('updates only Codex project roots for a Codex event', () => {
    seedProviderDirs()

    useChatStore.getState().handleAgentEvent({
      type: 'additional_dirs_changed',
      projectPath: '/p',
      sessionId: 'sid-1',
      provider: 'codex',
      additionalDirectories: ['/codex-user', '/codex-project', '/session'],
      additionalDirsScoped: {
        user: ['/codex-user'],
        projectShared: [],
        projectLocal: ['/codex-project'],
      },
      sessionAdditionalDirs: ['/session'],
    } as AgentEvent)

    const project = useChatStore.getState().projectSessions['/p']
    expect(project.codexUserAdditionalDirs).toEqual(['/codex-user'])
    expect(project.codexProjectAdditionalDirs).toEqual(['/codex-project'])
    expect(project.userAdditionalDirs).toEqual(['/claude-user'])
    expect(project.projectAdditionalDirs).toEqual(['/claude-project'])
    expect(project._sessions['sid-1'].additionalDirs).toEqual(['/session'])
    expect(project._sessions['sid-1'].additionalDirsDirty).toBe(false)
  })

  it('keeps legacy provider-less events scoped to Claude', () => {
    seedProviderDirs()

    useChatStore.getState().handleAgentEvent({
      type: 'additional_dirs_changed',
      projectPath: '/p',
      sessionId: 'sid-1',
      additionalDirectories: ['/new-claude'],
      additionalDirsScoped: {
        user: [],
        projectShared: ['/new-claude'],
        projectLocal: [],
      },
      sessionAdditionalDirs: [],
    } as AgentEvent)

    const project = useChatStore.getState().projectSessions['/p']
    expect(project.projectAdditionalDirs).toEqual(['/new-claude'])
    expect(project.codexProjectAdditionalDirs).toEqual(['/old-codex-project'])
  })
})

describe('session_title_changed', () => {
  it('updates agentTitles, projectSessions[].sessions[].title, and _sessions[].._title together', () => {
    const proj = createDefaultProjectState()
    proj._activeSessionId = 'sid-1'
    proj._sessions = { 'sid-1': { ...createDefaultPerSessionState(), _title: null } }
    proj.sessions = [
      { sessionId: 'sid-1', title: 'old title' } as never,
      { sessionId: 'sid-2', title: 'untouched' } as never,
    ]
    useChatStore.setState({ projectSessions: { '/p': proj } })

    useChatStore.getState().handleAgentEvent({
      type: 'session_title_changed',
      sessionId: 'sid-1',
      title: 'new title',
      projectPath: '/p',
    } as AgentEvent)

    const state = useChatStore.getState()
    expect(state.agentTitles['sid-1']).toBe('new title')
    const after = state.projectSessions['/p']
    expect(after.sessions[0].title).toBe('new title')
    expect(after.sessions[1].title).toBe('untouched')
    expect(after._sessions['sid-1']._title).toBe('new title')
  })

  it('writes agentTitles even when projectPath is omitted (global title only)', () => {
    useChatStore.getState().handleAgentEvent({
      type: 'session_title_changed',
      sessionId: 'sid-x',
      title: 'just-the-title',
    } as AgentEvent)

    expect(useChatStore.getState().agentTitles['sid-x']).toBe('just-the-title')
  })
})

describe('per-session routing edge cases', () => {
  it('lazy_session creates a new session entry when sessionId is not in _sessions and logs [session-drift]', () => {
    const proj = createDefaultProjectState()
    proj._activeSessionId = 'sid-A'
    proj._sessions = { 'sid-A': createDefaultPerSessionState() }
    useChatStore.setState({ projectSessions: { '/p': proj }, activeProject: '/p' })
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})

    useChatStore.getState().handleAgentEvent({
      type: 'status_change',
      projectPath: '/p',
      sessionId: 'sid-B',
      status: 'streaming',
    } as AgentEvent)

    const after = useChatStore.getState().projectSessions['/p']
    expect(after._sessions['sid-B']).toBeDefined()
    expect(after._sessions['sid-B']._historyHydrated).toBe(false)
    expect(warnSpy).toHaveBeenCalledWith(
      '[session-drift] lazy_session created from incoming event',
      expect.objectContaining({ eventType: 'status_change', eventSessionId: 'sid-B', activeSid: 'sid-A' }),
    )
    warnSpy.mockRestore()
  })

  it('drops events that have no eventSessionId AND no _activeSessionId, and traces session.route.dropped', () => {
    const proj = createDefaultProjectState()
    proj._activeSessionId = null
    useChatStore.setState({ projectSessions: { '/p': proj }, activeProject: '/p' })

    const before = useChatStore.getState().projectSessions

    useChatStore.getState().handleAgentEvent({
      type: 'status_change',
      projectPath: '/p',
      status: 'streaming',
    } as AgentEvent)

    expect(useChatStore.getState().projectSessions).toBe(before)
    expect(mockTrace).toHaveBeenCalledWith(
      'session.route.dropped',
      'status_change',
      expect.objectContaining({ reason: 'no_route', activeSid: null }),
    )
  })
})

describe('syncLiveSnapshots', () => {
  it('swallows getLiveSnapshots errors and leaves state untouched', async () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
    mockGetLiveSnapshots.mockRejectedValueOnce(new Error('boom'))
    const before = useChatStore.getState().projectSessions

    await expect(useChatStore.getState().syncLiveSnapshots()).resolves.toBeUndefined()

    expect(useChatStore.getState().projectSessions).toBe(before)
    expect(warnSpy).toHaveBeenCalledWith('[chat] getLiveSnapshots failed:', expect.any(Error))
    warnSpy.mockRestore()
  })

  it('returns early without mutating projectSessions when entries is empty', async () => {
    mockGetLiveSnapshots.mockResolvedValueOnce([])
    const before = useChatStore.getState().projectSessions

    await useChatStore.getState().syncLiveSnapshots()

    expect(useChatStore.getState().projectSessions).toBe(before)
  })

  it('merges live snapshot with prevSession using Math.max for totalCostUsd and contextTokens', async () => {
    const proj = createDefaultProjectState()
    const seedSession = {
      ...createDefaultPerSessionState(),
      totalCostUsd: 5,
      contextTokens: 999,
    }
    proj._activeSessionId = 'sid-1'
    proj._sessions = { 'sid-1': seedSession }
    useChatStore.setState({ projectSessions: { '/p': proj } })

    mockGetLiveSnapshots.mockResolvedValueOnce([
      {
        sid: 'sid-1',
        projectPath: '/p',
        isActive: true,
        isStreaming: false,
        permissionMode: 'default',
        sandboxInfo: { enabled: true, autoAllowBash: false },
        snapshot: {
          id: 'sid-1',
          projectPath: '/p',
          cwd: '/p',
          providerId: 'claude',
          harnessId: 'claude',
          status: 'idle',
          providerSessionId: null,
          currentMessageId: null,
          createdAt: 0,
          lastUserMessageAt: null,
          messages: [],
          totalCostUsd: 3,
          contextTokens: 50,
          title: null,
          isWorktree: false,
          worktreePath: null,
          gitBranch: null,
          worktreeMissing: false,
          apiProviderId: null,
        },
        pendingInteractions: [],
        replayEvents: [],
      },
    ])

    await useChatStore.getState().syncLiveSnapshots()

    const merged = useChatStore.getState().projectSessions['/p']._sessions['sid-1']
    expect(merged.totalCostUsd).toBe(5)
    expect(merged.contextTokens).toBe(999)
  })

  it('replayEvents handler errors are logged with [chat] replay event error: and processing continues', async () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})

    const goodReplay = makeMessage('m1', 'assistant')
    void goodReplay

    mockGetLiveSnapshots.mockResolvedValueOnce([
      {
        sid: 'sid-1',
        projectPath: '/p',
        isActive: true,
        isStreaming: false,
        permissionMode: 'default',
        sandboxInfo: { enabled: true, autoAllowBash: false },
        snapshot: {
          id: 'sid-1',
          projectPath: '/p',
          cwd: '/p',
          providerId: 'claude',
          harnessId: 'claude',
          status: 'idle',
          providerSessionId: null,
          currentMessageId: null,
          createdAt: 0,
          lastUserMessageAt: null,
          messages: [],
          totalCostUsd: 0,
          contextTokens: 0,
          title: null,
          isWorktree: false,
          worktreePath: null,
          gitBranch: null,
          worktreeMissing: false,
          apiProviderId: null,
        },
        pendingInteractions: [],
        replayEvents: [
          { type: 'message_start', projectPath: '/p', sessionId: 'sid-1' } as AgentEvent,
          {
            type: 'message_start',
            projectPath: '/p',
            sessionId: 'sid-1',
            message: makeMessage('m2', 'assistant') as never,
          } as AgentEvent,
        ],
      },
    ])

    await expect(useChatStore.getState().syncLiveSnapshots()).resolves.toBeUndefined()

    expect(warnSpy.mock.calls.some((c) => c[0] === '[chat] replay event error:')).toBe(true)
    const after = useChatStore.getState().projectSessions['/p']._sessions['sid-1']
    expect(after.messages.some((m) => m.id === 'm2')).toBe(true)
    warnSpy.mockRestore()
  })
})
