/** @vitest-environment jsdom */

import { describe, it, expect, vi, beforeEach } from 'vitest'

/**
 * Isolate remote-session-ops from the chat-store import graph (circular
 * init via remote-session-ops → defaults → types).
 */
const getSession = vi.fn()
const createSession = vi.fn()

const openRemoteSession = vi.fn()

vi.stubGlobal('window', {
  environment: {
    getSession,
    createSession,
    listSessions: vi.fn().mockResolvedValue([]),
    openRemoteSession,
  },
})

vi.mock('@/stores/chat-store/defaults', () => ({
  createDefaultPerSessionState: () => ({
    messages: [],
    status: 'idle',
    sessionProvider: null,
    preferredProvider: 'codex',
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
  }),
}))

const {
  keepRendererOwnedState,
  hydrateRemoteSession,
} = await import('./remote-session-ops')

describe('hydrateRemoteSession: adopting a node session', () => {
  beforeEach(() => {
    getSession.mockReset()
    createSession.mockReset()
    openRemoteSession.mockReset()
    openRemoteSession.mockResolvedValue({ sessionId: 's', state: {}, messages: [], before: null, cursor: { sequence: '0', epoch: 'e', version: 0 } })
  })
  it('preserves ACP and its agent identity instead of coercing remote sessions to Claude', async () => {
    getSession.mockResolvedValueOnce({ sessionId: 'acp-session', harnessId: 'acp', providerId: 'grok', acpAgentId: 'grok-build', status: 'idle', transcript: [], model: 'grok-model', permissionMode: 'auto' })
    const { hydrated } = await hydrateRemoteSession('remote:env-1:/work/app', 'acp-session', null, { adoptSession: true })
    expect(hydrated).toMatchObject({ sessionProvider: 'acp', preferredProvider: 'acp', acpAgentId: 'grok-build', selectedModel: 'grok-model', permissionMode: 'auto' })
  })
  it('adopts the existing Claude node session with all inherited settings and never creates another', async () => {
    getSession.mockResolvedValueOnce({ sessionId: 'host-created', harnessId: 'claude', providerId: 'claude-personal', status: 'idle', transcript: [],
      model: 'sonnet', effort: 'high', permissionMode: 'auto', sandboxMode: 'on', apiProviderId: 'account', cwd: '/work/app/worktree' })
    const { hydrated } = await hydrateRemoteSession('remote:env-1:/work/app', 'host-created', null, { adoptSession: true })
    expect(hydrated).toMatchObject({ sessionProvider: 'claude', preferredProvider: 'claude', hostSessionOwned: true,
      harnessUserChosen: true, modelUserChosen: true, effortUserChosen: true, selectedModel: 'sonnet', selectedEffort: 'high',
      permissionMode: 'auto', sandboxInfo: { enabled: true, autoAllowBash: false }, apiProviderId: 'account', cwd: '/work/app/worktree', _worktreePath: '/work/app/worktree' })
    expect(createSession).not.toHaveBeenCalled()
  })

  it('treats a project-root cwd as the project and keeps the spawn parent', async () => {
    getSession.mockResolvedValueOnce({
      sessionId: 'child', harnessId: 'claude', status: 'idle', transcript: [],
      cwd: '/work/app/', parentSessionId: 'parent',
    })
    const { hydrated } = await hydrateRemoteSession('remote:env-1:/work/app', 'child', null, { adoptSession: true })
    expect(hydrated.cwd).toBe('/work/app/')
    expect(hydrated._worktreePath).toBeNull()
    expect(hydrated._parentSessionId).toBe('parent')
  })

  it('puts a Codex session.load timeline into the voice view', async () => {
    const { useCodexRealtimeViewStore } = await import('@/stores/codex-realtime-view')
    useCodexRealtimeViewStore.setState({ sessions: {} })
    getSession.mockResolvedValueOnce({ sessionId: 'voice', harnessId: 'codex', status: 'idle', transcript: [] })
    openRemoteSession.mockResolvedValueOnce({
      sessionId: 'voice',
      messages: [],
      state: {
        realtimeSegments: [{ id: 'seg-1', realtimeSessionId: 'rt-1', role: 'user', text: 'hello' }],
        realtimeSessionId: 'rt-1',
      },
      restore: { realtimeHasTimeline: true, realtimeThreadMessages: [] },
      before: null,
      cursor: { sequence: '1', epoch: 'e', version: 1 },
    })
    await hydrateRemoteSession('remote:env-1:/work/app', 'voice', null, { adoptSession: true })
    expect(useCodexRealtimeViewStore.getState().sessions.voice).toMatchObject({
      hasTimeline: true,
      loadStatus: 'loaded',
      realtimeSessionId: 'rt-1',
    })
  })

  it('treats a dot-segment project cwd as the project root', async () => {
    getSession.mockResolvedValueOnce({
      sessionId: 'root', harnessId: 'claude', status: 'idle', transcript: [], cwd: '/work/app/.',
    })
    const { hydrated } = await hydrateRemoteSession('remote:env-1:/work/app', 'root', null, { adoptSession: true })
    expect(hydrated._worktreePath).toBeNull()
  })

  it('settles an empty Codex session.load so the voice view stops loading', async () => {
    const { useCodexRealtimeViewStore } = await import('@/stores/codex-realtime-view')
    useCodexRealtimeViewStore.setState({ sessions: {} })
    useCodexRealtimeViewStore.getState().setTimelineLoading('plain')
    getSession.mockResolvedValueOnce({ sessionId: 'plain', harnessId: 'codex', status: 'idle', transcript: [] })
    openRemoteSession.mockResolvedValueOnce({
      sessionId: 'plain',
      messages: [],
      state: {},
      restore: {},
      before: null,
      cursor: { sequence: '0', epoch: 'e', version: 0 },
    })
    await hydrateRemoteSession('remote:env-1:/work/app', 'plain', null, { adoptSession: true })
    expect(useCodexRealtimeViewStore.getState().sessions.plain).toMatchObject({
      hasTimeline: false,
      loadStatus: 'loaded',
    })
  })
})

describe('hydrateRemoteSession', () => {
  const msg = (id: string, text: string, status: 'streaming' | 'complete' = 'complete') =>
    ({ id, role: 'assistant' as const, status, content: [{ type: 'text' as const, text }], createdAt: '', providerId: 'claude' })

  it("replaces the chat's messages and derived state with the node snapshot, and keeps the renderer's own", async () => {
    getSession.mockResolvedValueOnce({ sessionId: 's', harnessId: 'claude', status: 'idle', transcript: [], title: 'Node title', permissionMode: 'auto' })
    openRemoteSession.mockResolvedValueOnce({ sessionId: 's', messages: [msg('a1', 'Hello', 'streaming')], before: null, cursor: { sequence: '1', epoch: 'e', version: 4 },
      state: { status: 'streaming', awaitingAssistantReply: true, lastAssistantMessageId: 'a1', permissionMode: 'default', queuedMessages: ['node'] } })
    const previous = { messages: [msg('a1', 'Hello world'), msg('a2', 'stale')], status: 'idle', permissionMode: 'plan', queuedMessages: [], draftText: 'typed' }
    const { hydrated } = await hydrateRemoteSession('remote:env-1:/work/app', 's', previous as never)
    expect(hydrated.messages).toEqual([msg('a1', 'Hello', 'streaming')])
    expect(hydrated).toMatchObject({ status: 'streaming', awaitingAssistantReply: true, lastAssistantMessageId: 'a1', _title: 'Node title', permissionMode: 'plan', queuedMessages: [], draftText: 'typed' })
  })

  it('leaves a draft the node has never seen alone', async () => {
    getSession.mockResolvedValueOnce(null)
    openRemoteSession.mockClear()
    const previous = { messages: [msg('a1', 'local')], status: 'idle' }
    const { hydrated } = await hydrateRemoteSession('remote:env-1:/work/app', 'draft', previous as never)
    expect(hydrated.messages).toEqual(previous.messages)
    expect(openRemoteSession).not.toHaveBeenCalled()
  })
})

describe('keepRendererOwnedState', () => {
  it("keeps the composer typed while the snapshot loaded", () => {
    const applied = keepRendererOwnedState({ draftText: 'typed', queuedMessages: ['q'], messages: [] } as never, { draftText: '', queuedMessages: [], messages: ['node'] } as never)
    expect(applied).toMatchObject({ draftText: 'typed', queuedMessages: ['q'], messages: ['node'] })
  })
})
