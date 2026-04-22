/** @vitest-environment jsdom */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { AgentEvent, ChatMessage } from '../../../shared/agent-types'

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
    }),
  },
}))

const mockGetLiveSnapshots = vi.fn()

const mockWindowAgent = {
  getLiveSnapshots: mockGetLiveSnapshots,
  parkSession: vi.fn().mockResolvedValue(undefined),
  activateSession: vi.fn().mockResolvedValue(undefined),
  sendMessage: vi.fn().mockResolvedValue(undefined),
  prewarm: vi.fn().mockResolvedValue(undefined),
}

const mockWindowApp = {
  saveSessionState: vi.fn().mockResolvedValue(undefined),
  listSessionsForFolder: vi.fn().mockResolvedValue([]),
  readProjectAdditionalDirs: vi.fn().mockResolvedValue([]),
  getAppSettings: vi.fn().mockResolvedValue({
    analyticsEnabled: true,
    agentPreference: {
      claude: { defaultModel: '', defaultEffort: '', defaultPermissionMode: '', defaultSandboxMode: '' },
      codex: { defaultModel: '', defaultReasoningEffort: '' },
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

const { useChatStore, mergeMessagesByMaxSeq } = await import('./chat')

const TEST_EPOCH = 1

function makeMessage(id: string, text: string, seq?: number, epoch: number = TEST_EPOCH): ChatMessage {
  return {
    id,
    role: 'assistant',
    status: 'streaming',
    content: text ? [{ type: 'text', text }] : [],
    createdAt: '',
    providerId: 'claude',
    ...(seq !== undefined ? { _lastAppliedSeq: seq, _lastAppliedEpoch: epoch } : {}),
  }
}

function delta(messageId: string, text: string, seq?: number, epoch: number = TEST_EPOCH): AgentEvent {
  return {
    type: 'content_delta',
    messageId,
    delta: { type: 'text', text },
    projectPath: '/p',
    sessionId: 'sid-1',
    ...(seq !== undefined ? { seq, epoch } : {}),
  } as AgentEvent
}

function resetStore() {
  useChatStore.setState({ projectSessions: {}, activeProject: null })
}

beforeEach(() => {
  mockGetLiveSnapshots.mockReset()
  resetStore()
})

describe('content_delta seq deduplication', () => {
  it('ignores a content_delta whose seq is <= message._lastAppliedSeq', () => {
    const msg = makeMessage('m1', 'abc', 5)
    useChatStore.setState({
      activeProject: '/p',
      projectSessions: {
        '/p': {
          _activeSessionId: 'sid-1',
          _sessions: {
            'sid-1': {
              ...createEmptySession(),
              messages: [msg],
            },
          },
          ...projectExtras(),
        } as never,
      },
    })

    useChatStore.getState().handleAgentEvent(delta('m1', 'XYZ', 3))

    const m = useChatStore.getState().projectSessions['/p']._sessions['sid-1'].messages[0]
    expect(m.content).toEqual([{ type: 'text', text: 'abc' }])
    expect(m._lastAppliedSeq).toBe(5)
  })

  it('applies a content_delta whose seq is > message._lastAppliedSeq and advances the seq', () => {
    const msg = makeMessage('m1', 'abc', 5)
    useChatStore.setState({
      activeProject: '/p',
      projectSessions: {
        '/p': {
          _activeSessionId: 'sid-1',
          _sessions: {
            'sid-1': {
              ...createEmptySession(),
              messages: [msg],
            },
          },
          ...projectExtras(),
        } as never,
      },
    })

    useChatStore.getState().handleAgentEvent(delta('m1', 'd', 6))

    const m = useChatStore.getState().projectSessions['/p']._sessions['sid-1'].messages[0]
    expect(m.content).toEqual([{ type: 'text', text: 'abcd' }])
    expect(m._lastAppliedSeq).toBe(6)
  })

  it('applies deltas with no seq (legacy) without dedup', () => {
    const msg = makeMessage('m1', 'abc')
    useChatStore.setState({
      activeProject: '/p',
      projectSessions: {
        '/p': {
          _activeSessionId: 'sid-1',
          _sessions: {
            'sid-1': { ...createEmptySession(), messages: [msg] },
          },
          ...projectExtras(),
        } as never,
      },
    })

    useChatStore.getState().handleAgentEvent(delta('m1', 'd'))

    const m = useChatStore.getState().projectSessions['/p']._sessions['sid-1'].messages[0]
    expect(m.content).toEqual([{ type: 'text', text: 'abcd' }])
  })
})

describe('mergeMessagesByMaxSeq', () => {
  it('prefers the side with the larger _lastAppliedSeq per message id', () => {
    const snap = [makeMessage('m1', 'ABCDEF', 10), makeMessage('m2', 'snap', 3)]
    const existing = [makeMessage('m1', 'ABCDEF+X', 12), makeMessage('m3', 'only-local', 99)]

    const merged = mergeMessagesByMaxSeq(snap, existing)

    expect(merged.map((m) => m.id)).toEqual(['m1', 'm2', 'm3'])
    expect(merged[0]._lastAppliedSeq).toBe(12)
    expect(merged[0].content).toEqual([{ type: 'text', text: 'ABCDEF+X' }])
    expect(merged[1]._lastAppliedSeq).toBe(3)
    expect(merged[2]._lastAppliedSeq).toBe(99)
  })

  it('uses snapshot when seqs are both undefined', () => {
    const snap = [makeMessage('m1', 'snap')]
    const existing = [makeMessage('m1', 'local')]
    const merged = mergeMessagesByMaxSeq(snap, existing)
    expect(merged[0].content).toEqual([{ type: 'text', text: 'snap' }])
  })
})

function makeSnapshotEntry(overrides: Partial<{
  sid: string
  projectPath: string
  isActive: boolean
  isStreaming: boolean
  harnessId: 'claude' | 'codex'
  permissionMode: string
  messages: ChatMessage[]
  currentMessageId: string | null
  totalCostUsd: number
  contextTokens: number
  pendingInteractions: AgentEvent[]
  replayEvents: AgentEvent[]
}> = {}) {
  return {
    sid: overrides.sid ?? 'sid-1',
    projectPath: overrides.projectPath ?? '/p',
    isActive: overrides.isActive ?? true,
    isStreaming: overrides.isStreaming ?? true,
    permissionMode: overrides.permissionMode ?? 'acceptEdits',
    sandboxInfo: { enabled: true, autoAllowBash: false },
    snapshot: {
      id: overrides.sid ?? 'sid-1',
      projectPath: overrides.projectPath ?? '/p',
      cwd: overrides.projectPath ?? '/p',
      providerId: 'claude',
      harnessId: overrides.harnessId ?? 'claude',
      status: 'streaming',
      providerSessionId: null,
      currentMessageId: overrides.currentMessageId ?? 'm1',
      createdAt: 0,
      lastUserMessageAt: null,
      messages: overrides.messages ?? [],
      totalCostUsd: overrides.totalCostUsd ?? 0,
      contextTokens: overrides.contextTokens ?? 0,
      title: null,
      isWorktree: false,
      worktreePath: null,
      gitBranch: null,
      worktreeMissing: false,
    },
    pendingInteractions: overrides.pendingInteractions ?? [],
    replayEvents: overrides.replayEvents ?? [],
  }
}

describe('syncLiveSnapshots', () => {
  it('hydrates store from live snapshots and replays pending interactions', async () => {
    const snapshotMsg = makeMessage('m1', 'streamed so far', 42)
    mockGetLiveSnapshots.mockResolvedValueOnce([
      makeSnapshotEntry({ messages: [snapshotMsg], totalCostUsd: 0.5, contextTokens: 100 }),
    ])

    await useChatStore.getState().syncLiveSnapshots()

    const project = useChatStore.getState().projectSessions['/p']
    expect(project._activeSessionId).toBe('sid-1')
    const session = project._sessions['sid-1']
    expect(session.messages).toHaveLength(1)
    expect(session.messages[0]._lastAppliedSeq).toBe(42)
    expect(session.messages[0].content).toEqual([{ type: 'text', text: 'streamed so far' }])
    expect(session.totalCostUsd).toBe(0.5)
    expect(session.contextTokens).toBe(100)
    expect(session.status).toBe('streaming')
    expect(session.permissionMode).toBe('acceptEdits')
    expect(session.sessionProvider).toBe('claude')
  })

  it('sets status idle when the live session is not streaming', async () => {
    const snapshotMsg = makeMessage('m1', 'done', 42)
    mockGetLiveSnapshots.mockResolvedValueOnce([
      makeSnapshotEntry({ messages: [snapshotMsg], isStreaming: false, currentMessageId: null }),
    ])

    await useChatStore.getState().syncLiveSnapshots()
    const session = useChatStore.getState().projectSessions['/p']._sessions['sid-1']
    expect(session.status).toBe('idle')
  })

  it('resolves _activeSessionId from the entry explicitly marked isActive regardless of iteration order', async () => {
    mockGetLiveSnapshots.mockResolvedValueOnce([
      makeSnapshotEntry({ sid: 'sid-inactive', projectPath: '/p', isActive: false, currentMessageId: null, isStreaming: false }),
      makeSnapshotEntry({ sid: 'sid-active', projectPath: '/p', isActive: true, currentMessageId: null, isStreaming: false }),
    ])

    await useChatStore.getState().syncLiveSnapshots()

    expect(useChatStore.getState().projectSessions['/p']._activeSessionId).toBe('sid-active')
  })

  it('subsequent deltas with seq > snapshot seq are applied on top', async () => {
    const snapshotMsg = makeMessage('m1', 'ABC', 10)
    mockGetLiveSnapshots.mockResolvedValueOnce([
      makeSnapshotEntry({ messages: [snapshotMsg] }),
    ])

    await useChatStore.getState().syncLiveSnapshots()
    useChatStore.getState().handleAgentEvent(delta('m1', 'DEF', 11))

    const msg = useChatStore.getState().projectSessions['/p']._sessions['sid-1'].messages[0]
    expect(msg.content).toEqual([{ type: 'text', text: 'ABCDEF' }])
    expect(msg._lastAppliedSeq).toBe(11)
  })

  it('deltas with seq <= snapshot seq are ignored after hydration', async () => {
    const snapshotMsg = makeMessage('m1', 'AB', 8)
    mockGetLiveSnapshots.mockResolvedValueOnce([
      makeSnapshotEntry({ messages: [snapshotMsg] }),
    ])

    await useChatStore.getState().syncLiveSnapshots()
    useChatStore.getState().handleAgentEvent(delta('m1', 'SHOULD_NOT_APPEAR', 5))

    const msg = useChatStore.getState().projectSessions['/p']._sessions['sid-1'].messages[0]
    expect(msg.content).toEqual([{ type: 'text', text: 'AB' }])
    expect(msg._lastAppliedSeq).toBe(8)
  })

  it('accepts deltas from a new epoch even when seq is low (session re-creation / process restart)', async () => {
    const snapshotMsg = makeMessage('m1', 'AB', 500, 1)
    mockGetLiveSnapshots.mockResolvedValueOnce([
      makeSnapshotEntry({ messages: [snapshotMsg] }),
    ])

    await useChatStore.getState().syncLiveSnapshots()
    useChatStore.getState().handleAgentEvent(delta('m1', 'C', 1, 2))

    const msg = useChatStore.getState().projectSessions['/p']._sessions['sid-1'].messages[0]
    expect(msg.content).toEqual([{ type: 'text', text: 'ABC' }])
    expect(msg._lastAppliedSeq).toBe(1)
    expect(msg._lastAppliedEpoch).toBe(2)
  })

  it('does nothing when getLiveSnapshots returns empty', async () => {
    mockGetLiveSnapshots.mockResolvedValueOnce([])
    await useChatStore.getState().syncLiveSnapshots()
    expect(useChatStore.getState().projectSessions).toEqual({})
  })

  it('swallows IPC errors gracefully', async () => {
    mockGetLiveSnapshots.mockRejectedValueOnce(new Error('boom'))
    await expect(useChatStore.getState().syncLiveSnapshots()).resolves.toBeUndefined()
  })
})

describe('tool_input_delta seq deduplication', () => {
  it('ignores a replayed tool_input_delta with stale (epoch, seq)', () => {
    const toolMsg: ChatMessage = {
      id: 'm1',
      role: 'assistant',
      status: 'streaming',
      createdAt: '',
      providerId: 'claude',
      _lastAppliedSeq: 10,
      _lastAppliedEpoch: TEST_EPOCH,
      content: [
        { type: 'tool_use', toolName: 'Edit', toolUseId: 'tu-1', input: '{"foo":"bar"}' },
      ],
    }
    useChatStore.setState({
      activeProject: '/p',
      projectSessions: {
        '/p': {
          _activeSessionId: 'sid-1',
          _sessions: { 'sid-1': { ...createEmptySession(), messages: [toolMsg] } },
          ...projectExtras(),
        } as never,
      },
    })

    const staleEvent: AgentEvent = {
      type: 'tool_input_delta',
      messageId: 'm1',
      toolUseId: 'tu-1',
      partialJson: ',"hacked":true',
      projectPath: '/p',
      sessionId: 'sid-1',
      seq: 5,
      epoch: TEST_EPOCH,
    } as AgentEvent

    useChatStore.getState().handleAgentEvent(staleEvent)

    const block = useChatStore.getState().projectSessions['/p']._sessions['sid-1'].messages[0].content[0]
    expect(block.type === 'tool_use' ? block.input : '').toBe('{"foo":"bar"}')
  })
})

function createEmptySession() {
  return {
    cwd: '/p',
    messages: [] as ChatMessage[],
    status: 'idle' as const,
    awaitingAssistantReply: false,
    session: null,
    sessionProvider: null,
    totalCostUsd: 0,
    contextTokens: 0,
    contextWindow: null,
    detailedUsage: null,
    subagentTokens: {},
    taskProgress: {},
    streamingTokens: { input: 0, output: 0 },
    codexUsageSnapshot: null,
    codexTurnLastUsage: null,
    selectedModel: '',
    selectedEffort: undefined,
    modelUserChosen: false,
    effortUserChosen: false,
    selectedCodexModel: '',
    selectedCodexReasoningEffort: undefined,
    codexModelUserChosen: false,
    codexReasoningEffortUserChosen: false,
    selectedCodexPermissionPreset: 'default' as const,
    selectedCodexCollaborationMode: 'default' as const,
    codexPlanRejectHintActive: false,
    chatInputFocusNonce: 0,
    preferredProvider: 'claude' as const,
    draftText: '',
    promptSuggestion: null,
    attachments: [],
    mentions: [],
    pendingPermissions: [],
    permissionMode: 'default' as const,
    pendingQuestion: null,
    pendingPlanApproval: null,
    planApprovalOutcome: null,
    slashCommandOutput: null,
    _pendingSlashCommand: '',
    todos: {},
    showTodos: false,
    _todosUserDismissed: false,
    _nextTodoId: 1,
    isCompacting: false,
    rateLimitInfo: null,
    _worktreeBaseBranch: null,
    _worktreePath: null,
    _worktreeRemoved: false,
    additionalDirs: [],
    apiRetry: null,
    lastEventAt: 0,
    queuedMessages: [],
    activeCodexMessageId: null,
    lastAssistantMessageId: null,
    miniAppContexts: {},
    _historyHydrated: true,
  }
}

function projectExtras() {
  return {
    slashCommands: [],
    _projectSkills: [],
    _projectCommands: [],
    agents: [],
    homedir: '',
    sandboxInfo: { enabled: true, autoAllowBash: false },
    sessions: [],
    sessionsPage: 0,
    sessionsHasMore: false,
    showHistory: false,
    hasUnseenActivity: false,
    hasPendingInteraction: false,
    unseenCompletedSessions: new Set<string>(),
    codexModels: [],
    codexModelsLoading: false,
    projectAdditionalDirs: [],
    showDirManager: false,
    showReviewPanel: false,
  }
}
