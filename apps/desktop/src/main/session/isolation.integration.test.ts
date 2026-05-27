import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { AgentEvent, SendMessageRequest } from '@superone/shared/agent-types'
import type { Session, SessionProvider } from './types'

const hoisted = vi.hoisted(() => {
  interface PerQueryCaptured {
    emit: ((e: AgentEvent) => void) | null
    onSessionId: ((id: string) => void) | null
    bridge: unknown
    iterationDone: Promise<void>
    resolveIter: () => void
  }
  return {
    providers: new Map<string, SessionProvider>(),
    queries: [] as PerQueryCaptured[],
    createSessionQueryMock: vi.fn(),
  }
})

vi.mock('../logger', () => ({
  default: { info: vi.fn(), warn: vi.fn(), debug: vi.fn(), error: vi.fn() },
}))

vi.mock('./session-provider-repo', () => ({
  getSessionProvider: (id: string) => hoisted.providers.get(id) ?? null,
}))

vi.mock('../agent/discover-resources', () => ({
  discoverSkills: vi.fn(() => []),
  discoverProjectCommands: vi.fn(() => []),
  discoverProjectAgents: vi.fn(() => []),
}))

vi.mock('../agent/claude-permissions', () => ({
  createCanUseTool: vi.fn(() => ({ canUseTool: vi.fn(), trackPlanFile: vi.fn() })),
  respondToPermission: vi.fn(),
  respondToQuestion: vi.fn(),
  dismissQuestion: vi.fn(),
  respondToPlanApproval: vi.fn(),
  rejectAllPending: vi.fn(),
}))

hoisted.createSessionQueryMock.mockImplementation(
  (bridge: unknown, _opts: unknown, emit: (e: AgentEvent) => void, _getMid: () => string, _getTs: () => number, _getInt: () => boolean, onSessionId: (id: string) => void) => {
    let resolveIter: () => void = () => {}
    const iterationDone = new Promise<void>((resolve) => { resolveIter = resolve })
    hoisted.queries.push({ emit, onSessionId, bridge, iterationDone, resolveIter })
    return {
      query: {
        interrupt: vi.fn(async () => {}),
        close: vi.fn(),
        setModel: vi.fn(async () => {}),
      },
      iterationDone,
    }
  }
)

vi.mock('../agent/claude-query', () => ({
  createSessionQuery: hoisted.createSessionQueryMock,
  buildClaudeOptions: vi.fn((opts: unknown) => opts),
  buildUserMessage: vi.fn((req: SendMessageRequest, sid: string) => ({
    type: 'user',
    message: { role: 'user', content: req.content },
    parent_tool_use_id: null,
    session_id: sid,
  })),
}))

vi.mock('../agent/resolve-cli', () => ({
  getNodeRuntime: vi.fn(() => ({})),
}))

vi.mock('../database', () => ({
  getActiveProviderRaw: vi.fn(() => null),
}))

vi.mock('../codex/codex-turn', () => ({
  runCodexTurn: vi.fn(),
  reviewCodexTurn: vi.fn(),
  compactCodexTurn: vi.fn(),
  steerCodex: vi.fn(async () => {}),
  interruptCodex: vi.fn(() => false),
  resetCodexSession: vi.fn(),
  respondToCodexPermission: vi.fn(() => true),
  respondToCodexQuestion: vi.fn(() => true),
  dismissCodexQuestion: vi.fn(() => true),
  prewarmCodexConnection: vi.fn(async () => null),
}))

import { SessionManagerImpl } from './session-manager'

function seedProvider(id: string): SessionProvider {
  const provider: SessionProvider = {
    id,
    harnessId: 'claude',
    name: id,
    isBase: true,
    config: { apiKey: 'sk-test' },
    createdAt: 0,
    updatedAt: 0,
  }
  hoisted.providers.set(id, provider)
  return provider
}

function messageStartId(events: AgentEvent[]): string {
  const evt = events.find((e) => e.type === 'message_start') as Extract<AgentEvent, { type: 'message_start' }> | undefined
  if (!evt) throw new Error('no message_start event captured')
  return evt.message.id
}

describe('SessionManager concurrent isolation', () => {
  let mgr: SessionManagerImpl

  beforeEach(() => {
    hoisted.providers.clear()
    hoisted.queries.length = 0
    hoisted.createSessionQueryMock.mockClear()
    seedProvider('claude-base')
    mgr = new SessionManagerImpl()
  })

  async function startTwoSessions(): Promise<{
    a: Session
    b: Session
    aEvents: AgentEvent[]
    bEvents: AgentEvent[]
    aSend: Promise<void>
    bSend: Promise<void>
  }> {
    const a = mgr.createSession({ projectPath: '/proj', providerId: 'claude-base' })
    const b = mgr.createSession({ projectPath: '/proj', providerId: 'claude-base' })
    const aEvents: AgentEvent[] = []
    const bEvents: AgentEvent[] = []
    mgr.on(a.snapshot.id, (e) => aEvents.push(e))
    mgr.on(b.snapshot.id, (e) => bEvents.push(e))

    const aSend = a.send({ content: 'A-1' })
    await new Promise((r) => setTimeout(r, 0))
    const bSend = b.send({ content: 'B-1' })
    await new Promise((r) => setTimeout(r, 0))
    return { a, b, aEvents, bEvents, aSend, bSend }
  }

  it('two sessions get distinct stable IDs and distinct SDK subprocesses', async () => {
    const { a, b, aEvents, bEvents, aSend, bSend } = await startTwoSessions()

    expect(a.snapshot.id).not.toBe(b.snapshot.id)
    expect(hoisted.queries).toHaveLength(2)
    expect(hoisted.queries[0]).not.toBe(hoisted.queries[1])
    expect(messageStartId(aEvents)).not.toBe(messageStartId(bEvents))

    hoisted.queries[0]!.emit?.({ type: 'message_complete', messageId: messageStartId(aEvents), metadata: {} })
    hoisted.queries[1]!.emit?.({ type: 'message_complete', messageId: messageStartId(bEvents), metadata: {} })
    await aSend
    await bSend
  })

  it('backend A events do NOT leak into session B listeners', async () => {
    const { aEvents, bEvents, aSend, bSend } = await startTwoSessions()

    const aBefore = aEvents.length
    const bBefore = bEvents.length
    hoisted.queries[0]!.emit?.({ type: 'content_delta', messageId: 'A-only', delta: 'A-text' })
    hoisted.queries[1]!.emit?.({ type: 'content_delta', messageId: 'B-only', delta: 'B-text' })

    const aNew = aEvents.slice(aBefore)
    const bNew = bEvents.slice(bBefore)
    expect(aNew.some((e) => e.type === 'content_delta' && (e as Extract<AgentEvent, { type: 'content_delta' }>).messageId === 'A-only')).toBe(true)
    expect(aNew.some((e) => e.type === 'content_delta' && (e as Extract<AgentEvent, { type: 'content_delta' }>).messageId === 'B-only')).toBe(false)
    expect(bNew.some((e) => e.type === 'content_delta' && (e as Extract<AgentEvent, { type: 'content_delta' }>).messageId === 'B-only')).toBe(true)
    expect(bNew.some((e) => e.type === 'content_delta' && (e as Extract<AgentEvent, { type: 'content_delta' }>).messageId === 'A-only')).toBe(false)

    hoisted.queries[0]!.emit?.({ type: 'message_complete', messageId: messageStartId(aEvents), metadata: {} })
    hoisted.queries[1]!.emit?.({ type: 'message_complete', messageId: messageStartId(bEvents), metadata: {} })
    await aSend
    await bSend
  })

  it('providerSessionId captured on session A does not affect session B', async () => {
    const { a, b, aEvents, bEvents, aSend, bSend } = await startTwoSessions()

    hoisted.queries[0]!.onSessionId?.('sdk-A')
    hoisted.queries[1]!.onSessionId?.('sdk-B')

    expect(a.snapshot.providerSessionId).toBe('sdk-A')
    expect(b.snapshot.providerSessionId).toBe('sdk-B')

    hoisted.queries[0]!.emit?.({ type: 'message_complete', messageId: messageStartId(aEvents), metadata: {} })
    hoisted.queries[1]!.emit?.({ type: 'message_complete', messageId: messageStartId(bEvents), metadata: {} })
    await aSend
    await bSend
  })

  it('disposing session A does not affect session B', async () => {
    const { a, b, aEvents, bEvents, aSend, bSend } = await startTwoSessions()

    hoisted.queries[0]!.emit?.({ type: 'message_complete', messageId: messageStartId(aEvents), metadata: {} })
    await aSend

    hoisted.queries[0]!.resolveIter()
    await mgr.disposeSession(a.snapshot.id)
    expect(mgr.getSession(a.snapshot.id)).toBeNull()
    expect(mgr.getSession(b.snapshot.id)).not.toBeNull()
    expect(b.snapshot.status).not.toBe('disposed')

    hoisted.queries[1]!.emit?.({ type: 'message_complete', messageId: messageStartId(bEvents), metadata: {} })
    await bSend
  })

  it('onAny receives events tagged with the originating sessionId', async () => {
    const anyLog: Array<{ sid: string; type: string }> = []
    mgr.onAny((sid, e) => anyLog.push({ sid, type: e.type }))
    const { a, b, aEvents, bEvents, aSend, bSend } = await startTwoSessions()

    const aStartLog = anyLog.find((l) => l.sid === a.snapshot.id && l.type === 'message_start')
    const bStartLog = anyLog.find((l) => l.sid === b.snapshot.id && l.type === 'message_start')
    expect(aStartLog).toBeDefined()
    expect(bStartLog).toBeDefined()

    hoisted.queries[0]!.emit?.({ type: 'message_complete', messageId: messageStartId(aEvents), metadata: {} })
    hoisted.queries[1]!.emit?.({ type: 'message_complete', messageId: messageStartId(bEvents), metadata: {} })
    await aSend
    await bSend
  })
})
