/** @vitest-environment jsdom */

/**
 * Pins the full per-harness payload a session sends (turn request and draft
 * settings) so moving harness branches out of `session-turn.ts` cannot add,
 * drop or rename a field unnoticed. Every session here also carries the other
 * harnesses' choices, so a leak across harnesses shows up as an extra key.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { HarnessId, ModelOption } from '@superone/shared/agent-types'

vi.mock('@/stores/app', () => ({
  useAppStore: {
    getState: () => ({
      getWorktreeState: () => ({ pendingBaseBranch: null }),
      setActiveWorktree: vi.fn(),
      sandboxCapability: null,
    }),
  },
}))
vi.mock('sonner', () => ({ toast: { error: vi.fn() } }))

const createSession = vi.fn()

vi.stubGlobal('window', {
  agent: { activateSession: vi.fn().mockResolvedValue(undefined), prewarm: vi.fn().mockResolvedValue(undefined) },
  app: { trace: vi.fn(), getAppSettings: vi.fn().mockResolvedValue({ agentPreference: {} }) },
  environment: {
    getSession: vi.fn().mockResolvedValue(null),
    createSession,
    removeSession: vi.fn().mockResolvedValue(undefined),
    listProjects: vi.fn().mockImplementation(async (connectionId: string) => connectionId === 'local'
      ? [{ projectId: 'local-project', path: '/proj' }]
      : [{ projectId: 'node-project', path: '/work/app' }]),
  },
  dispatchEvent: vi.fn(),
  addEventListener: vi.fn(),
  removeEventListener: vi.fn(),
})

const { useChatStore } = await import('../index')
const { createDefaultPerSessionState, createDefaultProjectState } = await import('../defaults')
const { ensureHostSession, sessionTurnRequest } = await import('./session-turn')
const { createSendWriteScope } = await import('./send-write-scope')
type SessionTurnOptions = Parameters<typeof sessionTurnRequest>[3]
type SessionPatch = Partial<ReturnType<typeof createDefaultPerSessionState>>

const HARNESSES: HarnessId[] = ['claude', 'codex', 'acp', 'opencode', 'cursor', 'dsh']
const LOCATIONS = { local: '/proj', node: 'remote:env-1:/work/app' } as const
const SID = 'sid-1'

const CODEX_MODELS: ModelOption[] = [
  { id: 'gpt-catalog-default', name: 'Default', description: '', isDefault: true, supportedReasoningEfforts: [{ value: 'medium', description: '' }, { value: 'high', description: '' }], defaultReasoningEffort: 'medium' },
  { id: 'gpt-picked', name: 'Picked', description: '', supportedReasoningEfforts: [{ value: 'low', description: '' }, { value: 'xhigh', description: '' }], defaultReasoningEffort: 'low' },
]

/** Every harness's own choices set at once, plus the generic ones. */
const CHOSEN: SessionPatch = {
  selectedModel: 'picked-model',
  selectedEffort: 'high',
  modelUserChosen: true,
  effortUserChosen: true,
  permissionMode: 'acceptEdits',
  apiProviderId: 'acct-1',
  additionalDirs: ['/extra'],
  sandboxInfo: { enabled: true, autoAllowBash: false },
  ultracode: true,
  claudeFastMode: true,
  selectedCodexModel: 'gpt-picked',
  selectedCodexReasoningEffort: 'xhigh',
  codexModelUserChosen: true,
  codexReasoningEffortUserChosen: true,
  selectedCodexServiceTier: 'priority',
  selectedCodexPermissionPreset: 'auto-review',
  selectedCodexCollaborationMode: 'plan',
  _providerSessionId: 'thread-1',
  acpAgentId: 'grok-build',
  selectedAcpModeId: 'acp-mode',
  selectedAcpContextWindow: 200_000,
  openCodeAgentId: 'build',
  cursorModelParams: { thinking: 'on' },
  dshPreset: 'workspace-write',
}

const SELECTIONS = { defaults: {}, chosen: CHOSEN } satisfies Record<string, SessionPatch>

/** Turn flags are independent: a form can be queued, a first turn can be a review. */
const TURNS: Record<string, Partial<SessionTurnOptions>> = {
  next: {},
  first: { firstTurn: true },
  queued: { queued: true },
  'queued form': { queued: true, inputRequest: { requestId: 'form-1', values: { note: 'x' } } },
  review: { turnKind: 'review', reviewTarget: { type: 'uncommittedChanges' } },
}

function seed(path: string, harness: HarnessId, patch: SessionPatch) {
  const project = {
    ...createDefaultProjectState(),
    codexModels: CODEX_MODELS,
    sandboxInfo: { enabled: true, autoAllowBash: true },
    slashCommands: ['skill-a', 'skill-b'].map((name) => ({ name, description: '', argumentHint: '', isSkill: true })),
    _activeSessionId: SID,
    _sessions: { [SID]: { ...createDefaultPerSessionState(), ...patch, sessionProvider: harness, preferredProvider: harness } },
  }
  useChatStore.setState({ projectSessions: { [path]: project }, activeProject: path, remoteSessions: {}, disabledSkills: ['skill-b'] })
}

beforeEach(() => {
  createSession.mockReset().mockImplementation(async (_connectionId: string, input: { selections?: { sessionId?: string } }) =>
    ({ sessionId: input.selections?.sessionId ?? 'node-new', title: null, lastActiveAt: '', messageCount: 0 }))
})

describe('sessionTurnRequest payload per harness', () => {
  for (const harness of HARNESSES) {
    for (const [location, path] of Object.entries(LOCATIONS)) {
      for (const [selection, patch] of Object.entries(SELECTIONS)) {
        for (const [turnName, flags] of Object.entries(TURNS)) {
          it(`${harness} · ${location} · ${selection} · ${turnName}`, () => {
            seed(path, harness, patch)
            const request = sessionTurnRequest(useChatStore.getState(), path, SID, { text: 'hi', clientMessageId: 'u1', ...flags })
            expect(request).toMatchSnapshot()
          })
        }
      }
    }
  }

  it('codex activation replay keeps the earlier choices and sends the live thread id', () => {
    const path = LOCATIONS.local
    seed(path, 'codex', CHOSEN)
    const choices = useChatStore.getState().projectSessions[path]._sessions[SID]
    seed(path, 'codex', { ...CHOSEN, selectedCodexModel: 'gpt-catalog-default', selectedCodexServiceTier: null, _providerSessionId: 'thread-2' })
    const request = sessionTurnRequest(useChatStore.getState(), path, SID, { text: 'hi', clientMessageId: 'u1' }, choices)
    expect(request).toMatchObject({ model: 'gpt-picked', serviceTier: 'priority', threadId: 'thread-2' })
    expect(request).toMatchSnapshot()
  })
})

describe('createSession settings per harness', () => {
  for (const harness of HARNESSES) {
    for (const [location, path] of Object.entries(LOCATIONS)) {
      for (const [selection, patch] of Object.entries(SELECTIONS)) {
        it(`${harness} · ${location} · ${selection}`, async () => {
          seed(path, harness, patch)
          const scope = createSendWriteScope(useChatStore.setState, useChatStore.getState, path)
          await ensureHostSession(useChatStore.setState, useChatStore.getState, path, scope)
          expect(createSession).toHaveBeenCalledTimes(1)
          expect(createSession.mock.calls[0]).toMatchSnapshot()
        })
      }
    }
  }
})
