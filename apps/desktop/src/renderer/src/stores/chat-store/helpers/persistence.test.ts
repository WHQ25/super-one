/** @vitest-environment jsdom */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { ChatMessage } from '@superone/shared/agent-types'

const loadSessionState = vi.fn()

vi.mock('@/stores/app', () => ({ useAppStore: { getState: () => ({ sandboxCapability: null }) } }))
vi.mock('@/stores/activity-view-state', () => ({ useActivityViewStateStore: { getState: () => ({}) } }))
vi.stubGlobal('window', {
  agent: new Proxy({}, { get: () => () => Promise.resolve(undefined) }),
  app: {
    loadSessionState,
    trace: vi.fn(),
    getAppSettings: vi.fn().mockResolvedValue({ agentPreference: {} }),
  },
})

await import('../index')
const { createDefaultPerSessionState, createDefaultProjectState } = await import('../defaults')
const {
  _ensureSessionHydrated,
  _getEffectiveSessionId,
  _getSessionCwd,
  _getSessionGitBranch,
  _hydrateSessionState,
  _isLocalCodexSessionId,
  _mergeHydratedSessionState,
  _mergePersistedMessages,
  _mergePersistedSessionState,
} = await import('./persistence')

function makeMessage(id: string, role: 'user' | 'assistant'): ChatMessage {
  return { id, role, status: 'complete', content: [], createdAt: '', providerId: 'claude' }
}

beforeEach(() => {
  loadSessionState.mockReset()
})

describe('small pure helpers', () => {
  it('_getEffectiveSessionId returns the project active session id', () => {
    const proj = createDefaultProjectState()
    proj._activeSessionId = 'sid-1'
    expect(_getEffectiveSessionId(proj)).toBe('sid-1')
  })

  it('_isLocalCodexSessionId only matches legacy codex_local_ session keys', () => {
    expect(_isLocalCodexSessionId('codex_local_abc_def')).toBe(true)
    expect(_isLocalCodexSessionId(crypto.randomUUID())).toBe(false)
    expect(_isLocalCodexSessionId('codex-remote-123')).toBe(false)
  })

  it('_getSessionGitBranch returns the session git branch or undefined', () => {
    const sess = { ...createDefaultPerSessionState(), _gitBranch: 'main' }
    expect(_getSessionGitBranch(sess)).toBe('main')
    expect(_getSessionGitBranch(createDefaultPerSessionState())).toBeUndefined()
  })

  it('_getSessionCwd returns the worktree path when present and not removed, else projectPath', () => {
    expect(_getSessionCwd('/p', null)).toBe('/p')
    expect(_getSessionCwd('/p', { _worktreePath: '/wt', _worktreeRemoved: false })).toBe('/wt')
    expect(_getSessionCwd('/p', { _worktreePath: '/wt', _worktreeRemoved: true })).toBe('/p')
    expect(_getSessionCwd('/p', { _worktreePath: null, _worktreeRemoved: false })).toBe('/p')
  })
})

describe('_mergePersistedMessages', () => {
  it('replaces saved entries with runtime entries by id', () => {
    const saved = [makeMessage('a', 'user'), makeMessage('b', 'assistant')]
    const runtime = [{ ...makeMessage('b', 'assistant'), status: 'streaming' as const }]
    const merged = _mergePersistedMessages(saved, runtime)
    expect(merged.map((m) => m.id)).toEqual(['a', 'b'])
    expect(merged[1].status).toBe('streaming')
  })

  it('appends runtime-only entries that the saved transcript does not contain', () => {
    const saved = [makeMessage('a', 'user')]
    const runtime = [makeMessage('b', 'assistant')]
    expect(_mergePersistedMessages(saved, runtime).map((m) => m.id)).toEqual(['a', 'b'])
  })

  it('does not introduce duplicates when saved + runtime share ids', () => {
    const saved = [makeMessage('a', 'user'), makeMessage('b', 'assistant')]
    const runtime = [makeMessage('a', 'user'), makeMessage('b', 'assistant')]
    expect(_mergePersistedMessages(saved, runtime).map((m) => m.id)).toEqual(['a', 'b'])
  })
})

describe('_mergePersistedSessionState', () => {
  it('seeds title + provider + cost + contextTokens from persisted state when session has none', () => {
    const sess = createDefaultPerSessionState()
    const saved = {
      messages: [],
      totalCostUsd: 0.5,
      contextTokens: 1234,
      isWorktree: false,
      gitBranch: null,
      worktreePath: null,
      provider: 'codex',
      title: 'persisted title',
    }
    const merged = _mergePersistedSessionState(sess, saved as never)
    expect(merged._title).toBe('persisted title')
    expect(merged.totalCostUsd).toBe(0.5)
    expect(merged.contextTokens).toBe(1234)
    expect(merged.sessionProvider).toBe('codex')
    expect(merged.preferredProvider).toBe('codex')
    expect(merged._historyHydrated).toBe(true)
  })

  it('restores the provider session id for an empty voice-only session', () => {
    const merged = _mergePersistedSessionState(createDefaultPerSessionState(), {
      messages: [],
      totalCostUsd: 0,
      contextTokens: 0,
      isWorktree: false,
      gitBranch: null,
      worktreePath: null,
      provider: 'codex',
      providerSessionId: 'thread-realtime',
    })

    expect(merged.sessionProvider).toBe('codex')
    expect(merged._providerSessionId).toBe('thread-realtime')
  })

  it('rebuilds videoGenStatuses from persisted tool results on cold restore', () => {
    const sess = createDefaultPerSessionState()
    const saved = {
      messages: [{
        id: 'a1', role: 'assistant' as const, status: 'complete' as const, createdAt: '', providerId: 'claude',
        content: [
          { type: 'tool_use' as const, toolUseId: 's1', toolName: 'mcp__superone__media_generate_video', input: JSON.stringify({ prompt: 'wave' }) },
          { type: 'tool_result' as const, toolUseId: 's1', summary: JSON.stringify({ status: 'submitted', generationId: 'g1' }) },
          { type: 'tool_use' as const, toolUseId: 'p1', toolName: 'mcp__superone__media_video_status', input: JSON.stringify({ generation_id: 'g1' }) },
          { type: 'tool_result' as const, toolUseId: 'p1', summary: JSON.stringify({ status: 'generated', generationId: 'g1', savedPaths: ['/tmp/v.mp4'] }) },
        ],
      }],
      totalCostUsd: 0, contextTokens: 0,
      isWorktree: false, gitBranch: null, worktreePath: null, provider: 'claude',
    }
    const merged = _mergePersistedSessionState(sess, saved as never)
    expect(merged.videoGenStatuses.g1).toMatchObject({
      status: 'generated',
      generationId: 'g1',
      prompt: 'wave',
      savedPaths: ['/tmp/v.mp4'],
    })
  })

  it('keeps the live session title/totalCostUsd when it is non-null/greater', () => {
    const sess = { ...createDefaultPerSessionState(), _title: 'live title', totalCostUsd: 1.0 }
    const merged = _mergePersistedSessionState(sess, {
      messages: [], totalCostUsd: 0.5, contextTokens: 0,
      isWorktree: false, gitBranch: null, worktreePath: null,
      provider: 'claude', title: 'persisted',
    } as never)
    expect(merged._title).toBe('live title')
    expect(merged.totalCostUsd).toBe(1.0)
  })

  it('preserves session.sessionProvider AND session.preferredProvider when sessionProvider was already set', () => {
    const sess = { ...createDefaultPerSessionState(), sessionProvider: 'claude' as const, preferredProvider: 'codex' as const }
    const merged = _mergePersistedSessionState(sess, {
      messages: [], totalCostUsd: 0, contextTokens: 0,
      isWorktree: false, gitBranch: null, worktreePath: null,
      provider: 'codex',
    } as never)
    expect(merged.sessionProvider).toBe('claude')
    expect(merged.preferredProvider).toBe('codex')
  })

  it('derives lastAssistantMessageId from the merged messages', () => {
    const sess = createDefaultPerSessionState()
    const saved = {
      messages: [makeMessage('u1', 'user'), makeMessage('a1', 'assistant'), makeMessage('a2', 'assistant')],
      totalCostUsd: 0, contextTokens: 0,
      isWorktree: false, gitBranch: null, worktreePath: null,
      provider: 'claude',
    }
    const merged = _mergePersistedSessionState(sess, saved as never)
    expect(merged.lastAssistantMessageId).toBe('a2')
  })
  it('restores selectedModel/selectedEffort so switchSession does not reapply catalog defaults', () => {
    const sess = createDefaultPerSessionState()
    expect(sess.selectedModel).toBe('')
    const saved = {
      messages: [], totalCostUsd: 0, contextTokens: 0,
      isWorktree: false, gitBranch: null, worktreePath: null, provider: 'claude',
      selectedModel: 'claude-opus-5',
      selectedEffort: 'high',
    }
    const merged = _mergePersistedSessionState(sess, saved as never)
    expect(merged.selectedModel).toBe('claude-opus-5')
    expect(merged.selectedEffort).toBe('high')
    // Without these flags _reapplyAgentDefaultsToSessions would clobber the pick.
    expect(merged.modelUserChosen).toBe(true)
    expect(merged.effortUserChosen).toBe(true)
  })

  it('keeps a live user pick made while hydration was in flight', () => {
    const sess = { ...createDefaultPerSessionState(), selectedModel: 'chosen-live', modelUserChosen: true }
    const saved = {
      messages: [], totalCostUsd: 0, contextTokens: 0,
      isWorktree: false, gitBranch: null, worktreePath: null, provider: 'claude',
      selectedModel: 'claude-opus-5',
    }
    const merged = _mergePersistedSessionState(sess, saved as never)
    expect(merged.selectedModel).toBe('chosen-live')
  })

  it('leaves model/effort untouched when the persisted row has none', () => {
    const sess = createDefaultPerSessionState()
    const saved = { messages: [], totalCostUsd: 0, contextTokens: 0,
      isWorktree: false, gitBranch: null, worktreePath: null, provider: 'claude', }
    const merged = _mergePersistedSessionState(sess, saved as never)
    expect(merged.selectedModel).toBe('')
    expect(merged.modelUserChosen).toBe(false)
    expect(merged.effortUserChosen).toBe(false)
  })
  it('rebuilds codexUsageSnapshot + contextWindow from persisted messages', () => {
    const sess = createDefaultPerSessionState()
    const saved = {
      messages: [{
        id: 'a1', role: 'assistant' as const, status: 'complete' as const, createdAt: '', providerId: 'codex',
        content: [],
        metadata: {
          codex: {
            threadId: 't1',
            usage: {
              totalInputTokens: 1320345, totalCachedInputTokens: 1155840, totalOutputTokens: 4200,
              lastInputTokens: 70105, lastCachedInputTokens: 69376, lastOutputTokens: 300,
              reasoningOutputTokens: 120, contextWindow: 258400,
            },
            items: [],
          },
        },
      }],
      totalCostUsd: 0, contextTokens: 0,
      isWorktree: false, gitBranch: null, worktreePath: null, provider: 'codex',
    }
    const merged = _mergePersistedSessionState(sess, saved as never)
    expect(merged.codexUsageSnapshot?.lastCachedInputTokens).toBe(69376)
    expect(merged.contextWindow).toBe(258400)
  })

  it('keeps a live codex usage snapshot over the persisted one', () => {
    const live = {
      totalInputTokens: 1, totalCachedInputTokens: 0, totalOutputTokens: 1,
      lastInputTokens: 1, lastCachedInputTokens: 0, lastOutputTokens: 1,
      reasoningOutputTokens: 0, contextWindow: 999,
    }
    const sess = { ...createDefaultPerSessionState(), codexUsageSnapshot: live, contextWindow: 999 }
    const saved = {
      messages: [], totalCostUsd: 0, contextTokens: 0,
      isWorktree: false, gitBranch: null, worktreePath: null, provider: 'codex',
    }
    const merged = _mergePersistedSessionState(sess as never, saved as never)
    expect(merged.contextWindow).toBe(999)
    expect(merged.codexUsageSnapshot).toBe(live)
  })
})

describe('_mergeHydratedSessionState', () => {
  it('re-derives todo list from merged messages instead of resurrecting a live null clear', () => {
    const openTodo = {
      id: 'todo-old',
      type: 'todo_list' as const,
      items: [{ text: 'open', completed: false }],
    }
    const completedOnly = {
      id: 'todo-done',
      type: 'todo_list' as const,
      items: [{ text: 'done', completed: true }],
    }
    // Live stream already cleared the open list (all completed → null).
    const liveMsg = {
      ...makeMessage('a-live', 'assistant'),
      metadata: { codex: { threadId: null, usage: null, items: [completedOnly] } },
    }
    const hydratedMsg = {
      ...makeMessage('a-hydrated', 'assistant'),
      metadata: { codex: { threadId: null, usage: null, items: [openTodo] } },
    }
    const session = {
      ...createDefaultPerSessionState(),
      messages: [liveMsg],
      _latestCodexTodoList: null,
    }
    const hydrated = {
      ...createDefaultPerSessionState(),
      messages: [hydratedMsg],
      _latestCodexTodoList: openTodo,
      _historyHydrated: true,
    }
    const merged = _mergeHydratedSessionState(session, hydrated)
    // Newest message is live completed-only → derived null, not the hydrated open list.
    expect(merged._latestCodexTodoList).toBeNull()
  })
  it('carries the persisted model/effort through the concurrent-modification merge path', () => {
    const stub = createDefaultPerSessionState()
    const hydrated = {
      ...createDefaultPerSessionState(),
      selectedModel: 'claude-opus-5',
      selectedEffort: 'high' as const,
      modelUserChosen: true,
      effortUserChosen: true,
      _historyHydrated: true,
    }
    const merged = _mergeHydratedSessionState(stub, hydrated)
    expect(merged.selectedModel).toBe('claude-opus-5')
    expect(merged.selectedEffort).toBe('high')
    expect(merged.modelUserChosen).toBe(true)
  })

})

describe('_ensureSessionHydrated', () => {
  it('returns the session unchanged when already hydrated', async () => {
    const sess = { ...createDefaultPerSessionState(), _historyHydrated: true }
    expect(await _ensureSessionHydrated('sid', sess)).toBe(sess)
    expect(loadSessionState).not.toHaveBeenCalled()
  })

  it('returns the session with _historyHydrated:true when loadSessionState resolves to null', async () => {
    loadSessionState.mockResolvedValueOnce(null)
    const sess = { ...createDefaultPerSessionState(), _historyHydrated: false }
    const result = await _ensureSessionHydrated('sid', sess)
    expect(result?._historyHydrated).toBe(true)
    expect(result?.messages).toEqual([])
  })

  it('merges saved state into the session when loadSessionState resolves with a record', async () => {
    loadSessionState.mockResolvedValueOnce({
      messages: [makeMessage('a1', 'assistant')],
      totalCostUsd: 0.25, contextTokens: 100,
      isWorktree: false, gitBranch: 'main', worktreePath: null,
      provider: 'claude', title: 'recalled',
    })
    const sess = { ...createDefaultPerSessionState(), _historyHydrated: false }
    const result = await _ensureSessionHydrated('sid', sess)
    expect(result?._historyHydrated).toBe(true)
    expect(result?._title).toBe('recalled')
    expect(result?.lastAssistantMessageId).toBe('a1')
  })

  it('returns null when loadSessionState rejects', async () => {
    loadSessionState.mockRejectedValueOnce(new Error('disk error'))
    const sess = { ...createDefaultPerSessionState(), _historyHydrated: false }
    expect(await _ensureSessionHydrated('sid', sess)).toBeNull()
  })
})

describe('_hydrateSessionState', () => {
  async function flushMicrotasks(): Promise<void> {
    // _hydrateSessionState chains .then().catch() — drain the queue.
    for (let i = 0; i < 5; i++) await Promise.resolve()
  }

  it('skips set when the project/session is missing or already hydrated', async () => {
    loadSessionState.mockResolvedValueOnce({
      messages: [], totalCostUsd: 0, contextTokens: 0,
      isWorktree: false, gitBranch: null, worktreePath: null, provider: 'claude',
    })
    const captured: unknown[] = []
    const set = (updater: (s: never) => unknown) => {
      captured.push(updater({ projectSessions: {} } as never))
    }
    _hydrateSessionState(set as never, '/no-project', 'sid')
    await flushMicrotasks()
    expect(captured).toEqual([{}])
  })

  it('produces a state patch merging persisted into the target session when saved exists', async () => {
    loadSessionState.mockResolvedValueOnce({
      messages: [makeMessage('a1', 'assistant')],
      totalCostUsd: 0, contextTokens: 0,
      isWorktree: false, gitBranch: null, worktreePath: null, provider: 'claude', title: 't',
    })

    const projState = createDefaultProjectState()
    const stub = createDefaultPerSessionState()
    // Default sessions are flagged hydrated; _hydrateSessionState only writes
    // when the target hasn't been hydrated yet.
    stub._historyHydrated = false
    projState._sessions = { 'sid-1': stub }
    const captured: Array<{ projectSessions?: Record<string, { _sessions: Record<string, { _title: string | null; _historyHydrated: boolean }> }> }> = []
    const set = (updater: (s: never) => unknown) => {
      captured.push(updater({ projectSessions: { '/p1': projState } } as never) as never)
    }
    _hydrateSessionState(set as never, '/p1', 'sid-1')
    await flushMicrotasks()

    expect(captured.length).toBe(1)
    const merged = captured[0].projectSessions?.['/p1']?._sessions['sid-1']
    expect(merged?._title).toBe('t')
    expect(merged?._historyHydrated).toBe(true)
  })
})
