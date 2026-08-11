/** @vitest-environment jsdom */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { ChatStore, PerSessionState } from '../types'

const getSession = vi.fn()
const listSessionMessages = vi.fn()
const resumeRemoteSessionEvents = vi.fn().mockResolvedValue(undefined)

vi.stubGlobal('window', {
  environment: { getSession, listSessionMessages, resumeRemoteSessionEvents },
  app: new Proxy({}, { get: () => () => Promise.resolve(undefined) }),
})

/**
 * Defaults are stubbed to keep this file out of the chat-store index ↔ selectors
 * init cycle (same isolation trick as remote-session-ops.test.ts). Everything
 * under test — _isLiveSession, hydrate, merge, catalog preference — stays real.
 */
const createDefaultPerSessionState = (): PerSessionState =>
  ({
    cwd: '',
    _title: null,
    messages: [],
    status: 'idle',
    sessionProvider: null,
    preferredProvider: 'claude',
    _historyHydrated: true,
    awaitingAssistantReply: false,
    pendingPermissions: [],
    pendingQuestion: null,
    pendingPlanApproval: null,
    draftText: '',
    draftJson: null,
    attachments: [],
    mentions: [],
    browserAnnotations: [],
    queuedMessages: [],
    promptSuggestion: null,
    lastAssistantMessageId: null,
  }) as unknown as PerSessionState

vi.mock('@/stores/chat-store/defaults', () => ({
  createDefaultPerSessionState,
  createDefaultProjectState: () => ({ _activeSessionId: null, _sessions: {} }),
}))

const { rehydrateRemoteSessionsForConnection } = await import('./remote-reconnect')

const CONN = 'node-1'
const PROJECT = `remote:${CONN}:/srv/app`
const SID = 'sess-1'

function session(patch: Partial<PerSessionState> = {}): PerSessionState {
  return { ...createDefaultPerSessionState(), ...patch }
}

/** Minimal store double: real state shape, real set semantics, no zustand. */
function makeStore(projectSessions: ChatStore['projectSessions']): {
  set: (partial: Partial<ChatStore> | ((s: ChatStore) => Partial<ChatStore>)) => void
  get: () => ChatStore
} {
  let state = { projectSessions } as ChatStore
  return {
    set: (partial) => {
      const next = typeof partial === 'function' ? partial(state) : partial
      state = { ...state, ...next }
    },
    get: () => state,
  }
}

function remoteProject(sessions: Record<string, PerSessionState>, activeSessionId: string | null) {
  return { _activeSessionId: activeSessionId, _sessions: sessions } as unknown as
    ChatStore['projectSessions'][string]
}

const userMessage = {
  id: 'local-u1',
  role: 'user' as const,
  status: 'complete' as const,
  content: [{ type: 'text' as const, text: 'run the build' }],
  createdAt: new Date(1_000).toISOString(),
  providerId: 'claude',
}

beforeEach(() => {
  getSession.mockReset()
  listSessionMessages.mockReset().mockResolvedValue({ messages: [] })
  resumeRemoteSessionEvents.mockClear()
})

describe('remote reconnect rehydrate', () => {
  it('recovers the reply produced while the desktop was offline and settles the session idle', async () => {
    getSession.mockResolvedValue({
      sessionId: SID,
      status: 'completed',
      harnessId: 'claude',
      transcript: [],
    })
    listSessionMessages.mockResolvedValue({
      messages: [
        { id: 'node-u1', role: 'user', text: 'run the build', createdAt: 1_000 },
        {
          id: 'node-a1',
          role: 'assistant',
          content: [{ type: 'text', text: 'build finished while you were offline' }],
          createdAt: 2_000,
        },
      ],
    })

    const store = makeStore({
      [PROJECT]: remoteProject(
        { [SID]: session({ messages: [userMessage], status: 'streaming', awaitingAssistantReply: true }) },
        SID,
      ),
    })

    await rehydrateRemoteSessionsForConnection(CONN, store.set, store.get)

    const after = store.get().projectSessions[PROJECT]!._sessions[SID]!
    const texts = after.messages.flatMap((m) =>
      m.content.filter((b) => b.type === 'text').map((b) => (b as { text: string }).text),
    )
    expect(texts).toContain('build finished while you were offline')
    // Node snapshot is authoritative on reconnect — stale in-memory "streaming" must not win.
    expect(after.status).toBe('idle')
    expect(after.awaitingAssistantReply).toBe(false)
    expect(resumeRemoteSessionEvents).not.toHaveBeenCalled()
  })

  it('re-owns the event drain when the node turn is still running', async () => {
    getSession.mockResolvedValue({
      sessionId: SID,
      status: 'streaming',
      harnessId: 'claude',
      transcript: [],
    })

    const store = makeStore({
      [PROJECT]: remoteProject(
        { [SID]: session({ messages: [userMessage], status: 'streaming', awaitingAssistantReply: true }) },
        SID,
      ),
    })

    await rehydrateRemoteSessionsForConnection(CONN, store.set, store.get)

    expect(resumeRemoteSessionEvents).toHaveBeenCalledWith(
      CONN,
      expect.objectContaining({ sessionId: SID, projectPath: PROJECT }),
    )
    expect(store.get().projectSessions[PROJECT]!._sessions[SID]!.status).toBe('streaming')
  })

  it('surfaces a permission request raised while offline even though memory looked idle', async () => {
    getSession.mockResolvedValue({
      sessionId: SID,
      status: 'streaming',
      harnessId: 'claude',
      transcript: [],
      pendingInteraction: {
        interactionId: 'perm-1',
        kind: 'permission',
        toolName: 'Bash',
        toolUseId: 'tu-1',
        input: { command: 'ls' },
      },
    })

    const store = makeStore({
      [PROJECT]: remoteProject({ [SID]: session({ status: 'idle' }) }, SID),
    })

    await rehydrateRemoteSessionsForConnection(CONN, store.set, store.get)

    const after = store.get().projectSessions[PROJECT]!._sessions[SID]!
    expect(after.pendingPermissions.map((p) => p.requestId)).toEqual(['perm-1'])
    expect(resumeRemoteSessionEvents).toHaveBeenCalled()
  })

  it('keeps renderer-only composer state across the rehydrate', async () => {
    getSession.mockResolvedValue({ sessionId: SID, status: 'completed', harnessId: 'claude' })

    const store = makeStore({
      [PROJECT]: remoteProject(
        { [SID]: session({ draftText: 'half typed', status: 'streaming' }) },
        SID,
      ),
    })

    await rehydrateRemoteSessionsForConnection(CONN, store.set, store.get)

    expect(store.get().projectSessions[PROJECT]!._sessions[SID]!.draftText).toBe('half typed')
  })

  it('leaves a draft session that does not exist on the node untouched', async () => {
    getSession.mockResolvedValue(null)

    const store = makeStore({
      [PROJECT]: remoteProject({ [SID]: session({ draftText: 'unsent' }) }, SID),
    })

    await rehydrateRemoteSessionsForConnection(CONN, store.set, store.get)

    expect(store.get().projectSessions[PROJECT]!._sessions[SID]!.draftText).toBe('unsent')
    expect(listSessionMessages).not.toHaveBeenCalled()
    expect(resumeRemoteSessionEvents).not.toHaveBeenCalled()
  })

  it('ignores sessions belonging to another connection or to local projects', async () => {
    getSession.mockResolvedValue({ sessionId: 'other', status: 'streaming', harnessId: 'claude' })

    const store = makeStore({
      'remote:node-2:/srv/other': remoteProject({ other: session({ status: 'streaming' }) }, 'other'),
      '/Users/me/local': remoteProject({ 'local-1': session({ status: 'streaming' }) }, 'local-1'),
    })

    await rehydrateRemoteSessionsForConnection(CONN, store.set, store.get)

    expect(getSession).not.toHaveBeenCalled()
    expect(resumeRemoteSessionEvents).not.toHaveBeenCalled()
  })

  it('rehydrates a background live session that is not the active tab', async () => {
    getSession.mockResolvedValue({ sessionId: 'bg-1', status: 'streaming', harnessId: 'claude' })

    const store = makeStore({
      [PROJECT]: remoteProject(
        {
          [SID]: session({ status: 'idle' }),
          'bg-1': session({ status: 'streaming', awaitingAssistantReply: true }),
        },
        null,
      ),
    })

    await rehydrateRemoteSessionsForConnection(CONN, store.set, store.get)

    expect(getSession).toHaveBeenCalledWith(CONN, 'bg-1')
    expect(getSession).not.toHaveBeenCalledWith(CONN, SID)
  })

  it('does not abort the whole sweep when one session fails to hydrate', async () => {
    getSession.mockImplementation(async (_conn: string, sessionId: string) => {
      if (sessionId === 'bad') throw new Error('rpc exploded')
      return { sessionId: 'good', status: 'streaming', harnessId: 'claude' }
    })

    const store = makeStore({
      [PROJECT]: remoteProject(
        {
          bad: session({ status: 'streaming' }),
          good: session({ status: 'streaming' }),
        },
        null,
      ),
    })

    await rehydrateRemoteSessionsForConnection(CONN, store.set, store.get)

    expect(resumeRemoteSessionEvents).toHaveBeenCalledWith(
      CONN,
      expect.objectContaining({ sessionId: 'good' }),
    )
  })
})
