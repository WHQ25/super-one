/** @vitest-environment jsdom */

import { describe, it, expect, vi, beforeEach } from 'vitest'

/**
 * Isolate resolveNodeSessionId from the chat-store import graph (circular
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
  resolveNodeSessionId,
  createRemoteSession,
  keepRendererOwnedState,
  hydrateRemoteSession,
} = await import('./remote-session-ops')

describe('resolveNodeSessionId', () => {
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
  beforeEach(() => {
    getSession.mockReset()
    createSession.mockReset()
    openRemoteSession.mockReset()
    openRemoteSession.mockResolvedValue({ sessionId: 's', state: {}, messages: [], before: null, cursor: { sequence: '0', epoch: 'e', version: 0 } })
  })

  it('reuses a candidate session id that exists on the node', async () => {
    getSession.mockResolvedValueOnce({ sessionId: 'sid-real', status: 'idle', transcript: [] })

    const result = await resolveNodeSessionId('remote:env-1:/work/app', 'proj-1', 'sid-real')

    expect(result).toEqual({ sessionId: 'sid-real', created: false })
    expect(createSession).not.toHaveBeenCalled()
    expect(getSession).toHaveBeenCalledWith('env-1', 'sid-real')
  })

  it('creates a node session when the candidate is missing', async () => {
    getSession.mockResolvedValueOnce(null)
    createSession.mockResolvedValueOnce({
      sessionId: 'sid-new',
      title: 'New session',
      lastActiveAt: new Date().toISOString(),
      messageCount: 0,
    })

    const result = await resolveNodeSessionId('remote:env-1:/work/app', 'proj-1', 'sid-local-draft')

    expect(result).toEqual({ sessionId: 'sid-new', created: true })
    expect(createSession).toHaveBeenCalledWith('env-1', {
      projectId: 'proj-1',
      harnessId: 'claude',
      providerId: 'claude',
    })
  })

  it('creates a node session when there is no candidate', async () => {
    createSession.mockResolvedValueOnce({
      sessionId: 'sid-fresh',
      title: 'New session',
      lastActiveAt: new Date().toISOString(),
      messageCount: 0,
    })

    const result = await resolveNodeSessionId('remote:env-1:/work/app', 'proj-1', null)

    expect(result).toEqual({ sessionId: 'sid-fresh', created: true })
    expect(getSession).not.toHaveBeenCalled()
  })

  it('passes harnessId claude when materializing a Claude remote session', async () => {
    createSession.mockResolvedValueOnce({
      sessionId: 'sid-claude',
      title: 'New session',
      lastActiveAt: new Date().toISOString(),
      messageCount: 0,
    })

    const result = await resolveNodeSessionId('remote:env-1:/work/app', 'proj-1', null, {
      harnessId: 'claude',
    })

    expect(result).toEqual({ sessionId: 'sid-claude', created: true })
    expect(createSession).toHaveBeenCalledWith('env-1', {
      projectId: 'proj-1',
      harnessId: 'claude',
      providerId: 'claude',
    })
  })
})

describe('createRemoteSession', () => {
  beforeEach(() => {
    createSession.mockReset()
  })

  it('maps the created node row into a history entry', async () => {
    createSession.mockResolvedValueOnce({
      sessionId: 's1',
      title: 'T',
      lastActiveAt: '2020-01-01T00:00:00.000Z',
      messageCount: 0,
      provider: 'codex',
    })

    const result = await createRemoteSession('remote:env-1:/work/app', 'proj-1', 'T')

    expect(result.sessionId).toBe('s1')
    expect(result.entry.sessionId).toBe('s1')
    expect(result.entry.title).toBe('T')
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
