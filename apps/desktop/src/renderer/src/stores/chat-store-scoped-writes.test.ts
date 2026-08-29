/** @vitest-environment jsdom */

/**
 * Every per-session store action must land on the session it was asked about,
 * not on the project's active one.
 *
 * The chat surface exists once per pane — a mosaic tile, the side chat docked in
 * the activity panel — and reads through the scope-aware `useActiveSession`. An
 * action that resolves `_activeSessionId` instead reads one session and writes
 * another. For settings that means a side chat's model change re-configures the
 * conversation it forked from; for interaction replies it is worse, because the
 * reply is matched against the wrong session's pending list, never delivered,
 * and the pane's turn blocks forever.
 *
 * This file pins the whole matrix. It is deliberately separate from
 * `chat-store-slices.test.ts`, which tests what each action *does*; here the
 * only question is *where it lands*.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { ModelOption } from '@superone/shared/agent-types'

const mockLocalStorage = {
  getItem: vi.fn().mockReturnValue(null),
  setItem: vi.fn(),
  removeItem: vi.fn(),
  clear: vi.fn(),
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
      navigateTo: vi.fn(),
    }),
  },
}))

vi.mock('./activity-view-state', () => ({
  useActivityViewStateStore: { getState: () => ({ clearForSession: vi.fn() }) },
}))

const mockWindowAgent = {
  prewarm: vi.fn().mockResolvedValue(undefined),
  setSessionSettings: vi.fn().mockResolvedValue(undefined),
  broadcastSessionSetting: vi.fn().mockResolvedValue(undefined),
  setPermissionMode: vi.fn().mockResolvedValue(true),
  setSandboxMode: vi.fn().mockResolvedValue({ enabled: false, autoAllowBash: false }),
  setSessionApiProvider: vi.fn().mockResolvedValue(undefined),
  respondToPermission: vi.fn().mockResolvedValue(true),
  answerQuestion: vi.fn().mockResolvedValue(undefined),
  dismissQuestion: vi.fn().mockResolvedValue(undefined),
  respondToPlanApproval: vi.fn().mockResolvedValue(undefined),
  interrupt: vi.fn().mockResolvedValue(true),
  parkSession: vi.fn().mockResolvedValue(undefined),
}

const mockWindowApp = {
  trace: vi.fn(),
  setFastMode: vi.fn().mockResolvedValue(undefined),
  codexCollaborationModeChange: vi.fn(),
  updateCursorBaseConfig: vi.fn().mockResolvedValue(undefined),
  getCursorBaseConfig: vi.fn().mockResolvedValue({}),
  getAppSettings: vi.fn().mockResolvedValue({ analyticsEnabled: true, agentPreference: {} }),
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

const { useChatStore, getActiveSessionView } = await import('./chat')

const PATH = '/test-project'
const ACTIVE = 'session-active'
const PANE = 'session-pane'
const TARGET = { projectPath: PATH, sessionId: PANE }

const opus: ModelOption = { id: 'opus-4-8', name: 'Opus 4.8', description: '', supportsEffort: true, supportedEffortLevels: ['low', 'high'], supportsAutoMode: true }
const sonnet: ModelOption = { id: 'sonnet-4-6', name: 'Sonnet 4.6', description: '', supportsEffort: false, supportsAutoMode: false }
const codexModel = {
  id: 'gpt-5-codex',
  name: 'GPT-5 Codex',
  description: '',
  supportedReasoningEfforts: [{ value: 'low' }, { value: 'high' }],
  defaultReasoningEffort: 'low',
} as unknown as ModelOption

function seed(overrides: Record<string, unknown> = {}) {
  useChatStore.setState({ projectSessions: {}, activeProject: null })
  useChatStore.getState().ensureSession(PATH)
  useChatStore.setState({ activeProject: PATH })
  const project = useChatStore.getState().projectSessions[PATH]!
  const active = project._activeSessionId!
  const base = { ...project._sessions[active]!, ...overrides }
  useChatStore.setState({
    projectSessions: {
      ...useChatStore.getState().projectSessions,
      [PATH]: {
        ...project,
        _activeSessionId: ACTIVE,
        codexModels: [codexModel],
        _sessions: { [ACTIVE]: { ...base }, [PANE]: { ...base } },
      },
    },
  })
  useChatStore.getState().setHarnessResources('claude', {
    models: [opus, sonnet], account: {} as never, slashCommands: [], skills: [], commands: [], agents: [], outputStyles: [],
  })
}

const sessionOf = (sid: string) => useChatStore.getState().projectSessions[PATH]!._sessions[sid]!

/** What a pane actually renders: the session merged over the project. */
const viewOf = (sid: string) => getActiveSessionView({ projectPath: PATH, sessionId: sid })

beforeEach(() => {
  vi.clearAllMocks()
})

describe('harness setting writers: the pane is the target, not the active session', () => {
  /**
   * One row per setter: run it against the pane, then assert the field moved on
   * the pane and stayed put on the active session. A sampled subset is how the
   * original bug survived — nine of these were unscoped and only the model
   * picker was ever exercised.
   */
  const cases: Array<{
    name: string
    provider?: string
    seed?: Record<string, unknown>
    run: () => void
    read: (sid: string) => unknown
    expected: unknown
  }> = [
    { name: 'setSelectedModel', run: () => useChatStore.getState().setSelectedModel('opus-4-8', TARGET), read: (s) => sessionOf(s).selectedModel, expected: 'opus-4-8' },
    { name: 'setSelectedEffort', run: () => useChatStore.getState().setSelectedEffort('high', TARGET), read: (s) => sessionOf(s).selectedEffort, expected: 'high' },
    { name: 'setCursorModelParams', provider: 'cursor', seed: { selectedModel: 'cursor-model' }, run: () => useChatStore.getState().setCursorModelParams({ a: '1' }, TARGET), read: (s) => sessionOf(s).cursorModelParams, expected: { a: '1' } },
    { name: 'setCursorModelParam', provider: 'cursor', seed: { selectedModel: 'cursor-model' }, run: () => useChatStore.getState().setCursorModelParam('a', '2', TARGET), read: (s) => sessionOf(s).cursorModelParams, expected: { a: '2' } },
    { name: 'setSelectedAcpMode', provider: 'acp', run: () => useChatStore.getState().setSelectedAcpMode('plan', TARGET), read: (s) => sessionOf(s).selectedAcpModeId, expected: 'plan' },
    { name: 'setSelectedCodexModel', provider: 'codex', run: () => useChatStore.getState().setSelectedCodexModel('gpt-5-codex', TARGET), read: (s) => sessionOf(s).selectedCodexModel, expected: 'gpt-5-codex' },
    { name: 'setSelectedCodexReasoningEffort', provider: 'codex', seed: { selectedCodexModel: 'gpt-5-codex' }, run: () => useChatStore.getState().setSelectedCodexReasoningEffort('high', TARGET), read: (s) => sessionOf(s).selectedCodexReasoningEffort, expected: 'high' },
    { name: 'setSelectedCodexPermissionPreset', provider: 'codex', run: () => useChatStore.getState().setSelectedCodexPermissionPreset('full-access', TARGET), read: (s) => sessionOf(s).selectedCodexPermissionPreset, expected: 'full-access' },
    { name: 'setSelectedCodexCollaborationMode', provider: 'codex', run: () => useChatStore.getState().setSelectedCodexCollaborationMode('plan', TARGET), read: (s) => sessionOf(s).selectedCodexCollaborationMode, expected: 'plan' },
    { name: 'setOpenCodeAgentId', provider: 'opencode', run: () => useChatStore.getState().setOpenCodeAgentId('build', TARGET), read: (s) => sessionOf(s).openCodeAgentId, expected: 'build' },
    { name: 'setDshPreset', provider: 'dsh', run: () => useChatStore.getState().setDshPreset('research', TARGET), read: (s) => sessionOf(s).dshPreset, expected: 'research' },
  ]

  for (const c of cases) {
    it(`${c.name} writes the scoped pane only`, () => {
      seed({
        ...(c.provider ? { sessionProvider: c.provider, preferredProvider: c.provider } : {}),
        ...c.seed,
      })
      const before = c.read(ACTIVE)

      c.run()

      expect(c.read(PANE)).toEqual(c.expected)
      expect(c.read(ACTIVE)).toEqual(before)
    })
  }

  it('setSelectedCodexServiceTier moves the pane off its tier and leaves the active one on it', () => {
    seed({
      sessionProvider: 'codex',
      preferredProvider: 'codex',
      selectedCodexModel: 'gpt-5-codex',
      // Both panes start on a real tier, so clearing one proves isolation. Writing
      // the default over the default would pass with no scoping at all.
      selectedCodexServiceTier: 'priority',
    })

    useChatStore.getState().setSelectedCodexServiceTier(null, TARGET)

    expect(sessionOf(PANE).selectedCodexServiceTier).toBeNull()
    expect(sessionOf(ACTIVE).selectedCodexServiceTier).toBe('priority')
  })

  it('addresses the main process by the scoped session id, not the active one', () => {
    seed()
    useChatStore.getState().setSelectedModel('opus-4-8', TARGET)
    expect(mockWindowAgent.setSessionSettings).toHaveBeenCalledWith(PATH, expect.anything(), PANE)
  })

  it('leaves the session id off entirely when unscoped, so drafts keep resolving on the main side', () => {
    seed()
    useChatStore.getState().setSelectedModel('opus-4-8')
    expect(mockWindowAgent.setSessionSettings).toHaveBeenCalledWith(PATH, expect.anything(), undefined)
  })
})

describe('session policy writers: the pane is the target', () => {
  it('setPermissionMode drives the scoped session over IPC and stores it there', async () => {
    seed()
    await useChatStore.getState().setPermissionMode('acceptEdits', TARGET)
    expect(mockWindowAgent.setPermissionMode).toHaveBeenCalledWith(PATH, PANE, 'acceptEdits')
    expect(sessionOf(PANE).permissionMode).toBe('acceptEdits')
    expect(sessionOf(ACTIVE).permissionMode).not.toBe('acceptEdits')
  })

  it('setSandboxMode addresses the scoped session so a pane cannot re-sandbox the main chat runtime', async () => {
    seed()
    await useChatStore.getState().setSandboxMode('on', TARGET)
    expect(mockWindowAgent.setSandboxMode).toHaveBeenCalledWith(PATH, 'on', PANE)
  })

  // A sandbox badge is a safety claim. Routing the IPC correctly is not enough:
  // if the answer is still written to the one project-level field, the main chat
  // repaints as sandboxed while its runtime was never touched.
  it('records a scoped sandbox change as this pane only, leaving the other pane showing the truth', async () => {
    seed()
    // Compared against the project baseline rather than a literal: the default
    // comes from the harness sandbox capability, so hardcoding one would make
    // this pass or fail for reasons that have nothing to do with scoping.
    const baseline = viewOf(ACTIVE).sandboxInfo
    const scoped = { enabled: !baseline.enabled, autoAllowBash: !baseline.autoAllowBash }
    mockWindowAgent.setSandboxMode.mockResolvedValueOnce(scoped)

    await useChatStore.getState().setSandboxMode('on', TARGET)

    expect(viewOf(PANE).sandboxInfo).toEqual(scoped)
    expect(viewOf(ACTIVE).sandboxInfo).toEqual(baseline)
  })

  it('still writes the project value when unscoped, so every ordinary pane follows it', async () => {
    seed()
    const baseline = viewOf(ACTIVE).sandboxInfo
    const next = { enabled: !baseline.enabled, autoAllowBash: !baseline.autoAllowBash }
    mockWindowAgent.setSandboxMode.mockResolvedValueOnce(next)

    await useChatStore.getState().setSandboxMode('auto')

    expect(viewOf(ACTIVE).sandboxInfo).toEqual(next)
    expect(viewOf(PANE).sandboxInfo).toEqual(next)
  })

  // An unscoped write went to the project's ACTIVE session, so it is a fact about
  // that session too. Recording only the project value would leave the session's
  // older record shadowing what was just written.
  it("overwrites the active session's stale record when the project sandbox is set unscoped", async () => {
    seed()
    const baseline = viewOf(ACTIVE).sandboxInfo
    const stale = { enabled: !baseline.enabled, autoAllowBash: !baseline.autoAllowBash }
    useChatStore.getState().handleAgentEvent({
      type: 'agent_setting_change', projectPath: PATH, sessionId: ACTIVE, patch: { sandboxInfo: stale },
    } as never)
    expect(sessionOf(ACTIVE).sandboxInfo).toEqual(stale)

    mockWindowAgent.setSandboxMode.mockResolvedValueOnce(baseline)
    await useChatStore.getState().setSandboxMode('off')

    expect(sessionOf(ACTIVE).sandboxInfo).toEqual(baseline)
    expect(viewOf(ACTIVE).sandboxInfo).toEqual(baseline)
  })

  it("a side chat's own sandbox report does not repaint the project badge", () => {
    seed()
    const baseline = viewOf(ACTIVE).sandboxInfo
    const reported = { enabled: !baseline.enabled, autoAllowBash: !baseline.autoAllowBash }

    useChatStore.getState().handleAgentEvent({
      type: 'agent_setting_change',
      projectPath: PATH,
      sessionId: PANE,
      patch: { sandboxInfo: reported },
    } as never)

    expect(viewOf(PANE).sandboxInfo).toEqual(reported)
    expect(viewOf(ACTIVE).sandboxInfo).toEqual(baseline)
  })

  it('setSessionApiProviderId switches the scoped session, leaving the active one on its provider', async () => {
    seed({ apiProviderId: 'provider-a' })
    await useChatStore.getState().setSessionApiProviderId('provider-b', TARGET)
    expect(mockWindowAgent.setSessionApiProvider).toHaveBeenCalledWith(PANE, 'provider-b')
    expect(sessionOf(PANE).apiProviderId).toBe('provider-b')
    expect(sessionOf(ACTIVE).apiProviderId).toBe('provider-a')
  })

  it('togglePlanModeShortcut reads and writes the scoped session', () => {
    seed({ sessionProvider: 'codex', preferredProvider: 'codex', selectedCodexCollaborationMode: 'default' })
    useChatStore.getState().togglePlanModeShortcut(TARGET)
    expect(sessionOf(PANE).selectedCodexCollaborationMode).toBe('plan')
    expect(sessionOf(ACTIVE).selectedCodexCollaborationMode).toBe('default')
  })
})

describe('interaction replies: answering a pane must reach that pane', () => {
  const permission = { requestId: 'req-1', toolName: 'Bash', input: {} } as never

  it('respondToPermission matches the scoped pending list and acks the scoped session', async () => {
    seed()
    useChatStore.setState((s) => ({
      projectSessions: {
        ...s.projectSessions,
        [PATH]: {
          ...s.projectSessions[PATH]!,
          _sessions: {
            ...s.projectSessions[PATH]!._sessions,
            [PANE]: { ...sessionOf(PANE), pendingPermissions: [permission] },
          },
        },
      },
    }))

    const handled = await useChatStore.getState().respondToPermission('req-1', true, undefined, undefined, undefined, undefined, undefined, TARGET)

    expect(handled).toBe(true)
    expect(mockWindowAgent.respondToPermission).toHaveBeenCalledWith(PANE, 'req-1', true, undefined, undefined, undefined, undefined, undefined)
    expect(sessionOf(PANE).pendingPermissions).toEqual([])
  })

  it('returns false without an ack when the request belongs to a session that is not the target', async () => {
    seed()
    useChatStore.setState((s) => ({
      projectSessions: {
        ...s.projectSessions,
        [PATH]: {
          ...s.projectSessions[PATH]!,
          _sessions: {
            ...s.projectSessions[PATH]!._sessions,
            [ACTIVE]: { ...sessionOf(ACTIVE), pendingPermissions: [permission] },
          },
        },
      },
    }))

    const handled = await useChatStore.getState().respondToPermission('req-1', true, undefined, undefined, undefined, undefined, undefined, TARGET)

    expect(handled).toBe(false)
    expect(mockWindowAgent.respondToPermission).not.toHaveBeenCalled()
  })

  it('answerQuestion and dismissQuestion address the scoped session', () => {
    seed()
    useChatStore.getState().answerQuestion('q-1', { a: 'b' }, undefined, TARGET)
    expect(mockWindowAgent.answerQuestion).toHaveBeenCalledWith(PANE, 'q-1', { a: 'b' }, undefined)

    useChatStore.getState().dismissQuestion('q-2', TARGET)
    expect(mockWindowAgent.dismissQuestion).toHaveBeenCalledWith(PANE, 'q-2')
  })

  it('respondToPlanApproval acks the scoped session and clears only its prompt', () => {
    seed({ pendingPlanApproval: { requestId: 'plan-1' } })
    useChatStore.getState().respondToPlanApproval('plan-1', true, undefined, 'default', TARGET)
    expect(mockWindowAgent.respondToPlanApproval).toHaveBeenCalledWith(PANE, 'plan-1', true, undefined)
    expect(sessionOf(PANE).pendingPlanApproval).toBeNull()
    expect(sessionOf(ACTIVE).pendingPlanApproval).not.toBeNull()
  })

  it('interrupt stops the scoped session, not whichever one is in the foreground', async () => {
    seed({ status: 'streaming', awaitingAssistantReply: true })
    await useChatStore.getState().interrupt(TARGET)
    expect(mockWindowAgent.interrupt).toHaveBeenCalledWith(PANE)
    expect(sessionOf(PANE).awaitingAssistantReply).toBe(false)
    expect(sessionOf(ACTIVE).awaitingAssistantReply).toBe(true)
  })
})
