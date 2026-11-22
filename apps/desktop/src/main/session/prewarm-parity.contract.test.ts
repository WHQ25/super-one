/** @vitest-environment jsdom */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { AgentEvent, HarnessId, SendMessageRequest } from '@superone/shared/agent-types'
import { baseSessionProviderId } from '@superone/shared/session-provider-definitions'
import { parseSessionSettings } from '@superone/runtime/server/session-settings'
import { applyDesktopSessionSettings, desktopSendRequest } from '../node-host/desktop-session-mutations'
import { Session } from './session'
import type { BackendStartOptions, SessionBackend } from './types'

vi.mock('../logger', () => ({ default: { info: vi.fn(), warn: vi.fn(), debug: vi.fn(), error: vi.fn() } }))
vi.mock('../shell-path', () => ({ ensureShellPath: async () => {}, isShellPathReady: () => true }))
vi.mock('../sandbox-platform', async (original) => ({
  ...(await original<typeof import('../sandbox-platform')>()),
  getSandboxCapability: () => ({ supportLevel: 'always', platform: 'darwin', defaultMode: 'on' }),
}))
vi.mock('@/stores/app', () => ({
  useAppStore: {
    getState: () => ({
      experimentalRemoteNodesEnabled: false,
      getWorktreeState: () => ({ pendingBaseBranch: null }),
      setActiveWorktree: vi.fn(),
      clearWorktree: vi.fn().mockResolvedValue(undefined),
      clearWorktreeMirror: vi.fn(),
      sandboxCapability: null,
    }),
  },
}))
vi.mock('sonner', () => ({ toast: { error: vi.fn() } }))

interface BackendCapture {
  startOpts: BackendStartOptions | null
  lastSend: SendMessageRequest | null
  lastMode: string | null
  lastCodexSelection: { model?: string | null; reasoningEffort?: string | null; serviceTier?: string | null } | null
  permissionMode: string | null
}

let hostSession: Session | null = null
let hostCapture: BackendCapture | null = null

function createCapturingBackend(harness: HarnessId): { backend: SessionBackend; capture: BackendCapture } {
  const capture: BackendCapture = {
    startOpts: null,
    lastSend: null,
    lastMode: null,
    lastCodexSelection: null,
    permissionMode: null,
  }
  const backend: SessionBackend = {
    kind: harness,
    prewarm: vi.fn((opts: BackendStartOptions) => {
      capture.startOpts = opts
      capture.permissionMode = opts.permissionMode
    }),
    start: vi.fn(async (opts: BackendStartOptions) => {
      capture.startOpts = opts
      capture.permissionMode = opts.permissionMode
    }),
    rebuild: vi.fn(async (opts: BackendStartOptions) => {
      capture.startOpts = opts
      capture.permissionMode = opts.permissionMode
    }),
    send: vi.fn(async (request: SendMessageRequest) => {
      capture.lastSend = request
    }),
    setModel: vi.fn(async (model: string) => {
      if (capture.startOpts) capture.startOpts = { ...capture.startOpts, model }
    }),
    setSessionMode: vi.fn(async (modeId: string) => {
      capture.lastMode = modeId
    }),
    setCodexSelection: vi.fn(async (selection) => {
      capture.lastCodexSelection = { ...(capture.lastCodexSelection ?? {}), ...selection }
    }),
    setPermissionMode: vi.fn(async (mode: string) => {
      capture.permissionMode = mode
    }),
    getPendingInteractions: () => [],
    onEvent: () => () => {},
    onProviderSessionId: () => () => {},
    onPermissionModeApplied: () => () => {},
    interrupt: vi.fn(async () => {}),
    close: vi.fn(async () => {}),
    dispose: vi.fn(async () => {}),
  } as unknown as SessionBackend
  return { backend, capture }
}

function makeHostSession(harness: HarnessId, sid: string, defaults: { model?: string; effort?: SendMessageRequest['effort']; acpAgentId?: string | null }) {
  const { backend, capture } = createCapturingBackend(harness)
  const session = new Session({
    id: sid,
    projectPath: '/proj',
    cwd: '/proj',
    providerId: baseSessionProviderId(harness),
    harnessId: harness,
    backend,
    providerConfig: {},
    permissionMode: 'default',
    model: defaults.model,
    effort: defaults.effort,
    acpAgentId: defaults.acpAgentId ?? null,
  })
  hostSession = session
  hostCapture = capture
  return { session, capture }
}

const getLiveSnapshots = vi.fn(async () => {
  if (!hostSession) return []
  return [{
    sid: hostSession.id,
    projectPath: hostSession.projectPath,
    isActive: true,
    isStreaming: false,
    controlLease: null,
    permissionMode: hostSession.getCurrentPermissionMode(),
    sandboxInfo: hostSession.getCurrentSandboxInfo(),
    uiSettings: hostSession.getUiSettings(),
    snapshot: hostSession.snapshot,
    replayEvents: [] as AgentEvent[],
    pendingInteractions: [] as AgentEvent[],
  }]
})

vi.stubGlobal('window', {
  agent: {
    activateSession: vi.fn().mockResolvedValue(undefined),
    prewarm: vi.fn().mockResolvedValue(undefined),
    getLiveSnapshots,
  },
  app: {
    trace: vi.fn(),
    getAppSettings: vi.fn().mockResolvedValue({ agentPreference: {} }),
    saveSessionState: vi.fn().mockResolvedValue(undefined),
    listSessionsForFolder: vi.fn().mockResolvedValue([]),
  },
  environment: {
    listProjects: vi.fn().mockResolvedValue([{ projectId: 'p1', path: '/proj' }]),
    getSession: vi.fn(async (_conn: string, sid: string) =>
      hostSession && hostSession.id === sid
        ? { sessionId: hostSession.id, harnessId: hostSession.snapshot.harnessId }
        : null),
    createSession: vi.fn(async (_conn: string, input: { harnessId?: HarnessId; settings?: Record<string, unknown>; selections?: { sessionId?: string; acpAgentId?: string } }) => {
      const harness = input.harnessId ?? 'claude'
      const sid = input.selections?.sessionId ?? 'sid-1'
      const { session } = makeHostSession(harness, sid, { acpAgentId: input.selections?.acpAgentId ?? null })
      if (input.settings) {
        const cleaned = Object.fromEntries(Object.entries(input.settings).filter(([, v]) => v !== undefined))
        await applyDesktopSessionSettings(session, parseSessionSettings(cleaned))
      }
      return { sessionId: sid, title: null, lastActiveAt: '', messageCount: 0 }
    }),
    patchSessionSettings: vi.fn(async (_conn: string, sid: string, patch: Record<string, unknown>) => {
      if (!hostSession || hostSession.id !== sid) return null
      const cleaned = Object.fromEntries(Object.entries(patch).filter(([, v]) => v !== undefined))
      await applyDesktopSessionSettings(hostSession, parseSessionSettings(cleaned))
      return {}
    }),
    removeSession: vi.fn(async () => {
      if (hostSession) {
        await hostSession.dispose()
        hostSession = null
      }
    }),
  },
  dispatchEvent: vi.fn(),
  addEventListener: vi.fn(),
  removeEventListener: vi.fn(),
})

const { useChatStore } = await import('../../renderer/src/stores/chat-store/index')
const { createDefaultPerSessionState, createDefaultProjectState } = await import('../../renderer/src/stores/chat-store/defaults')
const { ensureHostSession, sessionTurnRequest } = await import('../../renderer/src/stores/chat-store/helpers/session-turn')
const { createSendWriteScope } = await import('../../renderer/src/stores/chat-store/helpers/send-write-scope')

const PROJECT = '/proj'
const SID = 'sid-parity'

function seedDraft(
  harness: HarnessId,
  patch: Partial<ReturnType<typeof createDefaultPerSessionState>>,
  projectPatch: Partial<ReturnType<typeof createDefaultProjectState>> = {},
) {
  const project = { ...createDefaultProjectState(), ...projectPatch }
  project._activeSessionId = SID
  project._sessions = {
    [SID]: {
      ...createDefaultPerSessionState(),
      preferredProvider: harness,
      sessionProvider: harness,
      hostSessionOwned: false,
      ...patch,
    },
  }
  useChatStore.setState({ projectSessions: { [PROJECT]: project }, activeProject: PROJECT, remoteSessions: {} })
}

async function runFirstAndSecondTurn() {
  const scope = createSendWriteScope(useChatStore.setState, useChatStore.getState, PROJECT)
  const sid = await ensureHostSession(useChatStore.setState, useChatStore.getState, PROJECT, scope)
  const turn1 = sessionTurnRequest(useChatStore.getState(), PROJECT, sid, { text: 'first', clientMessageId: 'u1', firstTurn: true })
  await hostSession!.send(desktopSendRequest(turn1 as never, hostSession!.snapshot.harnessId))
  await useChatStore.getState().syncLiveSnapshots()
  const turn2 = sessionTurnRequest(useChatStore.getState(), PROJECT, sid, { text: 'second', clientMessageId: 'u2' })
  await hostSession!.send(desktopSendRequest(turn2 as never, hostSession!.snapshot.harnessId))
}

beforeEach(() => {
  hostSession = null
  hostCapture = null
  useChatStore.setState({ projectSessions: {}, activeProject: null, remoteSessions: {}, disabledSkills: [] })
  vi.clearAllMocks()
})

afterEach(async () => {
  if (hostSession) {
    await hostSession.dispose()
    hostSession = null
  }
})

describe('prewarm parity contract across harnesses', () => {
  it.each(['cold', 'prewarmed'] as const)('acp-antigravity keeps pre-turn high effort (%s)', async (mode) => {
    seedDraft('acp-antigravity', {
      acpAgentId: 'antigravity',
      selectedModel: 'gemini-4-carbon',
      acpModeConfigId: 'thought_level',
      selectedAcpModeId: 'medium',
      acpModes: [
        { id: 'low', name: 'Low', description: '' },
        { id: 'medium', name: 'Medium', description: '' },
        { id: 'high', name: 'High', description: '' },
      ],
    })
    if (mode === 'prewarmed') {
      const { session } = makeHostSession('acp-antigravity', SID, { model: 'gemini-4-carbon', acpAgentId: 'antigravity' })
      session.prewarm({ model: 'gemini-4-carbon', effort: 'medium', acpAgentId: 'antigravity' })
    }

    useChatStore.getState().setSelectedAcpMode('high')
    await runFirstAndSecondTurn()

    expect(hostCapture?.lastMode).toBe('high')
    expect(hostCapture?.lastSend?.effort).toBe('high')
    expect(hostSession?.getUiSettings().selectedAcpModeId).toBe('high')
    expect(useChatStore.getState().projectSessions[PROJECT]._sessions[SID].selectedAcpModeId).toBe('high')
  })

  it.each(['cold', 'prewarmed'] as const)('acp-grok keeps pre-turn high effort (%s)', async (mode) => {
    seedDraft('acp-grok', {
      acpAgentId: 'grok-build',
      selectedModel: 'grok-4.5',
      acpModeConfigId: 'reasoning_effort',
      selectedAcpModeId: 'low',
      acpModes: [
        { id: 'low', name: 'Low', description: '' },
        { id: 'high', name: 'High', description: '' },
      ],
    })
    if (mode === 'prewarmed') {
      const { session } = makeHostSession('acp-grok', SID, { model: 'grok-4.5', acpAgentId: 'grok-build' })
      session.prewarm({ model: 'grok-4.5', effort: 'low', acpAgentId: 'grok-build' })
    }

    useChatStore.getState().setSelectedAcpMode('high')
    await runFirstAndSecondTurn()

    expect(hostCapture?.lastMode).toBe('high')
    expect(hostCapture?.lastSend?.effort).toBe('high')
    expect(hostSession?.getUiSettings().selectedAcpModeId).toBe('high')
    expect(useChatStore.getState().projectSessions[PROJECT]._sessions[SID].selectedAcpModeId).toBe('high')
  })

  it.each(['cold', 'prewarmed'] as const)('claude keeps pre-turn model, effort, permissionMode, and ultracode (%s)', async (mode) => {
    seedDraft('claude', {
      selectedModel: 'claude-sonnet-4-6',
      selectedEffort: 'medium',
      permissionMode: 'default',
      ultracode: false,
    })
    if (mode === 'prewarmed') {
      const { session } = makeHostSession('claude', SID, { model: 'claude-sonnet-4-6', effort: 'medium' })
      session.prewarm({ model: 'claude-sonnet-4-6', effort: 'medium' })
    }

    useChatStore.getState().setSelectedModel('claude-opus-4-6')
    useChatStore.getState().setSelectedEffort('high')
    await useChatStore.getState().setPermissionMode('acceptEdits')
    useChatStore.getState().setUltracode(true)
    await runFirstAndSecondTurn()

    expect(hostCapture?.startOpts).toMatchObject({
      model: 'claude-opus-4-6',
      effort: 'high',
      permissionMode: 'acceptEdits',
      ultracode: true,
    })
    expect(hostSession?.getUiSettings()).toMatchObject({
      selectedModel: 'claude-opus-4-6',
      selectedEffort: 'high',
      permissionMode: 'acceptEdits',
      ultracode: true,
    })
    expect(useChatStore.getState().projectSessions[PROJECT]._sessions[SID]).toMatchObject({
      selectedModel: 'claude-opus-4-6',
      selectedEffort: 'high',
      permissionMode: 'acceptEdits',
      ultracode: true,
    })
  })

  it.each(['cold', 'prewarmed'] as const)('codex keeps pre-turn model, reasoningEffort, serviceTier, permissionPreset, and collaborationMode (%s)', async (mode) => {
    seedDraft(
      'codex',
      {
        selectedCodexModel: 'gpt-5.6',
        selectedCodexReasoningEffort: 'medium',
        selectedCodexServiceTier: null,
        selectedCodexPermissionPreset: 'default',
        selectedCodexCollaborationMode: 'default',
      },
      {
        codexModels: [
          {
            id: 'gpt-5.6',
            name: 'GPT-5.6',
            description: '',
            supportedReasoningEfforts: [{ value: 'medium', description: '' }, { value: 'high', description: '' }],
            defaultReasoningEffort: 'medium',
          },
          {
            id: 'gpt-5.6-pro',
            name: 'GPT-5.6 Pro',
            description: '',
            supportedReasoningEfforts: [{ value: 'medium', description: '' }, { value: 'xhigh', description: '' }],
            defaultReasoningEffort: 'medium',
            serviceTiers: [{ id: 'priority', name: 'Fast', description: '' }],
          },
        ],
      },
    )
    if (mode === 'prewarmed') {
      const { session } = makeHostSession('codex', SID, { model: 'gpt-5.6', effort: 'medium' })
      session.prewarm({ model: 'gpt-5.6', effort: 'medium' })
    }

    useChatStore.getState().setSelectedCodexModel('gpt-5.6-pro')
    useChatStore.getState().setSelectedCodexReasoningEffort('xhigh')
    useChatStore.getState().setSelectedCodexServiceTier('priority')
    useChatStore.getState().setSelectedCodexPermissionPreset('full-access')
    useChatStore.getState().setSelectedCodexCollaborationMode('plan')
    await runFirstAndSecondTurn()

    expect(hostCapture?.lastSend).toMatchObject({
      model: 'gpt-5.6-pro',
      codex: expect.objectContaining({
        reasoningEffort: 'xhigh',
        serviceTier: 'priority',
        permissionPreset: 'full-access',
        collaborationMode: 'plan',
      }),
    })
    expect(useChatStore.getState().projectSessions[PROJECT]._sessions[SID]).toMatchObject({
      selectedCodexModel: 'gpt-5.6-pro',
      selectedCodexReasoningEffort: 'xhigh',
      selectedCodexServiceTier: 'priority',
      selectedCodexPermissionPreset: 'full-access',
      selectedCodexCollaborationMode: 'plan',
    })
  })

  it.each(['cold', 'prewarmed'] as const)('opencode keeps pre-turn model, effort, and agent (%s)', async (mode) => {
    seedDraft('opencode', {
      selectedModel: 'openai/gpt-5.1',
      selectedEffort: 'low',
      openCodeAgentId: 'build',
    })
    if (mode === 'prewarmed') {
      const { session } = makeHostSession('opencode', SID, { model: 'openai/gpt-5.1', effort: 'low' })
      session.prewarm({ model: 'openai/gpt-5.1', effort: 'low' })
    }

    useChatStore.getState().setSelectedModel('openai/gpt-5.2')
    useChatStore.getState().setSelectedEffort('high')
    useChatStore.getState().setOpenCodeAgentId('plan')
    await runFirstAndSecondTurn()

    expect(hostCapture?.lastSend).toMatchObject({
      model: 'openai/gpt-5.2',
      effort: 'high',
      agent: 'plan',
    })
    expect(hostSession?.getUiSettings()).toMatchObject({
      selectedModel: 'openai/gpt-5.2',
      selectedEffort: 'high',
      openCodeAgentId: 'plan',
    })
    expect(useChatStore.getState().projectSessions[PROJECT]._sessions[SID]).toMatchObject({
      selectedModel: 'openai/gpt-5.2',
      selectedEffort: 'high',
      openCodeAgentId: 'plan',
    })
  })
})
