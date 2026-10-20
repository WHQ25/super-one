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
  pageRemoteTranscript,
} = await import('./remote-session-ops')

describe('hydrateRemoteSession: adopting a node session', () => {
  beforeEach(() => {
    getSession.mockReset()
    createSession.mockReset()
    openRemoteSession.mockReset()
    openRemoteSession.mockResolvedValue({ sessionId: 's', state: {}, messages: [], before: null, cursor: { sequence: '0', epoch: 'e', version: 0 } })
  })
  it('keeps ACP model display names from the node snapshot', async () => {
    getSession.mockResolvedValueOnce({ sessionId: 'acp-named', harnessId: 'acp', providerId: 'grok', acpAgentId: 'grok-build', status: 'idle', transcript: [], model: 'grok-4.5' })
    openRemoteSession.mockResolvedValueOnce({
      sessionId: 'acp-named',
      messages: [],
      before: null,
      cursor: { sequence: '1', epoch: 'e', version: 1 },
      state: {
        status: 'idle',
        acpModels: [{ id: 'grok-4.5', name: 'Grok 4.5', description: '' }],
        acpModelsStatus: 'ready',
        acpModelConfigId: 'model',
        sessionModels: [{ id: 'opencode/gpt', name: 'GPT', description: '' }],
      },
    })
    const { hydrated } = await hydrateRemoteSession('remote:env-1:/work/app', 'acp-named', null, { adoptSession: true })
    expect(hydrated.selectedModel).toBe('grok-4.5')
    expect(hydrated.acpModels).toEqual([{ id: 'grok-4.5', name: 'Grok 4.5', description: '' }])
    expect(hydrated.acpModelsStatus).toBe('ready')
    expect(hydrated.sessionModels).toEqual([{ id: 'opencode/gpt', name: 'GPT', description: '' }])
  })

  it('preserves ACP and its agent identity instead of coercing remote sessions to Claude', async () => {
    getSession.mockResolvedValueOnce({ sessionId: 'acp-session', harnessId: 'acp', providerId: 'grok', acpAgentId: 'grok-build', status: 'idle', transcript: [], model: 'grok-model', permissionMode: 'auto' })
    const { hydrated } = await hydrateRemoteSession('remote:env-1:/work/app', 'acp-session', null, { adoptSession: true })
    expect(hydrated).toMatchObject({ sessionProvider: 'acp', preferredProvider: 'acp', acpAgentId: 'grok-build', selectedModel: 'grok-model', permissionMode: 'auto' })
  })

  it('keeps a brand the window already holds when session.get names no agent', async () => {
    getSession.mockResolvedValueOnce({ sessionId: 'acp-session', harnessId: 'acp', acpAgentId: null, status: 'idle', transcript: [] })
    const previous = { messages: [], status: 'idle', sessionProvider: 'acp', acpAgentId: 'grok-build' }
    const { hydrated } = await hydrateRemoteSession('remote:env-1:/work/app', 'acp-session', previous as never)
    expect(hydrated).toMatchObject({ sessionProvider: 'acp', acpAgentId: 'grok-build' })
  })

  it('keeps a cursor session on cursor', async () => {
    getSession.mockResolvedValueOnce({ sessionId: 'cur', harnessId: 'cursor', status: 'idle', transcript: [] })
    const { hydrated } = await hydrateRemoteSession('remote:env-1:/work/app', 'cur', null, { adoptSession: true })
    expect(hydrated).toMatchObject({ sessionProvider: 'cursor', preferredProvider: 'cursor' })
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

const msg = (id: string, text: string, status: 'streaming' | 'complete' = 'complete') =>
  ({ id, role: 'assistant' as const, status, content: [{ type: 'text' as const, text }], createdAt: '', providerId: 'claude' })

describe('hydrateRemoteSession', () => {
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

  it('reads the window beside session.get once the session is already known', async () => {
    let releaseGet!: (value: unknown) => void
    getSession.mockReturnValue(new Promise((resolve) => { releaseGet = resolve }))
    let releaseOpen!: (value: unknown) => void
    openRemoteSession.mockReturnValue(new Promise((resolve) => { releaseOpen = resolve }))
    const previous = { messages: [], status: 'idle', sessionProvider: 'claude', hostSessionOwned: true }
    const pending = hydrateRemoteSession('remote:env-1:/work/app', 's', previous as never)
    await Promise.resolve()
    expect(openRemoteSession).toHaveBeenCalledWith('env-1', {
      sessionId: 's',
      projectPath: 'remote:env-1:/work/app',
      providerId: 'claude',
      transcript: true,
    })
    releaseGet({ sessionId: 's', harnessId: 'claude', status: 'idle', transcript: [] })
    releaseOpen({
      sessionId: 's',
      messages: [msg('a1', 'Hello')],
      state: { status: 'idle' },
      before: null,
      cursor: { sequence: '1', epoch: 'e', version: 1 },
      transcriptWindow: { older: { messageId: 'a0' }, newer: null, total: 40 },
      summarized: true,
    })
    const { hydrated } = await pending
    expect(hydrated.messages.map((message) => message.id)).toEqual(['a1'])
    expect(hydrated.transcriptWindow).toEqual({ older: { messageId: 'a0' }, newer: null, total: 40, summarized: true })
    expect(hydrated.transcriptResyncing).toBe(false)
  })

  it('starts the window read beside session.get on first adopt', async () => {
    openRemoteSession.mockClear()
    openRemoteSession.mockResolvedValue({
      sessionId: 's', messages: [], state: { sessionProvider: 'acp' }, before: null,
      cursor: { sequence: '1', epoch: 'e', version: 1 },
    })
    let releaseGet!: (value: unknown) => void
    getSession.mockReturnValue(new Promise((resolve) => { releaseGet = resolve }))
    const pending = hydrateRemoteSession('remote:env-1:/work/app', 's', null, { adoptSession: true })
    await Promise.resolve()
    expect(openRemoteSession).toHaveBeenCalledWith('env-1', expect.objectContaining({ transcript: true, providerId: 'claude' }))
    expect(openRemoteSession.mock.calls[0][1]).not.toHaveProperty('limit')
    releaseGet({ sessionId: 's', harnessId: 'acp', providerId: 'grok', acpAgentId: 'grok-build', status: 'idle', transcript: [] })
    const { hydrated } = await pending
    expect(hydrated.sessionProvider).toBe('acp')
  })

  it('does not open a draft the node has never seen', async () => {
    openRemoteSession.mockClear()
    getSession.mockResolvedValueOnce(null)
    const previous = { messages: [msg('a1', 'local')], status: 'idle', sessionProvider: 'acp', hostSessionOwned: false }
    const { hydrated } = await hydrateRemoteSession('remote:env-1:/work/app', 'draft', previous as never)
    expect(hydrated.messages).toEqual(previous.messages)
    expect(openRemoteSession).not.toHaveBeenCalled()
  })

  it('observes the eager window read when the row read fails first', async () => {
    getSession.mockRejectedValueOnce(new Error('row down'))
    openRemoteSession.mockReturnValueOnce(new Promise((_resolve, reject) => setTimeout(() => reject(new Error('window down')), 0)))
    const previous = { messages: [], status: 'idle', sessionProvider: 'claude', hostSessionOwned: true }
    await expect(hydrateRemoteSession('remote:env-1:/work/app', 's', previous as never)).rejects.toThrow('row down')
    // An unobserved rejection here would fail the run.
    await new Promise((resolve) => setTimeout(resolve, 5))
  })
})

describe('pageRemoteTranscript', () => {
  it('reads only the window, anchored, and returns the held range with its edges', async () => {
    getSession.mockClear()
    openRemoteSession.mockClear()
    openRemoteSession.mockResolvedValueOnce({
      sessionId: 's',
      messages: [msg('a0', 'Older'), msg('a1', 'Hello')],
      state: {},
      before: null,
      cursor: { sequence: '1', epoch: 'e', version: 1 },
      transcriptWindow: { older: null, newer: null, total: 2 },
    })
    const paged = await pageRemoteTranscript('remote:env-1:/work/app', 's', { sessionProvider: 'codex', preferredProvider: 'codex' }, {
      anchor: { messageId: 'a1' }, direction: 'before',
    })
    expect(getSession).not.toHaveBeenCalled()
    expect(openRemoteSession).toHaveBeenCalledWith('env-1', {
      sessionId: 's', projectPath: 'remote:env-1:/work/app', providerId: 'codex', transcript: true, anchor: { messageId: 'a1' }, direction: 'before',
    })
    expect(paged?.messages.map((message) => message.id)).toEqual(['a0', 'a1'])
    expect(paged?.transcriptWindow).toEqual({ older: null, newer: null, total: 2 })
  })
})

describe('keepRendererOwnedState', () => {
  it("keeps the composer typed while the snapshot loaded", () => {
    const applied = keepRendererOwnedState({ draftText: 'typed', queuedMessages: ['q'], messages: [] } as never, { draftText: '', queuedMessages: [], messages: ['node'] } as never)
    expect(applied).toMatchObject({ draftText: 'typed', queuedMessages: ['q'], messages: ['node'] })
  })
})
