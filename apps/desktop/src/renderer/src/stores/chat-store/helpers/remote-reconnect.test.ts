/** @vitest-environment jsdom */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { ChatStore, PerSessionState } from '../types'

const getSession = vi.fn()
const openRemoteSession = vi.fn()

vi.stubGlobal('window', {
  environment: { getSession, openRemoteSession },
  app: new Proxy({}, { get: () => () => Promise.resolve(undefined) }),
})

/**
 * Defaults are stubbed to keep this file out of the chat-store index ↔ selectors
 * init cycle (same isolation trick as remote-session-ops.test.ts). Everything
 * under test — hydrate and the snapshot replace — stays real.
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

const { resyncRemoteSession } = await import('./remote-reconnect')

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
  openRemoteSession.mockReset().mockResolvedValue({ messages: [], state: {}, before: null, cursor: { sequence: '0', epoch: 'e', version: 0 } })
})

describe('remote session resync', () => {
  it('recovers the reply produced while the stream had a gap and settles the session idle', async () => {
    getSession.mockResolvedValue({
      sessionId: SID,
      status: 'completed',
      harnessId: 'claude',
      transcript: [],
    })
    openRemoteSession.mockResolvedValue({
      messages: [
        { id: 'node-u1', role: 'user', status: 'complete', content: [{ type: 'text', text: 'run the build' }], createdAt: new Date(1_000).toISOString() },
        {
          id: 'node-a1',
          role: 'assistant',
          status: 'complete',
          content: [{ type: 'text', text: 'build finished while you were offline' }],
          createdAt: new Date(2_000).toISOString(),
        },
      ],
      state: { status: 'idle', awaitingAssistantReply: false },
      before: null,
      cursor: { sequence: '9', epoch: 'e', version: 9 },
    })

    const store = makeStore({
      [PROJECT]: remoteProject(
        { [SID]: session({ messages: [userMessage], status: 'streaming', awaitingAssistantReply: true }) },
        SID,
      ),
    })

    await resyncRemoteSession(PROJECT, SID, store.set, store.get)

    const after = store.get().projectSessions[PROJECT]!._sessions[SID]!
    const texts = after.messages.flatMap((m) =>
      m.content.filter((b) => b.type === 'text').map((b) => (b as { text: string }).text),
    )
    expect(texts).toContain('build finished while you were offline')
    // The node snapshot is authoritative — stale in-memory "streaming" must not win.
    expect(after.status).toBe('idle')
    expect(after.awaitingAssistantReply).toBe(false)
    // Main follows it again from the snapshot.
    expect(openRemoteSession).toHaveBeenCalledWith(CONN, expect.objectContaining({ sessionId: SID, projectPath: PROJECT }))
  })

  it('surfaces a permission request raised during the gap even though memory looked idle', async () => {
    getSession.mockResolvedValue({
      sessionId: SID,
      status: 'streaming',
      harnessId: 'claude',
    })
    openRemoteSession.mockResolvedValue({
      messages: [],
      state: { status: 'streaming', awaitingAssistantReply: true, pendingPermissions: [{ requestId: 'perm-1', toolName: 'Bash', toolUseId: 'tu-1', input: { command: 'ls' } }] },
      before: null,
      cursor: { sequence: '9', epoch: 'e', version: 9 },
    })

    const store = makeStore({
      [PROJECT]: remoteProject({ [SID]: session({ status: 'idle' }) }, SID),
    })

    await resyncRemoteSession(PROJECT, SID, store.set, store.get)

    const after = store.get().projectSessions[PROJECT]!._sessions[SID]!
    expect(after.pendingPermissions.map((p) => p.requestId)).toEqual(['perm-1'])
  })

  it('keeps renderer-only composer state across the resync', async () => {
    getSession.mockResolvedValue({ sessionId: SID, status: 'completed', harnessId: 'claude' })

    const store = makeStore({
      [PROJECT]: remoteProject(
        { [SID]: session({ draftText: 'half typed', status: 'streaming' }) },
        SID,
      ),
    })

    await resyncRemoteSession(PROJECT, SID, store.set, store.get)

    expect(store.get().projectSessions[PROJECT]!._sessions[SID]!.draftText).toBe('half typed')
  })

  it('leaves a draft session that does not exist on the node untouched', async () => {
    getSession.mockResolvedValue(null)

    const store = makeStore({
      [PROJECT]: remoteProject({ [SID]: session({ draftText: 'unsent' }) }, SID),
    })

    await resyncRemoteSession(PROJECT, SID, store.set, store.get)

    expect(store.get().projectSessions[PROJECT]!._sessions[SID]!.draftText).toBe('unsent')
    expect(openRemoteSession).not.toHaveBeenCalled()
  })

  it('ignores a session this window does not hold', async () => {
    const store = makeStore({ [PROJECT]: remoteProject({}, null) })

    await resyncRemoteSession(PROJECT, SID, store.set, store.get)

    expect(getSession).not.toHaveBeenCalled()
  })
})
