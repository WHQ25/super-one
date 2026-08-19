import { describe, expect, it, vi } from 'vitest'

vi.mock('../logger', () => ({
  default: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
    transports: { file: { getFile: () => ({ path: '/tmp/codex.log' }) } },
  },
}))

vi.mock('../agent/event-trace', () => ({ trace: vi.fn() }))

vi.mock('../database', () => ({
  getActiveProviderRaw: vi.fn(() => null),
  getProviderByIdRaw: vi.fn(() => undefined),
}))

vi.mock('../agent/resolve-cli', () => ({ getNodeRuntime: vi.fn(() => ({})) }))

vi.mock('../mcp/superone-mcp-server', () => ({
  isToolPreapproved: vi.fn(() => false),
  isBuiltInSuperoneTool: vi.fn((name: string) => name === 'mcp__superone__session_rename'),
}))

const { streamTurnEvents, closeSessionConnection } = await import('./codex-turn')
const { createCodexSession } = await import('./codex-session')
const { createNotificationDispatcher } = await import('./codex-notification-dispatcher')

import type { AppServerConnection, AppServerNotification } from './app-server-connection'
import type { CodexCollabToolCallItem, CodexThreadItem } from '@superone/shared/agent-types'
import type { CodexRunStreamCallbacks } from './codex-turn'

function makePushableConnection(initial: AppServerNotification[] = []): {
  connection: AppServerConnection
  push: (n: AppServerNotification) => void
} {
  const queue: AppServerNotification[] = [...initial]
  const waiters: Array<(n: AppServerNotification) => void> = []

  const push = (n: AppServerNotification): void => {
    const w = waiters.shift()
    if (w) w(n)
    else queue.push(n)
  }

  const connection: AppServerConnection = {
    request: vi.fn().mockImplementation(async (method: string) => {
      if (method === 'thread/resume') return {}
      if (method === 'thread/read') {
        return { thread: { id: 'fork-thread', agentNickname: 'ForkAgent', forkedFromId: 'main-thread' } }
      }
      return {}
    }),
    respond: vi.fn(),
    notify: vi.fn(),
    nextNotification: vi.fn().mockImplementation(
      () => {
        const queued = queue.shift()
        if (queued) return Promise.resolve(queued)
        return new Promise<AppServerNotification>((resolve) => waiters.push(resolve))
      },
    ),
  } as unknown as AppServerConnection

  return { connection, push }
}

describe('fork listener lifecycle', () => {
  it('captures fork-thread items after the main turn completes', async () => {
    const session = createCodexSession('s1', '/project', undefined, 'main-thread', undefined, 'default')
    session.threadId = 'main-thread'

    const mainNotifs: AppServerNotification[] = [
      {
        method: 'item/completed',
        params: {
          thread_id: 'main-thread',
          item: {
            id: 'collab-fork',
            type: 'collabAgentToolCall',
            tool: 'spawnAgent',
            status: 'completed',
            sender_thread_id: 'main-thread',
            receiver_thread_ids: ['fork-thread'],
            agents_states: { 'fork-thread': { status: 'pendingInit', message: null } },
          },
        },
      },
      { method: 'turn/completed', params: { turn: { status: 'completed' } } },
    ]

    const { connection, push } = makePushableConnection(mainNotifs)
    session.notificationDispatcher = createNotificationDispatcher(connection)

    const collabUpdates: CodexCollabToolCallItem[] = []
    const onUsageAccounted = vi.fn()
    const callbacks: CodexRunStreamCallbacks = {
      onUsageAccounted,
      onItemDelta: (_phase, item) => {
        if (item.type === 'collab_tool_call' && item.id === 'collab-fork') {
          collabUpdates.push(item as CodexCollabToolCallItem)
        }
      },
    }

    await streamTurnEvents(connection, session, null, new AbortController(), callbacks)

    // Allow async subscribeChildThread / promote-to-fork to complete.
    await new Promise((r) => setImmediate(r))
    await new Promise((r) => setImmediate(r))

    expect(session.forkListeners.has('fork-thread')).toBe(true)

    // Now push fork-thread events; dispatcher should route to forkInbox.
    push({
      method: 'thread/tokenUsage/updated',
      params: {
        threadId: 'fork-thread',
        tokenUsage: {
          last: { inputTokens: 100, cachedInputTokens: 80, outputTokens: 10 },
          total: { inputTokens: 100, cachedInputTokens: 80, outputTokens: 10 },
        },
      },
    })
    push({
      method: 'item/started',
      params: {
        thread_id: 'fork-thread',
        item: { id: 'fork-msg-1', type: 'agentMessage', text: '', phase: 'commentary' },
      },
    })
    push({
      method: 'item/agentMessage/delta',
      params: { threadId: 'fork-thread', itemId: 'fork-msg-1', delta: 'Hi from fork' },
    })
    push({
      method: 'item/completed',
      params: {
        thread_id: 'fork-thread',
        item: { id: 'fork-msg-1', type: 'agentMessage', text: 'Hi from fork', phase: 'commentary' },
      },
    })

    // Yield so fork listener consumes inbox.
    for (let i = 0; i < 5; i++) await new Promise((r) => setImmediate(r))

    const latest = collabUpdates[collabUpdates.length - 1]
    expect(onUsageAccounted).toHaveBeenCalledWith('fork-thread', expect.objectContaining({
      lastInputTokens: 100,
      lastCachedInputTokens: 80,
      lastOutputTokens: 10,
    }))
    expect(latest).toBeDefined()
    const forkChildItems: CodexThreadItem[] = latest.childItems?.['fork-thread'] ?? []
    const forkMsg = forkChildItems.find((i) => i.id === 'fork-msg-1')
    expect(forkMsg).toBeDefined()
    expect(forkMsg?.type).toBe('agent_message')
    if (forkMsg?.type === 'agent_message') {
      expect(forkMsg.text).toBe('Hi from fork')
    }

    await closeSessionConnection(session)
    expect(session.forkListeners.size).toBe(0)
  })

  it('backfills early fork elicitation into the fork inbox even if it arrived before registerForkInbox', async () => {
    const session = createCodexSession('s-race', '/project', undefined, 'main-thread', undefined, 'default')
    session.threadId = 'main-thread'

    let resolveThreadRead: ((value: unknown) => void) | null = null
    const threadReadPromise = new Promise((resolve) => { resolveThreadRead = resolve })

    const mainNotifs: AppServerNotification[] = [
      {
        method: 'item/completed',
        params: {
          thread_id: 'main-thread',
          item: {
            id: 'collab-race',
            type: 'collabAgentToolCall',
            tool: 'spawnAgent',
            status: 'completed',
            sender_thread_id: 'main-thread',
            receiver_thread_ids: ['fork-thread'],
            agents_states: { 'fork-thread': { status: 'pendingInit', message: null } },
          },
        },
      },
    ]
    const { connection, push } = makePushableConnection(mainNotifs)

    ;(connection.request as unknown as ReturnType<typeof vi.fn>).mockImplementation(async (method: string) => {
      if (method === 'thread/resume') return {}
      if (method === 'thread/read') return threadReadPromise
      return {}
    })

    session.notificationDispatcher = createNotificationDispatcher(connection)

    const onPermissionRequest = vi.fn()
    const callbacks: CodexRunStreamCallbacks = { onItemDelta: vi.fn(), onPermissionRequest }
    const streamPromise = streamTurnEvents(connection, session, null, new AbortController(), callbacks)

    await new Promise((r) => setImmediate(r))
    await new Promise((r) => setImmediate(r))

    push({
      method: 'mcpServer/elicitation/request',
      requestIdRaw: 'req-race-1',
      requestId: 'req-race-1',
      params: {
        threadId: 'fork-thread',
        serverName: 'superone',
        message: 'Allow superone to run tool "session_rename"?',
        requestedSchema: { type: 'object', properties: {} },
      },
    } as unknown as AppServerNotification)

    for (let i = 0; i < 3; i++) await new Promise((r) => setImmediate(r))

    resolveThreadRead?.({ thread: { id: 'fork-thread', agentNickname: 'ForkAgent', forkedFromId: 'main-thread' } })

    push({ method: 'turn/completed', params: { turn: { status: 'completed' } } })

    for (let i = 0; i < 10; i++) await new Promise((r) => setImmediate(r))

    await streamPromise

    const respondMock = connection.respond as unknown as ReturnType<typeof vi.fn>
    const renameResponses = respondMock.mock.calls.filter((c) => c[0] === 'req-race-1')
    expect(renameResponses.length).toBe(1)
    expect(renameResponses[0][1]).toMatchObject({ action: 'decline' })
    expect(onPermissionRequest).not.toHaveBeenCalled()

    await closeSessionConnection(session)
  })

  it('declines fork agent calls to session_rename without forwarding to host', async () => {
    const session = createCodexSession('s-rename', '/project', undefined, 'main-thread', undefined, 'default')
    session.threadId = 'main-thread'

    const mainNotifs: AppServerNotification[] = [
      {
        method: 'item/completed',
        params: {
          thread_id: 'main-thread',
          item: {
            id: 'collab-rename',
            type: 'collabAgentToolCall',
            tool: 'spawnAgent',
            status: 'completed',
            sender_thread_id: 'main-thread',
            receiver_thread_ids: ['fork-thread'],
            agents_states: { 'fork-thread': { status: 'pendingInit', message: null } },
          },
        },
      },
      { method: 'turn/completed', params: { turn: { status: 'completed' } } },
    ]

    const { connection, push } = makePushableConnection(mainNotifs)
    session.notificationDispatcher = createNotificationDispatcher(connection)

    const onPermissionRequest = vi.fn()
    const callbacks: CodexRunStreamCallbacks = { onItemDelta: vi.fn(), onPermissionRequest }
    await streamTurnEvents(connection, session, null, new AbortController(), callbacks)
    await new Promise((r) => setImmediate(r))
    await new Promise((r) => setImmediate(r))

    expect(session.forkListeners.has('fork-thread')).toBe(true)

    push({
      method: 'mcpServer/elicitation/request',
      requestIdRaw: 'req-rename-1',
      requestId: 'req-rename-1',
      params: {
        threadId: 'fork-thread',
        serverName: 'superone',
        message: 'Allow superone to run tool "session_rename"?',
        requestedSchema: { type: 'object', properties: {} },
      },
    } as unknown as AppServerNotification)

    for (let i = 0; i < 5; i++) await new Promise((r) => setImmediate(r))

    const respondMock = connection.respond as unknown as ReturnType<typeof vi.fn>
    const renameResponses = respondMock.mock.calls.filter((c) => c[0] === 'req-rename-1')
    expect(renameResponses.length).toBe(1)
    expect(renameResponses[0][1]).toMatchObject({ action: 'decline' })
    expect(onPermissionRequest).not.toHaveBeenCalled()

    await closeSessionConnection(session)
  })

  it('declines session_rename from a non-fork subagent (no forkedFromId) on the main path', async () => {
    const session = createCodexSession('s-sub', '/project', undefined, 'main-thread', undefined, 'default')
    session.threadId = 'main-thread'

    const mainNotifs: AppServerNotification[] = [
      {
        method: 'item/completed',
        params: {
          thread_id: 'main-thread',
          item: {
            id: 'collab-sub',
            type: 'collabAgentToolCall',
            tool: 'spawnAgent',
            status: 'completed',
            sender_thread_id: 'main-thread',
            receiver_thread_ids: ['sub-thread'],
            agents_states: { 'sub-thread': { status: 'pendingInit', message: null } },
          },
        },
      },
    ]

    const { connection, push } = makePushableConnection(mainNotifs)

    ;(connection.request as unknown as ReturnType<typeof vi.fn>).mockImplementation(async (method: string) => {
      if (method === 'thread/resume') return {}
      if (method === 'thread/read') {
        return { thread: { id: 'sub-thread', agentNickname: 'PlainSub' } }
      }
      return {}
    })

    session.notificationDispatcher = createNotificationDispatcher(connection)

    const onPermissionRequest = vi.fn()
    const callbacks: CodexRunStreamCallbacks = { onItemDelta: vi.fn(), onPermissionRequest }
    const streamPromise = streamTurnEvents(connection, session, null, new AbortController(), callbacks)
    for (let i = 0; i < 5; i++) await new Promise((r) => setImmediate(r))

    expect(session.forkListeners.size).toBe(0)

    push({
      method: 'mcpServer/elicitation/request',
      requestIdRaw: 'req-sub-1',
      requestId: 'req-sub-1',
      params: {
        threadId: 'sub-thread',
        serverName: 'superone',
        message: 'Allow superone to run tool "session_rename"?',
        requestedSchema: { type: 'object', properties: {} },
      },
    } as unknown as AppServerNotification)

    for (let i = 0; i < 6; i++) await new Promise((r) => setImmediate(r))

    push({ method: 'turn/completed', params: { turn: { status: 'completed' } } })
    await streamPromise

    const respondMock = connection.respond as unknown as ReturnType<typeof vi.fn>
    const calls = respondMock.mock.calls.filter((c) => c[0] === 'req-sub-1')
    expect(calls.length).toBe(1)
    expect(calls[0][1]).toMatchObject({ action: 'decline' })
    expect(onPermissionRequest).not.toHaveBeenCalled()

    await closeSessionConnection(session)
  })

  it('cleans up fork listener when session connection closes', async () => {
    const session = createCodexSession('s2', '/project', undefined, 'main-thread', undefined, 'default')
    session.threadId = 'main-thread'

    const mainNotifs: AppServerNotification[] = [
      {
        method: 'item/completed',
        params: {
          thread_id: 'main-thread',
          item: {
            id: 'collab-cleanup',
            type: 'collabAgentToolCall',
            tool: 'spawnAgent',
            status: 'completed',
            sender_thread_id: 'main-thread',
            receiver_thread_ids: ['fork-thread'],
            agents_states: { 'fork-thread': { status: 'pendingInit', message: null } },
          },
        },
      },
      { method: 'turn/completed', params: { turn: { status: 'completed' } } },
    ]
    const { connection } = makePushableConnection(mainNotifs)
    session.notificationDispatcher = createNotificationDispatcher(connection)

    const callbacks: CodexRunStreamCallbacks = { onItemDelta: vi.fn() }
    await streamTurnEvents(connection, session, null, new AbortController(), callbacks)
    await new Promise((r) => setImmediate(r))
    await new Promise((r) => setImmediate(r))

    expect(session.forkListeners.size).toBe(1)

    await closeSessionConnection(session)
    expect(session.forkListeners.size).toBe(0)
  })
})
