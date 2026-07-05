/** @vitest-environment jsdom */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

const mockPrewarm = vi.fn().mockResolvedValue(undefined)

vi.mock('@/stores/app', () => ({
  useAppStore: { getState: () => ({ sandboxCapability: null }) },
}))
vi.mock('@/stores/activity-view-state', () => ({
  useActivityViewStateStore: { getState: () => ({}) },
}))

const mockMiniAppAuthorize = vi.fn().mockResolvedValue(undefined)
const mockMiniAppOpenApps: Record<string, {
  projectDir: string
  entry: { id: string }
  holderSessions: Set<string>
}> = {}
const mockMiniAppSetState = vi.fn((updater: (s: typeof mockMiniAppStoreState) => typeof mockMiniAppStoreState) => {
  const next = updater(mockMiniAppStoreState)
  if (next.openApps) mockMiniAppStoreState.openApps = next.openApps
})
const mockMiniAppStoreState = { openApps: mockMiniAppOpenApps }
vi.mock('@/stores/miniapp', () => ({
  useMiniAppStore: {
    getState: () => mockMiniAppStoreState,
    setState: mockMiniAppSetState,
  },
}))

vi.stubGlobal('window', {
  agent: {
    prewarm: mockPrewarm,
    parkSession: vi.fn().mockResolvedValue(undefined),
    resumeSession: vi.fn().mockResolvedValue(undefined),
  },
  app: {
    trace: vi.fn(),
    getAppSettings: vi.fn().mockResolvedValue({ agentPreference: {} }),
  },
  miniapp: { authorize: mockMiniAppAuthorize },
})

await import('../index')
const { createDefaultPerSessionState, createDefaultProjectState } = await import('../defaults')
const {
  getActivePerSession,
  getProject,
  mergeProjectAndSessionDirs,
  resolveActiveSessionId,
  schedulePrewarm,
  cancelPrewarm,
  triggerPrewarm,
  updateActivePerSession,
  updatePerSession,
  updateProjectState,
  inheritMiniAppToolsForNewSession,
} = await import('./store-helpers')
const { useChatStore } = await import('../index')

beforeEach(() => {
  useChatStore.setState({
    projectSessions: {},
    activeProject: null,
    remoteSessions: {},
    _previousFocusedSession: null,
    harnessResources: { claude: null, codex: null },
    initializedHarnesses: new Set(),
  })
  mockPrewarm.mockClear()
  mockMiniAppAuthorize.mockClear()
  mockMiniAppSetState.mockClear()
  for (const k of Object.keys(mockMiniAppOpenApps)) delete mockMiniAppOpenApps[k]
})

describe('getProject', () => {
  it('returns the project record at projectPath when present', () => {
    const proj = createDefaultProjectState()
    useChatStore.setState({ projectSessions: { '/p1': proj } })
    expect(getProject(useChatStore.getState(), '/p1')).toBe(proj)
  })

  it('falls back to a fresh default project when the path is unknown', () => {
    const result = getProject(useChatStore.getState(), '/unknown')
    expect(result._sessions).toEqual({})
    expect(result._activeSessionId).toBeNull()
  })

  it("returns the active project when projectPath isn't supplied", () => {
    const proj = createDefaultProjectState()
    useChatStore.setState({ projectSessions: { '/active': proj }, activeProject: '/active' })
    expect(getProject(useChatStore.getState())).toBe(proj)
  })

  it('returns a default when no projectPath is supplied AND no project is active', () => {
    const result = getProject(useChatStore.getState())
    expect(result._sessions).toEqual({})
  })
})

describe('getActivePerSession', () => {
  it('returns the active session record', () => {
    const proj = createDefaultProjectState()
    const sess = createDefaultPerSessionState()
    sess.cwd = '/p1'
    proj._activeSessionId = 'sid-1'
    proj._sessions = { 'sid-1': sess }
    useChatStore.setState({ projectSessions: { '/p1': proj }, activeProject: '/p1' })
    expect(getActivePerSession(useChatStore.getState())).toBe(sess)
  })

  it('returns a default session when there is no active session id', () => {
    const proj = createDefaultProjectState()
    useChatStore.setState({ projectSessions: { '/p1': proj }, activeProject: '/p1' })
    const result = getActivePerSession(useChatStore.getState())
    expect(result.messages).toEqual([])
  })
})

describe('mergeProjectAndSessionDirs', () => {
  it('unions userAdditionalDirs + projectAdditionalDirs + session.additionalDirs, dedup-preserving order', () => {
    const proj = { ...createDefaultProjectState(), userAdditionalDirs: ['/a'], projectAdditionalDirs: ['/a', '/b'] }
    const sess = { ...createDefaultPerSessionState(), additionalDirs: ['/b', '/c'] }
    expect(mergeProjectAndSessionDirs(proj, sess)).toEqual(['/a', '/b', '/c'])
  })
})

describe('triggerPrewarm', () => {
  it('is a no-op when no project is active or supplied', () => {
    triggerPrewarm(useChatStore.getState())
    expect(mockPrewarm).not.toHaveBeenCalled()
  })

  it('dispatches window.agent.prewarm with provider/model/effort hint from the active session', () => {
    const proj = createDefaultProjectState()
    const sess = { ...createDefaultPerSessionState(), selectedModel: 'opus-4-8', selectedEffort: 'high' as const }
    proj._activeSessionId = 'sid-1'
    proj._sessions = { 'sid-1': sess }
    useChatStore.setState({ projectSessions: { '/p1': proj }, activeProject: '/p1' })

    triggerPrewarm(useChatStore.getState())
    expect(mockPrewarm).toHaveBeenCalledTimes(1)
    const [path, hint] = mockPrewarm.mock.calls[0]
    expect(path).toBe('/p1')
    expect(hint).toMatchObject({ provider: 'claude', model: 'opus-4-8', effort: 'high' })
  })

  it('passes codex hint shape for codex sessions', () => {
    const proj = createDefaultProjectState()
    const sess = { ...createDefaultPerSessionState(), sessionProvider: 'codex' as const, selectedCodexModel: 'gpt-5-high' }
    proj._activeSessionId = 'sid-1'
    proj._sessions = { 'sid-1': sess }
    useChatStore.setState({ projectSessions: { '/p1': proj }, activeProject: '/p1' })

    triggerPrewarm(useChatStore.getState(), '/p1')
    const [, hint] = mockPrewarm.mock.calls[0]
    expect(hint.provider).toBe('codex')
    expect(hint.model).toBe('gpt-5-high')
    expect(hint.effort).toBeUndefined()
  })
})

describe('schedulePrewarm', () => {
  const seedActiveDraft = (path: string, draft = 'hi') => {
    const proj = createDefaultProjectState()
    proj._activeSessionId = 'sid-1'
    proj._sessions = { 'sid-1': { ...createDefaultPerSessionState(), draftText: draft } }
    useChatStore.setState({ projectSessions: { [path]: proj }, activeProject: path })
  }

  beforeEach(() => vi.useFakeTimers())
  afterEach(() => vi.useRealTimers())

  it('defers the first prewarm until 10s of sustained typing', () => {
    seedActiveDraft('/p-delay')
    schedulePrewarm(useChatStore.getState)
    expect(mockPrewarm).not.toHaveBeenCalled()
    vi.advanceTimersByTime(10_000)
    expect(mockPrewarm).toHaveBeenCalledTimes(1)
  })

  it('does not re-arm the 10s timer on subsequent keystrokes before it fires', () => {
    seedActiveDraft('/p-rearm')
    schedulePrewarm(useChatStore.getState)
    vi.advanceTimersByTime(6_000)
    schedulePrewarm(useChatStore.getState)
    vi.advanceTimersByTime(4_000)
    expect(mockPrewarm).toHaveBeenCalledTimes(1)
  })

  it('cancels the pending prewarm when the draft is cleared within 10s', () => {
    seedActiveDraft('/p-cancel')
    schedulePrewarm(useChatStore.getState)
    vi.advanceTimersByTime(4_000)
    cancelPrewarm('/p-cancel')
    vi.advanceTimersByTime(10_000)
    expect(mockPrewarm).not.toHaveBeenCalled()
  })

  it('skips the prewarm if the draft became empty by the time the timer fires', () => {
    seedActiveDraft('/p-empty')
    schedulePrewarm(useChatStore.getState)
    useChatStore.setState((s) => {
      s.projectSessions['/p-empty']._sessions['sid-1'].draftText = ''
      return { projectSessions: s.projectSessions }
    })
    vi.advanceTimersByTime(10_000)
    expect(mockPrewarm).not.toHaveBeenCalled()
  })

  it('throttles keepalive pings to once per 30s after the first warm', () => {
    seedActiveDraft('/p-keepalive')
    schedulePrewarm(useChatStore.getState)
    vi.advanceTimersByTime(10_000)
    expect(mockPrewarm).toHaveBeenCalledTimes(1)
    schedulePrewarm(useChatStore.getState)
    expect(mockPrewarm).toHaveBeenCalledTimes(1)
    vi.advanceTimersByTime(30_000)
    schedulePrewarm(useChatStore.getState)
    expect(mockPrewarm).toHaveBeenCalledTimes(2)
  })

  it('is a no-op when no project is active or provided', () => {
    schedulePrewarm(useChatStore.getState)
    vi.advanceTimersByTime(10_000)
    expect(mockPrewarm).not.toHaveBeenCalled()
  })
})

describe('updateProjectState / updatePerSession / updateActivePerSession', () => {
  it('updateProjectState applies a partial patch to the named project', () => {
    const state = useChatStore.getState()
    state.projectSessions['/p1'] = createDefaultProjectState()
    const updated = updateProjectState(state, '/p1', () => ({ showDirManager: true }))
    expect(updated.projectSessions?.['/p1'].showDirManager).toBe(true)
  })

  it('updatePerSession applies a partial patch to the targeted session id', () => {
    const state = useChatStore.getState()
    const proj = createDefaultProjectState()
    proj._sessions = { 'sid-1': createDefaultPerSessionState() }
    state.projectSessions['/p1'] = proj
    const updated = updatePerSession(state, '/p1', 'sid-1', () => ({ draftText: 'hello' }))
    expect(updated.projectSessions?.['/p1']._sessions['sid-1'].draftText).toBe('hello')
  })

  it('updateActivePerSession returns {} when no project is active', () => {
    expect(updateActivePerSession(useChatStore.getState(), () => ({ draftText: 'x' }))).toEqual({})
  })

  it("updateActivePerSession returns {} when project has no _activeSessionId", () => {
    const state = useChatStore.getState()
    state.projectSessions['/p1'] = createDefaultProjectState()
    useChatStore.setState({ activeProject: '/p1' })
    expect(updateActivePerSession(useChatStore.getState(), () => ({ draftText: 'x' }))).toEqual({})
  })

  it('updateActivePerSession routes through updatePerSession when both are set', () => {
    const proj = createDefaultProjectState()
    proj._activeSessionId = 'sid-1'
    proj._sessions = { 'sid-1': createDefaultPerSessionState() }
    useChatStore.setState({ projectSessions: { '/p1': proj }, activeProject: '/p1' })
    const updated = updateActivePerSession(useChatStore.getState(), () => ({ draftText: 'typed' }))
    expect(updated.projectSessions?.['/p1']._sessions['sid-1'].draftText).toBe('typed')
  })
})

describe('resolveActiveSessionId', () => {
  it('returns the project _activeSessionId', () => {
    const proj = createDefaultProjectState()
    proj._activeSessionId = 'sid-active'
    expect(resolveActiveSessionId(proj)).toBe('sid-active')
  })

  it('returns null when none is set', () => {
    expect(resolveActiveSessionId(createDefaultProjectState())).toBeNull()
  })
})

describe('inheritMiniAppToolsForNewSession', () => {
  it('is a no-op when previousSid is null/undefined', async () => {
    await inheritMiniAppToolsForNewSession('/p1', null)
    expect(mockMiniAppAuthorize).not.toHaveBeenCalled()
  })

  it('is a no-op when the chat-store does not yet have a new active session id', async () => {
    await inheritMiniAppToolsForNewSession('/no-project', 'sid-old')
    expect(mockMiniAppAuthorize).not.toHaveBeenCalled()
  })

  it("is a no-op when the active session id hasn't moved", async () => {
    const proj = createDefaultProjectState()
    proj._activeSessionId = 'sid-same'
    useChatStore.setState({ projectSessions: { '/p1': proj } })
    await inheritMiniAppToolsForNewSession('/p1', 'sid-same')
    expect(mockMiniAppAuthorize).not.toHaveBeenCalled()
  })

  it('is a no-op when no open mini-apps were held by the previous session', async () => {
    const proj = createDefaultProjectState()
    proj._activeSessionId = 'sid-new'
    useChatStore.setState({ projectSessions: { '/p1': proj } })
    await inheritMiniAppToolsForNewSession('/p1', 'sid-old')
    expect(mockMiniAppAuthorize).not.toHaveBeenCalled()
  })

  it('authorizes the new sid for every app held by the previous sid and extends holderSessions', async () => {
    const proj = createDefaultProjectState()
    proj._activeSessionId = 'sid-new'
    useChatStore.setState({ projectSessions: { '/p1': proj } })
    mockMiniAppOpenApps['key-a'] = { projectDir: '/p1', entry: { id: 'app-a' }, holderSessions: new Set(['sid-old']) }
    mockMiniAppOpenApps['key-b'] = { projectDir: '/p1', entry: { id: 'app-b' }, holderSessions: new Set(['sid-old']) }
    mockMiniAppOpenApps['unrelated'] = { projectDir: '/other', entry: { id: 'app-x' }, holderSessions: new Set(['sid-old']) }

    await inheritMiniAppToolsForNewSession('/p1', 'sid-old')

    expect(mockMiniAppAuthorize).toHaveBeenCalledWith(['app-a', 'app-b'], '/p1', 'sid-new')
    // The miniapp setState callback returned a fresh openApps map; the entries
    // for the matching apps are brand-new objects with extended holderSessions.
    const newOpen = mockMiniAppStoreState.openApps
    expect(newOpen['key-a'].holderSessions.has('sid-new')).toBe(true)
    expect(newOpen['key-b'].holderSessions.has('sid-new')).toBe(true)
    // The unrelated app entry was carried through verbatim.
    expect(newOpen['unrelated'].holderSessions.has('sid-new')).toBe(false)
  })

  it('swallows authorize() errors without throwing', async () => {
    mockMiniAppAuthorize.mockRejectedValueOnce(new Error('boom'))
    const proj = createDefaultProjectState()
    proj._activeSessionId = 'sid-new'
    useChatStore.setState({ projectSessions: { '/p1': proj } })
    mockMiniAppOpenApps['key-a'] = { projectDir: '/p1', entry: { id: 'app-a' }, holderSessions: new Set(['sid-old']) }

    await expect(inheritMiniAppToolsForNewSession('/p1', 'sid-old')).resolves.toBeUndefined()
  })
})
