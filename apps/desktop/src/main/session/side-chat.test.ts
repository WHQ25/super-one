import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { SessionRecord } from './session-repo'
import type { PermissionMode } from '@superone/shared/agent-types'
import type { Session, SessionCreateOptions, SessionManager } from './types'

const { getSessionRecordMock, getSessionProviderMock, forkClaudeTranscriptMock } = vi.hoisted(() => ({
  getSessionRecordMock: vi.fn(),
  getSessionProviderMock: vi.fn(),
  forkClaudeTranscriptMock: vi.fn(async () => 'forked-provider-id'),
}))

vi.mock('../logger', () => ({
  default: { info: vi.fn(), warn: vi.fn(), debug: vi.fn(), error: vi.fn() },
}))
vi.mock('./session-repo', () => ({ getSessionRecord: getSessionRecordMock }))
vi.mock('./session-provider-repo', () => ({ getSessionProvider: getSessionProviderMock }))
vi.mock('@superone/claude', () => ({
  forkClaudeTranscript: forkClaudeTranscriptMock,
  claudeProjectsDir: () => '/tmp/claude-projects',
  claudeProjectSlug: (p: string) => p.replace(/[^a-zA-Z0-9]/g, '-'),
}))
// Real harness registry, stubbed backends: side chat never instantiates one.
vi.mock('./backends/claude-backend', () => ({ ClaudeBackend: class {} }))
vi.mock('./backends/codex-backend', () => ({ CodexBackend: class {} }))
vi.mock('./backends/acp-backend', () => ({ AcpBackend: class {} }))
vi.mock('./backends/opencode-backend', () => ({ OpenCodeBackend: class {} }))
vi.mock('./backends/cursor-fork', () => ({ forkCursorTranscript: vi.fn() }))
vi.mock('./backends/deepseek-fork', () => ({ forkDeepseekTranscript: vi.fn() }))

import { closeSideChat, SIDE_CHAT_INSTRUCTIONS, startSideChat } from './side-chat'

const PROJECT = '/repo'
const PARENT_SID = 'parent-sid'

function makeRecord(over: Partial<SessionRecord> = {}): SessionRecord {
  return {
    id: PARENT_SID, projectPath: PROJECT, projectId: 'p1', providerId: 'claude-base',
    harnessId: 'claude', providerSessionId: 'parent-provider', title: 'Parent',
    isWorktree: false, gitBranch: null, worktreePath: null, isPinned: false,
    isHidden: false, totalCostUsd: 0, contextTokens: 0, createdAt: '', lastUserMessageAt: null,
    apiProviderId: null, acpAgentId: null, selectedModel: 'claude-opus-5', selectedEffort: null, ...over,
  }
}

/**
 * Enough of SessionManager to observe what side chat asks it for. `created`
 * records the options so the test can assert on `ephemeral` — the one flag that
 * decides whether this session ever reaches the database.
 */
/**
 * A stand-in for the live parent `Session`.
 *
 * It has to answer the settings accessors as well as `snapshot`: a side chat
 * inherits permission mode, sandbox and dsh preset, none of which live on the
 * snapshot, and a fake missing them fails as a TypeError rather than as the
 * assertion the case is about.
 */
function makeLiveParent(over: {
  permissionMode?: PermissionMode
  sandboxInfo?: { enabled: boolean; autoAllowBash: boolean }
  agentPreset?: string | null
} = {}): Session {
  return {
    cwd: '/repo/worktree-a',
    snapshot: {
      projectPath: PROJECT,
      providerId: 'claude-base',
      providerSessionId: 'live-provider',
      gitBranch: 'feat',
      apiProviderId: null,
      acpAgentId: null,
      selectedModel: 'claude-sonnet-5',
      selectedEffort: null,
    },
    getCurrentPermissionMode: () => over.permissionMode ?? 'default',
    getCurrentSandboxInfo: () => over.sandboxInfo ?? { enabled: false, autoAllowBash: false },
    getAgentPreset: () => over.agentPreset ?? null,
  } as unknown as Session
}

function makeManager(over: { liveParent?: Partial<Session>; onCreate?: (session: Session) => void } = {}) {
  const created: SessionCreateOptions[] = []
  const sessions = new Map<string, Session>()
  if (over.liveParent) sessions.set(PARENT_SID, over.liveParent as Session)
  const disposed: string[] = []
  const mgr = {
    getSession: (id: string) => sessions.get(id) ?? null,
    createSession: (opts: SessionCreateOptions) => {
      created.push(opts)
      const session = {
        id: opts.id!,
        ephemeral: opts.ephemeral ?? false,
        setAgentPreset: () => {},
        snapshot: {
          harnessId: 'claude',
          providerId: opts.providerId,
          providerSessionId: opts.providerSessionId ?? null,
          cwd: opts.cwd ?? opts.projectPath,
          selectedModel: opts.model ?? null,
          selectedEffort: opts.effort ?? null,
        },
      } as unknown as Session
      over.onCreate?.(session)
      sessions.set(opts.id!, session)
      return session
    },
    disposeSession: async (id: string) => { disposed.push(id); sessions.delete(id) },
  } as unknown as SessionManager
  return { mgr, created, disposed, sessions }
}

beforeEach(() => {
  vi.clearAllMocks()
  forkClaudeTranscriptMock.mockResolvedValue('forked-provider-id')
  getSessionRecordMock.mockReturnValue(makeRecord())
  getSessionProviderMock.mockReturnValue({
    id: 'claude-base', harnessId: 'claude', name: 'Claude', isBase: true, config: {}, createdAt: 0, updatedAt: 0,
  })
})

describe('starting a side chat', () => {
  it('creates the session as ephemeral so nothing reaches the database', async () => {
    const { mgr, created } = makeManager()

    const result = await startSideChat(mgr, { parentSessionId: PARENT_SID })

    expect(result.ok).toBe(true)
    expect(created).toHaveLength(1)
    expect(created[0]!.ephemeral).toBe(true)
  })

  // Regression: a side chat runs in the parent's working directory. Starting it
  // on the process-default sandbox while the status bar reports the project's
  // setting shows the user a guarantee that is not in force.
  it('inherits the parent permission mode and sandbox rather than the process defaults', async () => {
    const liveParent = makeLiveParent({
      permissionMode: 'acceptEdits',
      sandboxInfo: { enabled: true, autoAllowBash: true },
    })
    const { mgr, created } = makeManager({ liveParent })

    await startSideChat(mgr, { parentSessionId: PARENT_SID })

    expect(created[0]!.permissionMode).toBe('acceptEdits')
    expect(created[0]!.sandboxMode).toBe('auto')
  })

  it('maps an enabled sandbox without auto-allow to "on", not "auto"', async () => {
    const liveParent = makeLiveParent({ sandboxInfo: { enabled: true, autoAllowBash: false } })
    const { mgr, created } = makeManager({ liveParent })

    await startSideChat(mgr, { parentSessionId: PARENT_SID })

    expect(created[0]!.sandboxMode).toBe('on')
  })

  // Regression: dsh resumes the forked durable log, which is authoritative for
  // the preset. Without carrying it the picker falls back to the roster's first
  // entry, so the panel displays Standard while the agent runs something else.
  it('carries the parent dsh preset onto the forked session and reports it back', async () => {
    const setAgentPreset = vi.fn()
    const liveParent = makeLiveParent({ agentPreset: 'research' })
    const { mgr, sessions } = makeManager({ liveParent, onCreate: (session) => { session.setAgentPreset = setAgentPreset } })

    const result = await startSideChat(mgr, { parentSessionId: PARENT_SID })

    expect(result.ok && result.agentPreset).toBe('research')
    expect(setAgentPreset).toHaveBeenCalledWith('research')
    expect(sessions.size).toBeGreaterThan(0)
  })

  it('resumes the forked transcript, not the parent one', async () => {
    const { mgr, created } = makeManager()

    await startSideChat(mgr, { parentSessionId: PARENT_SID })

    expect(forkClaudeTranscriptMock).toHaveBeenCalledWith(
      expect.objectContaining({ providerSessionId: 'parent-provider' }),
    )
    expect(created[0]!.providerSessionId).toBe('forked-provider-id')
  })

  it('tells the agent it is a side chat without touching the system prompt', async () => {
    const { mgr, created } = makeManager()

    await startSideChat(mgr, { parentSessionId: PARENT_SID })

    expect(created[0]!.firstTurnPreamble).toBe(SIDE_CHAT_INSTRUCTIONS)
    // A system-prompt append would change the request prefix, so the forked
    // transcript would miss the parent's prompt cache entirely — which is the
    // one thing fork buys us.
    expect(created[0]!.systemPromptAppend).toBeUndefined()
  })

  it('shares the parent working directory rather than branching a worktree', async () => {
    const { mgr, created } = makeManager()

    await startSideChat(mgr, { parentSessionId: PARENT_SID })

    expect(created[0]!.cwd).toBe(PROJECT)
  })

  it('prefers the live session over the stored row, so a fresh id is not missed', async () => {
    const liveParent = makeLiveParent()
    const { mgr, created } = makeManager({ liveParent })

    await startSideChat(mgr, { parentSessionId: PARENT_SID })

    expect(forkClaudeTranscriptMock).toHaveBeenCalledWith(
      expect.objectContaining({ providerSessionId: 'live-provider' }),
    )
    expect(created[0]!.cwd).toBe('/repo/worktree-a')
  })

  it('refuses on a harness that cannot fork, instead of handing back a blank session', async () => {
    getSessionRecordMock.mockReturnValue(makeRecord({ providerId: 'cursor-base', harnessId: 'cursor' }))
    getSessionProviderMock.mockReturnValue({
      id: 'cursor-base', harnessId: 'cursor', name: 'Cursor', isBase: true, config: {}, createdAt: 0, updatedAt: 0,
    })
    const { mgr, created } = makeManager()

    const result = await startSideChat(mgr, { parentSessionId: PARENT_SID })

    expect(result).toEqual({ ok: false, error: expect.stringContaining('cannot fork') })
    expect(created).toHaveLength(0)
  })

  it('refuses when the parent has no provider conversation yet', async () => {
    getSessionRecordMock.mockReturnValue(makeRecord({ providerSessionId: null }))
    const { mgr, created } = makeManager()

    const result = await startSideChat(mgr, { parentSessionId: PARENT_SID })

    expect(result.ok).toBe(false)
    expect(created).toHaveLength(0)
  })

  it('reports the fork failure rather than opening an empty side chat', async () => {
    forkClaudeTranscriptMock.mockRejectedValue(new Error('transcript missing'))
    const { mgr, created } = makeManager()

    const result = await startSideChat(mgr, { parentSessionId: PARENT_SID })

    expect(result).toEqual({ ok: false, error: expect.stringContaining('transcript missing') })
    expect(created).toHaveLength(0)
  })
})

describe('closing a side chat', () => {
  it('disposes the session', async () => {
    const { mgr, disposed } = makeManager()
    const started = await startSideChat(mgr, { parentSessionId: PARENT_SID })
    expect(started.ok).toBe(true)
    const sessionId = started.ok ? started.sessionId : ''

    await expect(closeSideChat(mgr, sessionId)).resolves.toBe(true)

    expect(disposed).toEqual([sessionId])
  })

  it('refuses to close a session that is not ephemeral', async () => {
    const persisted = { id: 'normal', ephemeral: false, snapshot: {} } as unknown as Session
    const { mgr, sessions, disposed } = makeManager()
    sessions.set('normal', persisted)

    await expect(closeSideChat(mgr, 'normal')).resolves.toBe(false)

    expect(disposed).toEqual([])
  })
})
