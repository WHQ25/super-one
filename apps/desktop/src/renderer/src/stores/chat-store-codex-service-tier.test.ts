/** @vitest-environment jsdom */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { AgentEvent, ChatMessage, ModelOption } from '@superone/shared/agent-types'

const localStorageState = new Map<string, string>()
const mockLocalStorage = {
  getItem: vi.fn((key: string) => localStorageState.get(key) ?? null),
  setItem: vi.fn((key: string, value: string) => { localStorageState.set(key, value) }),
  removeItem: vi.fn((key: string) => { localStorageState.delete(key) }),
  clear: vi.fn(() => { localStorageState.clear() }),
}

vi.mock('./app', () => ({
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

const mockWindowAgent = {
  parkSession: vi.fn().mockResolvedValue(undefined),
  parkDraftSession: vi.fn().mockResolvedValue(undefined),
  activateSession: vi.fn().mockResolvedValue(undefined),
  broadcastSessionSetting: vi.fn().mockResolvedValue(undefined),
  setSessionSettings: vi.fn().mockResolvedValue(undefined),
  prewarm: vi.fn().mockResolvedValue(undefined),
}

const mockWindowApp = {
  createSession: vi.fn().mockResolvedValue(undefined),
  saveSessionState: vi.fn().mockResolvedValue(undefined),
  loadSessionState: vi.fn().mockResolvedValue(null),
  worktreeExists: vi.fn().mockResolvedValue(true),
  resumeSession: vi.fn().mockResolvedValue(undefined),
  codexListModels: vi.fn().mockResolvedValue([]),
  codexListSkills: vi.fn().mockResolvedValue([]),
  codexCollaborationModeChange: vi.fn().mockResolvedValue(undefined),
  getAppSettings: vi.fn().mockResolvedValue({
    analyticsEnabled: true,
    agentPreference: {
      claude: { defaultModel: '', defaultEffort: '', defaultPermissionMode: '', defaultSandboxMode: '' },
      codex: { defaultModel: '', defaultReasoningEffort: '', defaultPermissionPreset: '' },
    },
  }),
  trace: vi.fn(),
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

const { useChatStore, createDefaultPerSessionState, createDefaultProjectState } = await import('./chat')

const PATH = '/proj'
const SID_A = 'sid-a'
const SID_B = 'sid-b'

const FAST_MODEL: ModelOption = {
  id: 'gpt-5.4-codex',
  name: 'gpt-5.4-codex',
  description: '',
  serviceTiers: [{ id: 'priority', name: 'Fast', description: 'lower latency' }],
} as ModelOption

function msg(id: string): ChatMessage {
  return { id, role: 'user', status: 'complete', content: [{ type: 'text', text: 'hi' }], createdAt: new Date().toISOString(), providerId: 'codex' }
}

function seed() {
  useChatStore.setState({
    activeProject: PATH,
    projectSessions: {
      [PATH]: {
        ...createDefaultProjectState(),
        codexModels: [FAST_MODEL],
        _activeSessionId: SID_A,
        _sessions: {
          [SID_A]: {
            ...createDefaultPerSessionState(),
            sessionProvider: 'codex',
            preferredProvider: 'codex',
            selectedCodexModel: FAST_MODEL.id,
            codexModelUserChosen: true,
            selectedCodexServiceTier: 'priority',
            messages: [msg('m1')],
            _historyHydrated: true,
          },
          [SID_B]: {
            ...createDefaultPerSessionState(),
            sessionProvider: 'codex',
            preferredProvider: 'codex',
            selectedCodexModel: FAST_MODEL.id,
            codexModelUserChosen: true,
            messages: [msg('m2')],
            _historyHydrated: true,
          },
        },
      },
    },
  })
}

function tierOf(sid: string) {
  return useChatStore.getState().projectSessions[PATH]!._sessions[sid]!.selectedCodexServiceTier
}

beforeEach(() => {
  localStorageState.clear()
  vi.clearAllMocks()
  mockWindowApp.loadSessionState.mockResolvedValue(null)
  seed()
})

describe('codex Fast (service tier) across session switches', () => {
  it('keeps Fast when switching away and back (both sessions warm)', async () => {
    await useChatStore.getState().switchSession(SID_B)
    await useChatStore.getState().switchSession(SID_A)
    expect(tierOf(SID_A)).toBe('priority')
  })

  it('keeps Fast when the codex catalog reloads on switch', async () => {
    mockWindowApp.codexListModels.mockResolvedValue([FAST_MODEL])
    await useChatStore.getState().switchSession(SID_B)
    await useChatStore.getState().loadCodexModels(PATH, null, true)
    await useChatStore.getState().switchSession(SID_A)
    await useChatStore.getState().loadCodexModels(PATH, null, true)
    expect(tierOf(SID_A)).toBe('priority')
  })

  it('restores Fast when the session is re-opened cold from the DB', async () => {
    // Drop SID_A from the renderer cache: this is what a fresh window / cold open sees.
    const proj = useChatStore.getState().projectSessions[PATH]!
    useChatStore.setState({
      projectSessions: {
        [PATH]: { ...proj, _activeSessionId: SID_B, _sessions: { [SID_B]: proj._sessions[SID_B]! } },
      },
    })
    mockWindowApp.loadSessionState.mockResolvedValue({
      messages: [msg('m1')],
      totalCostUsd: 0,
      contextTokens: 0,
      gitBranch: null,
      provider: 'codex',
      selectedModel: FAST_MODEL.id,
      selectedEffort: null,
      codexServiceTier: 'priority',
      title: 'A',
    })
    await useChatStore.getState().switchSession(SID_A)
    expect(tierOf(SID_A)).toBe('priority')
  })

  // A patch that carries the key at all is main saying "this session's Fast is X".
  // Main only speaks when it knows (see Session's uiSettings seeding), so an
  // explicit null here is the user having turned Fast off and must be honoured.
  it('honours an explicit Fast-off from main', () => {
    useChatStore.getState().handleAgentEvent({
      type: 'agent_setting_change',
      sessionId: SID_A,
      projectPath: PATH,
      patch: { selectedModel: FAST_MODEL.id, selectedCodexServiceTier: null },
    } as AgentEvent)
    expect(tierOf(SID_A)).toBeNull()
  })

  it('keeps a live Fast pick when main replays a patch that omits the tier', () => {
    useChatStore.getState().handleAgentEvent({
      type: 'agent_setting_change',
      sessionId: SID_A,
      projectPath: PATH,
      patch: { selectedModel: FAST_MODEL.id },
    } as AgentEvent)
    expect(tierOf(SID_A)).toBe('priority')
  })
})
