/** @vitest-environment jsdom */

import { describe, it, expect, vi, beforeEach } from 'vitest'

/**
 * Isolate resolveNodeSessionId from the chat-store import graph (circular
 * init via remote-session-ops → defaults → types).
 */
const getSession = vi.fn()
const createSession = vi.fn()

const listSessionEvents = vi.fn()

vi.stubGlobal('window', {
  environment: {
    getSession,
    createSession,
    listSessions: vi.fn().mockResolvedValue([]),
    listSessionEvents,
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
  createRemoteSessionEventMapper,
  pollRemoteSessionAgentEvents,
  mapNodeSessionEvents,
  mergeRemoteHydrateWithCurrent,
} = await import('./remote-session-ops')

describe('resolveNodeSessionId', () => {
  beforeEach(() => {
    getSession.mockReset()
    createSession.mockReset()
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

describe('remote session.events → AgentEvent', () => {
  beforeEach(() => {
    listSessionEvents.mockReset()
  })

  it('createRemoteSessionEventMapper stamps projectPath + sessionId', () => {
    const mapper = createRemoteSessionEventMapper('remote:env-1:/work/app', 'sid-1', 'codex')
    const events = mapper.map({
      eventId: 'e1',
      sequence: '3',
      timestamp: 1,
      aggregateType: 'session',
      aggregateId: 'sid-1',
      eventType: 'session.assistant_delta',
      eventVersion: 1,
      payload: { blockId: 'a1', delta: 'hi' },
      environmentId: 'env-1',
    })
    expect(events[0]).toMatchObject({
      type: 'message_start',
      projectPath: 'remote:env-1:/work/app',
      sessionId: 'sid-1',
    })
  })

  it('pollRemoteSessionAgentEvents maps only the target session', async () => {
    listSessionEvents.mockResolvedValueOnce([
      {
        eventId: 'e1',
        sequence: '10',
        timestamp: 1,
        aggregateType: 'session',
        aggregateId: 'sid-1',
        eventType: 'session.assistant_delta',
        eventVersion: 1,
        payload: { blockId: 'a1', delta: 'ok' },
        environmentId: 'env-1',
      },
      {
        eventId: 'e2',
        sequence: '11',
        timestamp: 2,
        aggregateType: 'session',
        aggregateId: 'other',
        eventType: 'session.assistant_delta',
        eventVersion: 1,
        payload: { blockId: 'a2', delta: 'nope' },
        environmentId: 'env-1',
      },
    ])

    const result = await pollRemoteSessionAgentEvents(
      'remote:env-1:/work/app',
      'sid-1',
      '9',
    )

    expect(listSessionEvents).toHaveBeenCalledWith('env-1', '9')
    expect(result.nextSequence).toBe('11')
    expect(result.agentEvents.map((e) => e.type)).toEqual(['message_start', 'content_delta'])
    expect(result.agentEvents.every((e) => e.sessionId === 'sid-1')).toBe(true)
  })

  it('re-exports mapNodeSessionEvents for text-only batches', () => {
    const events = mapNodeSessionEvents(
      [
        {
          eventId: 'e1',
          sequence: '1',
          timestamp: 1,
          aggregateType: 'session',
          aggregateId: 's',
          eventType: 'session.turn_completed',
          eventVersion: 1,
          payload: { status: 'idle' },
          environmentId: 'env',
        },
      ],
      { sessionId: 's', projectPath: 'remote:x:/p' },
    )
    expect(events).toEqual([
      expect.objectContaining({ type: 'status_change', status: 'idle', sessionId: 's' }),
    ])
  })
})

describe('mergeRemoteHydrateWithCurrent', () => {
  const msg = (
    id: string,
    role: 'user' | 'assistant',
    text: string,
    status: 'streaming' | 'complete' = 'complete',
  ) => ({
    id,
    role,
    status,
    content: [{ type: 'text' as const, text }],
    createdAt: new Date().toISOString(),
    providerId: 'claude',
  })

  const baseSession = (overrides: Record<string, unknown> = {}) => ({
    messages: [] as ReturnType<typeof msg>[],
    status: 'idle' as const,
    sessionProvider: 'claude' as const,
    preferredProvider: 'claude' as const,
    _historyHydrated: true,
    awaitingAssistantReply: false,
    pendingPermissions: [] as unknown[],
    pendingQuestion: null,
    pendingPlanApproval: null,
    draftText: '',
    draftJson: null,
    attachments: [] as unknown[],
    mentions: [] as unknown[],
    browserAnnotations: [] as unknown[],
    queuedMessages: [] as unknown[],
    promptSuggestion: null,
    lastAssistantMessageId: null as string | null,
    ...overrides,
  })

  it('is exported for switchSession apply path', () => {
    expect(typeof mergeRemoteHydrateWithCurrent).toBe('function')
  })

  it('keeps concurrent local stream content when hydrated snapshot is stale', () => {
    const current = baseSession({
      messages: [msg('u1', 'user', 'hi'), msg('a1', 'assistant', 'Hello world', 'complete')],
      status: 'idle',
      awaitingAssistantReply: false,
      lastAssistantMessageId: 'a1',
      draftText: 'typed while away',
    })
    const hydrated = baseSession({
      messages: [msg('u1', 'user', 'hi'), msg('a1', 'assistant', 'Hello', 'streaming')],
      status: 'streaming',
      awaitingAssistantReply: true,
      lastAssistantMessageId: 'a1',
      draftText: '',
    })

    const merged = mergeRemoteHydrateWithCurrent(current as never, hydrated as never)

    const asst = merged.messages.find((m) => m.id === 'a1')
    expect(asst?.content).toEqual([{ type: 'text', text: 'Hello world' }])
    expect(merged.status).toBe('idle')
    expect(merged.awaitingAssistantReply).toBe(false)
    expect(merged.draftText).toBe('typed while away')
  })

  it('returns hydrated as-is when there is no current session', () => {
    const hydrated = baseSession({
      messages: [msg('a1', 'assistant', 'from node')],
      status: 'idle',
    })
    expect(mergeRemoteHydrateWithCurrent(null, hydrated as never)).toBe(hydrated)
  })
})
