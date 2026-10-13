import { readFile } from 'node:fs/promises'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { applyEventToSession, createDefaultChatCoreSession } from '@superone/chat-core'
import type { ChatCoreSession } from '@superone/chat-core'
import type { AgentEvent, HarnessId, SendMessageRequest, SessionSettingsPatch } from '@superone/shared/agent-types'
import { HARNESS_CAPABILITIES } from '@superone/shared/harness/harness-capabilities'
import { SESSION_SEND_SELECTION_KEYS, type SessionSendSelections } from '@superone/shared/environment/session-send'
import type { NodeSessionSettings } from '@superone/runtime/session'
import { parseSessionSettings } from '@superone/runtime/server/session-settings'
import { applyDesktopSessionSettings, desktopSendRequest } from '../node-host/desktop-session-mutations'
import { nativeSessionLoad } from './native-restore.test-fixtures'
import { Session } from './session'
import type { BackendStartOptions, SessionBackend, SessionStateChange } from './types'
import { interfaceSettingKeys } from '../../test/fixtures/settings-contract-schema'

vi.mock('../logger', () => ({ default: { info: vi.fn(), warn: vi.fn(), debug: vi.fn(), error: vi.fn() } }))
vi.mock('../shell-path', () => ({ ensureShellPath: async () => {}, isShellPathReady: () => true }))
vi.mock('../sandbox-platform', async (original) => ({
  ...(await original<typeof import('../sandbox-platform')>()),
  getSandboxCapability: () => ({ supportLevel: 'always', platform: 'darwin', defaultMode: 'on' }),
}))

type SettingKey = keyof NodeSessionSettings
type Contract = {
  owner: 'session' | 'provider'
  lifetime: 'database' | 'live' | 'provider'
  harness: HarnessId
  value: unknown
  ui?: (keyof SessionSettingsPatch & keyof ChatCoreSession) | 'sandboxInfo'
  persisted?: keyof SessionStateChange
  read?: (session: Session) => unknown
}

// Every settings key must declare ownership and lifetime. Provider-owned fields
// are verified at their native API boundary, rather than invented as DB fields.
const CONTRACTS = {
  model: { owner: 'session', lifetime: 'database', harness: 'claude', value: 'new-model', ui: 'selectedModel', persisted: 'selectedModel', read: s => s.getSelectedModel() },
  effort: { owner: 'session', lifetime: 'database', harness: 'claude', value: 'high', ui: 'selectedEffort', persisted: 'selectedEffort', read: s => s.getSelectedEffort() },
  permissionMode: { owner: 'session', lifetime: 'live', harness: 'claude', value: 'acceptEdits', ui: 'permissionMode', read: s => s.getUiSettings().permissionMode },
  sandboxMode: { owner: 'session', lifetime: 'live', harness: 'claude', value: 'off', ui: 'sandboxInfo', read: s => s.getCurrentSandboxInfo().enabled ? 'on' : 'off' },
  apiProviderId: { owner: 'session', lifetime: 'database', harness: 'claude', value: 'credential-new', ui: 'apiProviderId', persisted: 'apiProviderId', read: s => s.getApiProviderId() },
  serviceTier: { owner: 'session', lifetime: 'database', harness: 'codex', value: 'priority', ui: 'selectedCodexServiceTier', persisted: 'codexServiceTier', read: s => s.getUiSettings().selectedCodexServiceTier },
  permissionPreset: { owner: 'session', lifetime: 'live', harness: 'codex', value: 'full-access', ui: 'selectedCodexPermissionPreset', read: s => s.getUiSettings().selectedCodexPermissionPreset },
  collaborationMode: { owner: 'session', lifetime: 'live', harness: 'codex', value: 'plan', ui: 'selectedCodexCollaborationMode', read: s => s.getUiSettings().selectedCodexCollaborationMode },
  agent: { owner: 'session', lifetime: 'live', harness: 'opencode', value: 'plan', ui: 'openCodeAgentId', read: s => s.getUiSettings().openCodeAgentId },
  ultracode: { owner: 'session', lifetime: 'live', harness: 'claude', value: true, ui: 'ultracode', read: s => s.getUiSettings().ultracode ?? false },
  mode: { owner: 'session', lifetime: 'live', harness: 'acp', value: 'plan', ui: 'selectedAcpModeId', read: s => s.getUiSettings().selectedAcpModeId },
  agentPreset: { owner: 'session', lifetime: 'live', harness: 'dsh', value: 'review', read: s => s.getAgentPreset() },
  additionalDirectories: { owner: 'session', lifetime: 'live', harness: 'claude', value: ['/extra'], read: s => s.getCallerScopedDirsSnapshot() },
  contextWindow: { owner: 'provider', lifetime: 'provider', harness: 'acp', value: 128000 },
} satisfies Record<SettingKey, Contract>

const SEND_OWNERS = {
  agent: 'session', serviceTier: 'session', permissionPreset: 'session',
  priority: 'turn', steer: 'turn', inputRequest: 'turn',
  threadId: 'provider', modelParams: 'harness-profile',
} satisfies Record<keyof SessionSendSelections, 'session' | 'turn' | 'provider' | 'harness-profile'>

const UI_SOURCES = {
  selectedModel: 'model', selectedEffort: 'effort', ultracode: 'ultracode',
  selectedCodexModel: 'model', selectedCodexReasoningEffort: 'effort', selectedCodexServiceTier: 'serviceTier',
  selectedCodexPermissionPreset: 'permissionPreset', selectedCodexCollaborationMode: 'collaborationMode',
  openCodeAgentId: 'agent', selectedAcpModeId: 'mode', permissionMode: 'permissionMode',
  sandboxInfo: 'sandboxMode', apiProviderId: 'apiProviderId', apiProvider: 'derived',
} satisfies Record<keyof SessionSettingsPatch, SettingKey | 'derived'>

const live: Session[] = []
afterEach(async () => { for (const session of live.splice(0)) await session.dispose() })

function fixture(harness: HarnessId) {
  let emit: (event: AgentEvent) => void = () => {}
  let runtimeDefaults: { model?: string | null; effort?: string | null; serviceTier?: string | null } = {}
  const saved = vi.fn<(state: SessionStateChange) => void>()
  const backend = {
    kind: harness,
    start: vi.fn(async (opts: BackendStartOptions) => { runtimeDefaults = { model: opts.model, effort: opts.effort, serviceTier: opts.serviceTier } }),
    rebuild: vi.fn(async (opts: BackendStartOptions) => { runtimeDefaults = { model: opts.model, effort: opts.effort, serviceTier: opts.serviceTier } }),
    send: vi.fn(async (_request: SendMessageRequest) => {}),
    setModel: vi.fn(async (model: string, _opts?: { contextWindow?: number }) => { runtimeDefaults.model = model }),
    setSessionMode: vi.fn(async (_mode: string) => {}),
    setCodexSelection: vi.fn(async (selection: { model?: string | null; reasoningEffort?: string | null; serviceTier?: string | null }) => {
      if (selection.model !== undefined) runtimeDefaults.model = selection.model
      if (selection.reasoningEffort !== undefined) runtimeDefaults.effort = selection.reasoningEffort
      if (selection.serviceTier !== undefined) runtimeDefaults.serviceTier = selection.serviceTier
    }),
    setPermissionMode: vi.fn(async () => {}), getPendingInteractions: () => [],
    onEvent: (listener: typeof emit) => { emit = listener; return () => {} },
    onProviderSessionId: () => () => {}, onPermissionModeApplied: () => () => {},
    close: vi.fn(async () => {}),
  }
  const session = new Session({
    id: 'session', projectPath: '/project', cwd: '/project', providerId: `${harness}-base`, harnessId: harness,
    providerConfig: {}, model: 'old-model', effort: 'low', backend: backend as unknown as SessionBackend,
    onStateChange: saved,
  })
  live.push(session)
  let subscriber: ChatCoreSession = { ...createDefaultChatCoreSession(), sessionProvider: harness }
  const events: AgentEvent[] = []
  session.on((event) => {
    events.push(event)
    subscriber = { ...subscriber, ...applyEventToSession(subscriber, event) }
  })
  events.length = 0
  return { session, backend, saved, events, runtimeDefaults: () => runtimeDefaults, subscriber: () => subscriber, emit: (event: AgentEvent) => emit(event) }
}

function expectedUi(key: SettingKey, value: unknown) {
  return key === 'sandboxMode' ? { enabled: false, autoAllowBash: false } : value
}

describe('session settings ownership contract', () => {
  it('requires a contract for every public settings key, including newly added keys', async () => {
    const source = await readFile(new URL('../../../../../packages/runtime/src/session/types.ts', import.meta.url), 'utf8')
    expect(Object.keys(CONTRACTS).sort()).toEqual(interfaceSettingKeys(source, 'NodeSessionSettings'))
  })

  it('classifies every send selection instead of persisting turn-only fields as settings', () => {
    expect(Object.keys(SEND_OWNERS).sort()).toEqual([...SESSION_SEND_SELECTION_KEYS].sort())
  })

  it('requires an authoritative source for every settings field rendered by subscribers', async () => {
    const source = await readFile(new URL('../../../../../packages/shared/src/agent-types.ts', import.meta.url), 'utf8')
    expect(Object.keys(UI_SOURCES).sort()).toEqual(interfaceSettingKeys(source, 'SessionSettingsPatch'))
  })

  it.each(Object.entries(CONTRACTS) as [SettingKey, Contract][])(
    'applies %s through the settings API before running the next turn', async (key, rule) => {
      const f = fixture(rule.harness)
      await applyDesktopSessionSettings(f.session, parseSessionSettings({ [key]: rule.value }))

      if (rule.owner === 'provider') {
        expect(f.backend.setModel).toHaveBeenCalledWith('old-model', { contextWindow: rule.value })
        return
      }
      expect.soft(rule.read!(f.session)).toEqual(rule.value)
      if (rule.ui) {
        if (rule.ui !== 'sandboxInfo') expect.soft(f.subscriber()[rule.ui]).toEqual(expectedUi(key, rule.value))
        expect.soft(f.events).toContainEqual(expect.objectContaining({ type: 'agent_setting_change', patch: expect.objectContaining({ [rule.ui]: expectedUi(key, rule.value) }) }))
      }

      f.backend.send.mockImplementation(async () => {
        expect.soft(rule.read!(f.session)).toEqual(rule.value)
        if (rule.persisted) expect.soft(f.saved.mock.calls.at(-1)?.[0][rule.persisted]).toEqual(rule.value)
      })
      await f.session.send({ content: 'Continue with the saved setting' })
      const snapshot = await nativeSessionLoad(f.session)
      if (rule.ui === 'sandboxInfo') expect.soft(snapshot.restore?.sandboxInfo).toEqual(expectedUi(key, rule.value))
      else if (rule.ui) expect.soft(({ ...createDefaultChatCoreSession(), ...snapshot.state })[rule.ui]).toEqual(expectedUi(key, rule.value))
    },
  )
})

const sendCases = [
  ...(Object.keys(HARNESS_CAPABILITIES) as HarnessId[]).flatMap(harness => [
    { key: 'model' as const, harness, value: 'new-model', input: { model: 'new-model' }, ui: harness === 'codex' ? 'selectedCodexModel' : 'selectedModel' },
    { key: 'effort' as const, harness, value: 'high', input: { effort: 'high' }, ui: harness === 'codex' ? 'selectedCodexReasoningEffort' : 'selectedEffort' },
  ]),
  { key: 'effort' as const, harness: 'codex' as const, value: 'ultra', input: { effort: 'ultra' }, ui: 'selectedCodexReasoningEffort' },
  { key: 'serviceTier' as const, harness: 'codex' as const, value: 'priority', input: { serviceTier: 'priority' }, ui: 'selectedCodexServiceTier' },
  { key: 'serviceTier' as const, harness: 'codex' as const, value: null, input: { serviceTier: null }, ui: 'selectedCodexServiceTier' },
  { key: 'permissionPreset' as const, harness: 'codex' as const, value: 'full-access', input: { permissionPreset: 'full-access' as const }, ui: 'selectedCodexPermissionPreset' },
  { key: 'collaborationMode' as const, harness: 'codex' as const, value: 'plan', input: { collaborationMode: 'plan' }, ui: 'selectedCodexCollaborationMode' },
  { key: 'agent' as const, harness: 'opencode' as const, value: 'plan', input: { agent: 'plan' }, ui: 'openCodeAgentId' },
  { key: 'ultracode' as const, harness: 'claude' as const, value: true, input: { ultracode: true }, ui: 'ultracode' },
  { key: 'ultracode' as const, harness: 'claude' as const, value: false, input: { ultracode: false }, ui: 'ultracode' },
  { key: 'additionalDirectories' as const, harness: 'claude' as const, value: ['/extra'], input: { additionalDirectories: ['/extra'] }, ui: undefined },
]

describe('settings carried by a send', () => {
  it.each(sendCases)('commits $harness / $key=$value before backend execution and restores subscribers', async ({ key, harness, input, value, ui }) => {
    const rule = CONTRACTS[key] as Contract
    const f = fixture(harness)
    if (value === null) f.session.broadcastSettingsPatch({ selectedCodexServiceTier: 'priority' })
    if (key === 'ultracode' && value === false) await applyDesktopSessionSettings(f.session, { ultracode: true })
    f.events.length = 0

    f.backend.send.mockImplementation(async () => {
      expect.soft(rule.read!(f.session)).toEqual(value)
      if (rule.persisted) expect.soft(f.saved.mock.calls.at(-1)?.[0][rule.persisted]).toEqual(value)
      if (ui) expect.soft(f.events).toContainEqual(expect.objectContaining({
        type: 'agent_setting_change', patch: expect.objectContaining({ [ui]: value }),
      }))
    })
    await f.session.send(desktopSendRequest({ sessionId: f.session.id, text: 'Use the selected settings',
      client: { clientSessionId: 'phone' }, leaseId: 'test-lease', generation: '1', ...input }, harness), { providerOrigin: 'remote' })
    expect(f.backend.send).toHaveBeenCalledOnce()
    if (ui) {
      expect.soft(f.subscriber()[ui as keyof ChatCoreSession]).toEqual(value)
      const restored = await nativeSessionLoad(f.session)
      expect.soft(({ ...createDefaultChatCoreSession(), ...restored.state })[ui]).toEqual(value)
    }
  })
})

describe('settings carried by a queued Codex turn', () => {
  it.each(sendCases.filter(row => row.harness === 'codex'))(
    'commits $key=$value when the queued turn is consumed', async ({ key, input, value, ui }) => {
      const rule = CONTRACTS[key] as Contract
      const f = fixture('codex')
      if (value === null) f.session.broadcastSettingsPatch({ selectedCodexServiceTier: 'priority' })
      await f.session.send({ content: 'Start the current turn' })
      f.emit({ type: 'status_change', status: 'streaming' })
      const previous = rule.read!(f.session)
      await f.session.send(desktopSendRequest({ sessionId: f.session.id, text: 'Run after the current turn',
        client: { clientSessionId: 'phone' }, leaseId: 'test-lease', generation: '1', priority: 'next', clientMessageId: 'queued-settings', ...input }, 'codex'), { providerOrigin: 'remote' })
      expect(rule.read!(f.session)).toEqual(previous)

      f.emit({ type: 'queued_message_consumed', clientMessageId: 'queued-settings' })
      expect.soft(rule.read!(f.session)).toEqual(value)
      if (rule.persisted) expect.soft(f.saved.mock.calls.at(-1)?.[0][rule.persisted]).toEqual(value)
      if (ui) expect.soft(f.subscriber()[ui as keyof ChatCoreSession]).toEqual(value)
    },
  )

  it.each([
    { key: 'model' as const, queued: { model: 'queued-model' }, latest: { model: 'latest-model' }, expected: 'latest-model' },
    { key: 'effort' as const, queued: { effort: 'low' }, latest: { effort: 'ultra' }, expected: 'ultra' },
    { key: 'serviceTier' as const, queued: { serviceTier: null }, latest: { serviceTier: 'priority' }, expected: 'priority' },
  ])('retains a newer explicit $key pick when an older queued turn is consumed', async ({ key, queued, latest, expected }) => {
    const f = fixture('codex')
    await f.session.send({ content: 'Start the current turn' })
    f.emit({ type: 'status_change', status: 'streaming' })
    await f.session.send(desktopSendRequest({ sessionId: f.session.id, text: 'Old queued selection',
      client: { clientSessionId: 'phone' }, leaseId: 'test-lease', generation: '1', priority: 'next', clientMessageId: 'old-queued-settings', ...queued }, 'codex'), { providerOrigin: 'remote' })
    await applyDesktopSessionSettings(f.session, parseSessionSettings(latest))
    f.emit({ type: 'queued_message_consumed', clientMessageId: 'old-queued-settings' })
    expect((CONTRACTS[key] as Contract).read!(f.session)).toBe(expected)
  })
})

describe('queued selections across settings', () => {
  const queuedSelection = { model: 'queued-model', serviceTier: 'priority', effort: 'medium', permissionPreset: 'read-only' as const }
  it.each([
    { later: { effort: 'ultra' }, kept: { effort: 'ultra', permissionPreset: 'read-only' } },
    { later: { permissionPreset: 'full-access' }, kept: { effort: 'medium', permissionPreset: 'full-access' } },
    { later: { apiProviderId: 'credential-new' }, kept: { effort: 'medium', permissionPreset: 'read-only' } },
  ])('commits the queued model and Fast while keeping a newer pick of $later', async ({ later, kept }) => {
    const f = fixture('codex')
    await f.session.send({ content: 'Start the current turn' })
    f.emit({ type: 'status_change', status: 'streaming' })
    await f.session.send(desktopSendRequest({ sessionId: f.session.id, text: 'Run after the current turn',
      client: { clientSessionId: 'phone' }, leaseId: 'test-lease', generation: '1', priority: 'next', clientMessageId: 'queued', ...queuedSelection }, 'codex'), { providerOrigin: 'remote' })
    await applyDesktopSessionSettings(f.session, parseSessionSettings(later))
    f.emit({ type: 'queued_message_consumed', clientMessageId: 'queued' })

    const read = (key: SettingKey) => (CONTRACTS[key] as Contract).read!(f.session)
    expect.soft(read('model')).toBe('queued-model')
    expect.soft(read('serviceTier')).toBe('priority')
    expect.soft(read('effort')).toBe(kept.effort)
    expect.soft(read('permissionPreset')).toBe(kept.permissionPreset)
    expect.soft(f.saved.mock.calls.at(-1)?.[0]).toMatchObject({ selectedModel: 'queued-model', selectedEffort: kept.effort, codexServiceTier: 'priority' })
    expect.soft(f.subscriber()).toMatchObject({
      selectedCodexModel: 'queued-model', selectedCodexServiceTier: 'priority',
      selectedCodexReasoningEffort: kept.effort, selectedCodexPermissionPreset: kept.permissionPreset,
    })
  })
})

describe('settings carried by a queued turn on other harnesses', () => {
  async function queue(f: ReturnType<typeof fixture>, harness: HarnessId, input: Record<string, unknown>) {
    await f.session.send({ content: 'Start the current turn' })
    f.emit({ type: 'status_change', status: 'streaming' })
    await f.session.send(desktopSendRequest({ sessionId: f.session.id, text: 'Run after the current turn',
      client: { clientSessionId: 'phone' }, leaseId: 'test-lease', generation: '1', priority: 'next', clientMessageId: 'queued', ...input }, harness), { providerOrigin: 'remote' })
  }

  it.each([
    { harness: 'claude' as const, key: 'model' as const, value: 'queued-model', ui: 'selectedModel' as const },
    { harness: 'acp' as const, key: 'model' as const, value: 'queued-model', ui: 'selectedModel' as const },
    { harness: 'opencode' as const, key: 'model' as const, value: 'queued-model', ui: 'selectedModel' as const },
    { harness: 'opencode' as const, key: 'agent' as const, value: 'plan', ui: 'openCodeAgentId' as const },
  ])('commits $harness / $key when the queued turn is consumed', async ({ harness, key, value, ui }) => {
    const rule = CONTRACTS[key] as Contract
    const f = fixture(harness)
    await queue(f, harness, { [key]: value })
    const previous = rule.read!(f.session)
    expect(previous).not.toEqual(value)

    f.emit({ type: 'queued_message_consumed', clientMessageId: 'queued' })
    expect.soft(rule.read!(f.session)).toEqual(value)
    if (rule.persisted) expect.soft(f.saved.mock.calls.at(-1)?.[0][rule.persisted]).toEqual(value)
    expect.soft(f.subscriber()[ui]).toEqual(value)
    // The backend runs the queued turn with this selection; nothing restarts it.
    expect(f.backend.rebuild).not.toHaveBeenCalled()
  })

  it('keeps a newer model pick and restarts the runtime on it after the queued turn', async () => {
    const f = fixture('claude')
    await queue(f, 'claude', { model: 'queued-model' })
    await applyDesktopSessionSettings(f.session, parseSessionSettings({ model: 'latest-model' }))
    f.emit({ type: 'queued_message_consumed', clientMessageId: 'queued' })
    expect(f.session.getSelectedModel()).toBe('latest-model')
    expect(f.subscriber().selectedModel).toBe('latest-model')
    expect(f.backend.rebuild).not.toHaveBeenCalled()

    f.emit({ type: 'status_change', status: 'idle' })
    await f.session.send({ content: 'Next turn' })
    expect(f.backend.rebuild).toHaveBeenCalledWith(expect.objectContaining({ model: 'latest-model' }))
  })

  it('runs a queued effort change after the current turn, through a restart', async () => {
    const f = fixture('claude')
    await f.session.send({ content: 'Warm the backend' })
    let finishTurn!: () => void
    f.backend.send.mockImplementationOnce(() => new Promise<void>((resolve) => { finishTurn = resolve }))
    const running = f.session.send({ content: 'Long turn' })
    await vi.waitFor(() => expect(f.backend.send).toHaveBeenCalledTimes(2))

    const queued = f.session.send(desktopSendRequest({ sessionId: f.session.id, text: 'Use more effort next',
      client: { clientSessionId: 'phone' }, leaseId: 'test-lease', generation: '1', priority: 'next', clientMessageId: 'queued', effort: 'high' }, 'claude'), { providerOrigin: 'remote' })
    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(f.backend.rebuild).not.toHaveBeenCalled()
    expect(f.session.getSelectedEffort()).toBe('low')

    f.backend.send.mockImplementation(async () => {
      expect(f.runtimeDefaults().effort).toBe('high')
      expect(f.session.getSelectedEffort()).toBe('high')
    })
    finishTurn()
    await Promise.all([running, queued])
    expect(f.backend.rebuild).toHaveBeenCalledOnce()
    expect(f.backend.send).toHaveBeenCalledTimes(3)
  })
})

describe('a queued send promoted to run after the current turn', () => {
  it.each([
    { later: { effort: 'max' }, expected: { model: 'queued-model', effort: 'max' } },
    { later: { model: 'latest-model' }, expected: { model: 'latest-model', effort: 'high' } },
  ])('keeps a newer pick of $later and commits its other settings', async ({ later, expected }) => {
    const f = fixture('claude')
    await f.session.send({ content: 'Warm the backend' })
    let finishTurn!: () => void
    f.backend.send.mockImplementationOnce(() => new Promise<void>((resolve) => { finishTurn = resolve }))
    const running = f.session.send({ content: 'Long turn' })
    await vi.waitFor(() => expect(f.backend.send).toHaveBeenCalledTimes(2))

    // The effort change promotes this queued send to the normal path.
    const queued = f.session.send(desktopSendRequest({ sessionId: f.session.id, text: 'Queued with older picks',
      client: { clientSessionId: 'phone' }, leaseId: 'test-lease', generation: '1', priority: 'next', clientMessageId: 'queued',
      model: 'queued-model', effort: 'high' }, 'claude'), { providerOrigin: 'remote' })
    await new Promise((resolve) => setTimeout(resolve, 0))
    await applyDesktopSessionSettings(f.session, parseSessionSettings(later))

    // What the runtime runs with: this turn's explicit selection, else its defaults.
    const runtimeSelection = (request: SendMessageRequest) => ({
      model: request.model ?? f.runtimeDefaults().model,
      effort: request.effort ?? f.runtimeDefaults().effort,
    })
    const host = () => ({ model: f.session.getSelectedModel(), effort: f.session.getSelectedEffort() })
    const executed: { runtime: unknown; host: unknown }[] = []
    f.backend.send.mockImplementation(async (request) => { executed.push({ runtime: runtimeSelection(request), host: host() }) })
    finishTurn()
    await Promise.all([running, queued])

    expect(executed[0]).toEqual({ runtime: expected, host: expected })
    expect(f.saved.mock.calls.at(-1)?.[0]).toMatchObject({ selectedModel: expected.model, selectedEffort: expected.effort })
    expect(f.subscriber()).toMatchObject({ selectedModel: expected.model, selectedEffort: expected.effort })

    // A later send that omits both runs on the same saved defaults.
    await f.session.send({ content: 'Omit the selection' })
    expect(executed[1]).toEqual({ runtime: expected, host: expected })
  })
})

describe('a queued Codex send promoted by a pending rebuild', () => {
  it('keeps a newer Fast pick while committing the queued model', async () => {
    const f = fixture('codex')
    await f.session.send({ content: 'Warm the backend' })
    let finishTurn!: () => void
    f.backend.send.mockImplementationOnce(() => new Promise<void>((resolve) => { finishTurn = resolve }))
    const running = f.session.send({ content: 'Long turn' })
    await vi.waitFor(() => expect(f.backend.send).toHaveBeenCalledTimes(2))
    f.session.markNeedsRebuild()

    const queued = f.session.send(desktopSendRequest({ sessionId: f.session.id, text: 'Queued with older picks',
      client: { clientSessionId: 'phone' }, leaseId: 'test-lease', generation: '1', priority: 'next', clientMessageId: 'queued',
      model: 'queued-model', serviceTier: 'priority' }, 'codex'), { providerOrigin: 'remote' })
    await new Promise((resolve) => setTimeout(resolve, 0))
    await applyDesktopSessionSettings(f.session, parseSessionSettings({ serviceTier: null }))

    const executed: unknown[] = []
    f.backend.send.mockImplementation(async (request) => {
      executed.push({
        model: request.model ?? f.runtimeDefaults().model,
        serviceTier: request.codex?.serviceTier !== undefined ? request.codex.serviceTier : f.runtimeDefaults().serviceTier,
        host: { model: f.session.getSelectedModel(), serviceTier: f.session.getUiSettings().selectedCodexServiceTier },
      })
    })
    finishTurn()
    await Promise.all([running, queued])
    await f.session.send({ content: 'Omit the selection' })

    const expected = { model: 'queued-model', serviceTier: null, host: { model: 'queued-model', serviceTier: null } }
    expect(executed).toEqual([expected, expected])
    expect(f.saved.mock.calls.at(-1)?.[0]).toMatchObject({ selectedModel: 'queued-model', codexServiceTier: null })
  })
})

describe('settings changed while the backend is already running', () => {
  it.each((Object.keys(HARNESS_CAPABILITIES) as HarnessId[]).flatMap(harness => [
    { harness, key: 'model' as const, value: 'new-model' },
    { harness, key: 'effort' as const, value: 'high' },
  ]))('delivers $harness / $key to the warm backend when the next send omits it', async ({ harness, key, value }) => {
    const f = fixture(harness)
    await f.session.send({ content: 'Warm the backend' })
    await applyDesktopSessionSettings(f.session, parseSessionSettings({ [key]: value }))
    expect((CONTRACTS[key] as Contract).read!(f.session)).toBe(value)
    f.backend.send.mockImplementation(async (request) => {
      // Observe what crossed the runtime boundary: startup/rebuild options,
      // live setters, or this turn's explicit selection must deliver the value.
      const received = key === 'model' ? request.model ?? f.runtimeDefaults().model
        : request.codex?.reasoningEffort ?? request.effort ?? f.runtimeDefaults().effort
      expect(received).toBe(value)
    })
    await f.session.send({ content: 'Use the saved selection' })
  })

  // Session-owned settings without a backend default the session keeps in step:
  // the runtime receives them only on the turn request itself.
  const turnSelections = [
    { key: 'permissionPreset' as const, harness: 'codex' as const, value: 'full-access', explicit: 'read-only', received: (r: SendMessageRequest) => r.codex?.permissionPreset },
    { key: 'collaborationMode' as const, harness: 'codex' as const, value: 'plan', explicit: 'default', received: (r: SendMessageRequest) => r.codex?.collaborationMode },
    { key: 'agent' as const, harness: 'opencode' as const, value: 'plan', explicit: 'build', received: (r: SendMessageRequest) => r.agent },
  ]

  it.each(turnSelections.flatMap(row => [{ ...row, warm: false }, { ...row, warm: true }]))(
    'delivers $harness / $key from the settings API to the next omitted send (warm=$warm)', async ({ key, harness, value, received, warm }) => {
      const f = fixture(harness)
      if (warm) await f.session.send({ content: 'Warm the backend' })
      await applyDesktopSessionSettings(f.session, parseSessionSettings({ [key]: value }))
      await f.session.send({ content: 'Use the saved selection' })
      expect(received(f.backend.send.mock.calls.at(-1)![0])).toBe(value)
    },
  )

  it.each(turnSelections)('keeps $harness / $key carried by one send for the next omitted send, and an explicit turn value wins', async ({ key, harness, value, explicit, received }) => {
    const f = fixture(harness)
    const send = (input: Record<string, unknown>) => f.session.send(desktopSendRequest({ sessionId: f.session.id, text: 'Turn',
      client: { clientSessionId: 'phone' }, leaseId: 'test-lease', generation: '1', ...input }, harness), { providerOrigin: 'remote' })
    await send({ [key]: value })
    await f.session.send({ content: 'Omit it' })
    expect(received(f.backend.send.mock.calls.at(-1)![0])).toBe(value)
    await send({ [key]: explicit })
    expect(received(f.backend.send.mock.calls.at(-1)![0])).toBe(explicit)
  })

  it('adopts the agent an OpenCode runtime reports for later omitted sends', async () => {
    const f = fixture('opencode')
    await f.session.send({ content: 'Warm the backend' })
    const readWhenAnnounced: unknown[] = []
    f.session.on((event) => {
      // Subscribing replays the current settings first; only the runtime's report matters here.
      if (event.type === 'agent_setting_change' && event.patch?.openCodeAgentId !== undefined) {
        readWhenAnnounced.push(f.session.getUiSettings().openCodeAgentId)
      }
    })
    f.emit({ type: 'agent_setting_change', patch: { openCodeAgentId: 'plan' } })
    expect(readWhenAnnounced).toEqual(['plan'])
    expect(f.session.getUiSettings().openCodeAgentId).toBe('plan')
    await f.session.send({ content: 'Omit the agent' })
    expect(f.backend.send.mock.calls.at(-1)![0].agent).toBe('plan')
  })

  it('delivers an explicit collaboration-mode reset to the next omitted send', async () => {
    const f = fixture('codex')
    await applyDesktopSessionSettings(f.session, parseSessionSettings({ collaborationMode: 'plan' }))
    await applyDesktopSessionSettings(f.session, parseSessionSettings({ collaborationMode: null }))
    await f.session.send({ content: 'Leave plan mode' })
    expect(f.backend.send.mock.calls.at(-1)![0].codex?.collaborationMode).toBe('default')
  })

  it('starts a turn only after a pending live model switch reaches the runtime', async () => {
    const f = fixture('claude')
    await f.session.send({ content: 'Warm the backend' })
    const apply = f.backend.setModel.getMockImplementation()!
    let finishSwitch!: () => void
    const switchGate = new Promise<void>((resolve) => { finishSwitch = resolve })
    f.backend.setModel.mockImplementationOnce(async (model, opts) => { await switchGate; await apply(model, opts) })
    f.backend.send.mockClear()
    f.backend.send.mockImplementation(async () => { expect(f.runtimeDefaults().model).toBe('new-model') })

    const patched = applyDesktopSessionSettings(f.session, parseSessionSettings({ model: 'new-model' }))
    const sent = f.session.send({ content: 'Sent while the switch is pending' })
    await vi.waitFor(() => expect(f.backend.setModel).toHaveBeenCalledWith('new-model'))
    expect(f.backend.send).not.toHaveBeenCalled()

    finishSwitch()
    await Promise.all([patched, sent])
    expect(f.backend.send).toHaveBeenCalledOnce()
  })

  it('restarts a runtime that refused a live model switch on the host model', async () => {
    const f = fixture('claude')
    await f.session.send({ content: 'Warm the backend' })
    f.backend.setModel.mockRejectedValueOnce(new Error('model switch refused'))
    await applyDesktopSessionSettings(f.session, parseSessionSettings({ model: 'new-model' }))
    f.backend.send.mockImplementation(async () => { expect(f.runtimeDefaults().model).toBe('new-model') })

    await f.session.send({ content: 'Use the saved selection' })
    expect(f.backend.rebuild).toHaveBeenCalledWith(expect.objectContaining({ model: 'new-model' }))
  })
})
