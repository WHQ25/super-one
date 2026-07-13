/** @vitest-environment jsdom */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { AccountInfo, ClaudeResources, CodexResources, ModelOption } from '@superone/shared/agent-types'

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
      sandboxCapability: { supportLevel: 'always', platform: 'darwin', defaultMode: 'on' },
      sandboxProbe: null,
      probeSandbox: vi.fn(async () => ({ ok: true as const })),
    }),
  },
}))

vi.mock('@/stores/activity-view-state', () => ({
  useActivityViewStateStore: { getState: () => ({ clearForSession: vi.fn(), seedFromCurrent: vi.fn() }) },
}))

vi.stubGlobal('window', {
  agent: new Proxy({}, { get: () => () => Promise.resolve(undefined) }),
  app: {
    trace: vi.fn(),
    getAppSettings: vi.fn().mockResolvedValue({
      analyticsEnabled: true,
      agentPreference: {
        claude: { defaultModel: '', defaultEffort: '', defaultPermissionMode: '', defaultSandboxMode: '' },
        codex: { defaultModel: '', defaultReasoningEffort: '' },
      },
    }),
  },
  localStorage: mockLocalStorage,
  dispatchEvent: () => true,
  addEventListener: () => {},
  removeEventListener: () => {},
})
vi.stubGlobal('localStorage', mockLocalStorage)

// Load the chat-store package as an entry point first so the full module graph
// (selectors + defaults + types) is evaluated in dependency order before we
// touch agent-defaults directly. Otherwise the cycle agent-defaults → index →
// selectors → defaults runs into a TDZ on SUBAGENT_COLOR_POOL_SIZE.
const chatStore = await import('../index')
const { useChatStore } = chatStore
const { defaultPrefsCache } = await import('./prefs-cache')
const {
  _computeClaudeDefaultPatch,
  _computeCodexDefaultPatch,
  _reapplyAgentDefaultsToSessions,
  applyDefaultModel,
  applySessionAgentDefaults,
  resolveDefaultClaudeEffort,
  resolveDefaultClaudeModel,
} = await import('./agent-defaults')
const { createDefaultPerSessionState, createDefaultProjectState } = await import('../defaults')

const opus: ModelOption = {
  id: 'opus-4-8',
  name: 'Opus 4.8',
  description: '',
  supportedEffortLevels: ['low', 'medium', 'high', 'xhigh'],
  supportsAutoMode: true,
}
const sonnet: ModelOption = {
  id: 'sonnet-4-6',
  name: 'Sonnet 4.6',
  description: '',
  supportedEffortLevels: ['low', 'medium'],
}
const haiku: ModelOption = {
  id: 'haiku-4-5',
  name: 'Haiku 4.5',
  description: '',
}

const codexHigh: ModelOption = {
  id: 'gpt-5-high',
  name: 'GPT-5 High',
  description: '',
  isDefault: true,
  supportedReasoningEfforts: [{ value: 'high', description: 'High' }, { value: 'medium', description: 'Med' }],
  defaultReasoningEffort: 'high',
}

beforeEach(() => {
  defaultPrefsCache.claudeSelection = null
  defaultPrefsCache.codexSelection = null
  defaultPrefsCache.permissionMode = null
  defaultPrefsCache.sandboxMode = null
  useChatStore.setState({
    projectSessions: {},
    activeProject: null,
    remoteSessions: {},
    _previousFocusedSession: null,
    harnessResources: { claude: null, codex: null, acp: null },
    initializedHarnesses: new Set(),
  })
})

describe('resolveDefaultClaudeModel', () => {
  it('returns the model matching the cached preferred id when present', () => {
    defaultPrefsCache.claudeSelection = { modelId: 'sonnet-4-6' }
    expect(resolveDefaultClaudeModel([opus, sonnet, haiku])?.id).toBe('sonnet-4-6')
  })

  it('falls through to models[0] when the preferred id is not in the list', () => {
    defaultPrefsCache.claudeSelection = { modelId: 'ghost' }
    expect(resolveDefaultClaudeModel([opus, sonnet])?.id).toBe('opus-4-8')
  })

  it('returns models[0] when no claudeSelection is cached', () => {
    expect(resolveDefaultClaudeModel([opus, sonnet])?.id).toBe('opus-4-8')
  })

  it('returns undefined for an empty model list', () => {
    expect(resolveDefaultClaudeModel([])).toBeUndefined()
  })
})

describe('resolveDefaultClaudeEffort', () => {
  it('returns the cached preferred effort when the model supports it', () => {
    defaultPrefsCache.claudeSelection = { modelId: 'opus-4-8', effort: 'high' }
    expect(resolveDefaultClaudeEffort(opus)).toBe('high')
  })

  it('falls back to the model default when the cached effort is unsupported', () => {
    defaultPrefsCache.claudeSelection = { modelId: 'sonnet-4-6', effort: 'xhigh' }
    // sonnet only supports low/medium; getDefaultEffortForModel prefers medium when available
    expect(resolveDefaultClaudeEffort(sonnet)).toBe('medium')
  })

  it('returns undefined when the model has no supported effort levels', () => {
    expect(resolveDefaultClaudeEffort(haiku)).toBeUndefined()
  })

  it('returns undefined for an undefined model', () => {
    expect(resolveDefaultClaudeEffort(undefined)).toBeUndefined()
  })
})

describe('applyDefaultModel', () => {
  it('mutates the session with the resolved model id + effort', () => {
    const session = createDefaultPerSessionState()
    applyDefaultModel(session, [opus, sonnet])
    expect(session.selectedModel).toBe('opus-4-8')
    expect(session.selectedEffort).toBe('high') // opus prefers high (default effort)
  })

  it('only writes selectedEffort when the model exposes one', () => {
    const session = createDefaultPerSessionState()
    session.selectedEffort = 'medium'
    applyDefaultModel(session, [haiku])
    expect(session.selectedModel).toBe('haiku-4-5')
    // haiku has no supportedEffortLevels → effort stays untouched
    expect(session.selectedEffort).toBe('medium')
  })

  it('is a no-op when no models are available', () => {
    const session = createDefaultPerSessionState()
    const before = { ...session }
    applyDefaultModel(session, [])
    expect(session.selectedModel).toBe(before.selectedModel)
    expect(session.selectedEffort).toBe(before.selectedEffort)
  })
})

describe('applySessionAgentDefaults', () => {
  it('returns Codex selection patch when the session is a Codex session', () => {
    const session = createDefaultPerSessionState()
    session.sessionProvider = 'codex'
    session.selectedCodexModel = ''
    const project = createDefaultProjectState()
    project.codexModels = [codexHigh]
    const patch = applySessionAgentDefaults(session, project, [])
    expect(patch.selectedCodexModel).toBe('gpt-5-high')
    expect(patch.selectedCodexReasoningEffort).toBe('high')
  })

  it('returns Claude default patch when session.selectedModel is empty (claude provider)', () => {
    const session = createDefaultPerSessionState()
    session.sessionProvider = 'claude'
    session.selectedModel = ''
    const project = createDefaultProjectState()
    const patch = applySessionAgentDefaults(session, project, [opus])
    expect(patch.selectedModel).toBe('opus-4-8')
    expect(patch.selectedEffort).toBe('high')
  })

  it('returns {} when the Claude session already has a selectedModel', () => {
    const session = createDefaultPerSessionState()
    session.sessionProvider = 'claude'
    session.selectedModel = 'opus-4-8'
    const project = createDefaultProjectState()
    expect(applySessionAgentDefaults(session, project, [opus])).toEqual({})
  })
})

describe('_computeClaudeDefaultPatch', () => {
  it('returns null when both model and effort are already user-chosen', () => {
    const session = createDefaultPerSessionState()
    session.modelUserChosen = true
    session.effortUserChosen = true
    expect(_computeClaudeDefaultPatch(session, [opus])).toBeNull()
  })

  it('returns null when no models are available', () => {
    const session = createDefaultPerSessionState()
    expect(_computeClaudeDefaultPatch(session, [])).toBeNull()
  })

  it('proposes both model + effort when neither is user-chosen and they differ from current', () => {
    const session = createDefaultPerSessionState()
    session.selectedModel = ''
    session.selectedEffort = undefined
    const patch = _computeClaudeDefaultPatch(session, [opus])
    expect(patch).toEqual({ selectedModel: 'opus-4-8', selectedEffort: 'high' })
  })

  it('skips selectedModel field when the resolved model matches current', () => {
    const session = createDefaultPerSessionState()
    session.selectedModel = 'opus-4-8'
    session.selectedEffort = undefined
    const patch = _computeClaudeDefaultPatch(session, [opus])
    expect(patch).toEqual({ selectedEffort: 'high' })
  })

  it('only proposes effort when model is user-chosen but effort is not', () => {
    const session = createDefaultPerSessionState()
    session.modelUserChosen = true
    session.selectedModel = 'sonnet-4-6'
    session.effortUserChosen = false
    session.selectedEffort = undefined
    const patch = _computeClaudeDefaultPatch(session, [opus, sonnet])
    expect(patch).toEqual({ selectedEffort: 'medium' })
  })

  it('returns null when nothing actually changes', () => {
    const session = createDefaultPerSessionState()
    session.selectedModel = 'opus-4-8'
    session.selectedEffort = 'high'
    expect(_computeClaudeDefaultPatch(session, [opus])).toBeNull()
  })
})

describe('_computeCodexDefaultPatch', () => {
  it('returns null when both fields are already user-chosen', () => {
    const session = createDefaultPerSessionState()
    session.codexModelUserChosen = true
    session.codexReasoningEffortUserChosen = true
    expect(_computeCodexDefaultPatch(session, [codexHigh])).toBeNull()
  })

  it('returns null when no models are available', () => {
    const session = createDefaultPerSessionState()
    expect(_computeCodexDefaultPatch(session, [])).toBeNull()
  })

  it('proposes both fields when neither is user-chosen', () => {
    const session = createDefaultPerSessionState()
    session.selectedCodexModel = ''
    const patch = _computeCodexDefaultPatch(session, [codexHigh])
    expect(patch?.selectedCodexModel).toBe('gpt-5-high')
    expect(patch?.selectedCodexReasoningEffort).toBe('high')
  })

  it('skips model when current is already the default', () => {
    const session = createDefaultPerSessionState()
    session.selectedCodexModel = 'gpt-5-high'
    session.selectedCodexReasoningEffort = undefined
    const patch = _computeCodexDefaultPatch(session, [codexHigh])
    expect(patch?.selectedCodexModel).toBeUndefined()
    expect(patch?.selectedCodexReasoningEffort).toBe('high')
  })

  it('returns null when nothing changes', () => {
    const session = createDefaultPerSessionState()
    session.selectedCodexModel = 'gpt-5-high'
    session.selectedCodexReasoningEffort = 'high'
    expect(_computeCodexDefaultPatch(session, [codexHigh])).toBeNull()
  })
})

describe('_reapplyAgentDefaultsToSessions', () => {
  function seedProject(path: string, sessionPatch: Partial<ReturnType<typeof createDefaultPerSessionState>> = {}) {
    const proj = createDefaultProjectState()
    proj.codexModels = [codexHigh]
    const sid = 'sid-1'
    const sess = { ...createDefaultPerSessionState(), ...sessionPatch }
    proj._activeSessionId = sid
    proj._sessions = { [sid]: sess }
    useChatStore.setState((s) => ({
      projectSessions: { ...s.projectSessions, [path]: proj },
    }))
    return { sid, proj }
  }

  function setClaude(partial: Partial<ClaudeResources>) {
    useChatStore.getState().setHarnessResources('claude', {
      models: [],
      account: {} as AccountInfo,
      slashCommands: [],
      skills: [],
      commands: [],
      agents: [],
      outputStyles: [],
      ...partial,
    })
  }

  it("applies Claude defaults across every project's session when kind='claude'", () => {
    setClaude({ models: [opus] })
    seedProject('/p1', { selectedModel: '', selectedEffort: undefined })
    seedProject('/p2', { selectedModel: 'opus-4-8', selectedEffort: 'low' })

    _reapplyAgentDefaultsToSessions('claude')

    const p1 = useChatStore.getState().projectSessions['/p1']
    const p2 = useChatStore.getState().projectSessions['/p2']
    expect(p1._sessions['sid-1'].selectedModel).toBe('opus-4-8')
    expect(p1._sessions['sid-1'].selectedEffort).toBe('high')
    expect(p2._sessions['sid-1'].selectedModel).toBe('opus-4-8')
    expect(p2._sessions['sid-1'].selectedEffort).toBe('high')
  })

  it("applies Codex defaults when kind='codex'", () => {
    seedProject('/p1', { selectedCodexModel: '', selectedCodexReasoningEffort: undefined })

    _reapplyAgentDefaultsToSessions('codex')

    const p1 = useChatStore.getState().projectSessions['/p1']
    expect(p1._sessions['sid-1'].selectedCodexModel).toBe('gpt-5-high')
    expect(p1._sessions['sid-1'].selectedCodexReasoningEffort).toBe('high')
  })

  it('leaves projectSessions reference unchanged when nothing needs an update', () => {
    setClaude({ models: [opus] })
    seedProject('/p1', { selectedModel: 'opus-4-8', selectedEffort: 'xhigh', modelUserChosen: true, effortUserChosen: true })
    const before = useChatStore.getState().projectSessions

    _reapplyAgentDefaultsToSessions('claude')
    expect(useChatStore.getState().projectSessions).toBe(before)
  })

  it('only mutates the projects whose sessions actually changed', () => {
    setClaude({ models: [opus] })
    seedProject('/p-untouched', { selectedModel: 'opus-4-8', selectedEffort: 'xhigh', modelUserChosen: true, effortUserChosen: true })
    seedProject('/p-changes', { selectedModel: '', selectedEffort: undefined })
    const untouchedBefore = useChatStore.getState().projectSessions['/p-untouched']

    _reapplyAgentDefaultsToSessions('claude')

    const after = useChatStore.getState().projectSessions
    expect(after['/p-untouched']).toBe(untouchedBefore)
    expect(after['/p-changes']._sessions['sid-1'].selectedModel).toBe('opus-4-8')
  })
})
