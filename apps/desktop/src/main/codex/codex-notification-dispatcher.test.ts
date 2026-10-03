import { describe, expect, it, vi } from 'vitest'

vi.mock('../logger', () => ({
  default: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  },
}))

vi.mock('../agent/event-trace', () => ({
  trace: vi.fn(),
}))

const { createNotificationDispatcher } = await import('./codex-notification-dispatcher')
import type { AppServerConnection, AppServerNotification } from './app-server-connection'
import { createCodexMcpAppsProvider } from '@superone/codex/mcp-apps'
import { withCodexMcpAppElicitation } from '@superone/codex/mcp-app-elicitation'

function makeQueueConnection(notifications: AppServerNotification[]): { connection: AppServerConnection; release: () => void } {
  const queue: AppServerNotification[] = [...notifications]
  const waiters: Array<(n: AppServerNotification | null, err?: Error) => void> = []
  let closed = false

  const push = (n: AppServerNotification): void => {
    const w = waiters.shift()
    if (w) w(n)
    else queue.push(n)
  }

  const release = (): void => {
    closed = true
    while (waiters.length > 0) {
      const w = waiters.shift()
      w?.(null, new Error('test connection closed'))
    }
  }

  const connection: AppServerConnection = {
    request: vi.fn(),
    respond: vi.fn(async () => {}),
    notify: vi.fn(),
    nextNotification: () => {
      const queued = queue.shift()
      if (queued) return Promise.resolve(queued)
      if (closed) return Promise.reject(new Error('test connection closed'))
      return new Promise((resolve, reject) => {
        waiters.push((n, err) => {
          if (err) reject(err)
          else if (n) resolve(n)
          else reject(new Error('test connection closed'))
        })
      })
    },
    pollNotification: vi.fn(),
  } as unknown as AppServerConnection

  ;(connection as unknown as { _push: typeof push })._push = push

  return { connection, release }
}

function pushNotification(connection: AppServerConnection, notif: AppServerNotification): void {
  ;(connection as unknown as { _push: (n: AppServerNotification) => void })._push(notif)
}

describe('NotificationDispatcher', () => {
  it('cancels an unscoped idle form and leaves following notifications ordered', async () => {
    const { connection, release } = makeQueueConnection([
      { method: 'mcpServer/elicitation/request', requestIdRaw: 'old-form', params: { threadId: 'root', serverName: 'fixture' } },
      { method: 'item/started', params: { threadId: 'root', order: 1 } },
      { method: 'item/completed', params: { threadId: 'root', order: 2 } },
    ])
    const dispatcher = createNotificationDispatcher(connection, { isMainTurnActive: () => false })
    expect((await dispatcher.mainInbox.next()).params.order).toBe(1)
    expect((await dispatcher.mainInbox.next()).params.order).toBe(2)
    expect(connection.respond).toHaveBeenCalledWith('old-form', { action: 'cancel', content: null, _meta: null })
    dispatcher.close()
    release()
  })
  it('handles an idle native View form without blocking or reordering thread notifications', async () => {
    const { connection, release } = makeQueueConnection([])
    const dispatcher = createNotificationDispatcher(connection), child = dispatcher.registerForkInbox('child')
    let finishCall!: (value: Record<string, unknown>) => void
    let answer!: () => void
    const native = createCodexMcpAppsProvider({ node: 'local', session: 's', server: 'fixture', configGeneration: 0, configFingerprint: 'config' }, 'root', () => new Promise(resolve => { finishCall = resolve }))
    const handle = vi.fn(async (request: { id: string | number }) => {
      await new Promise<void>(resolve => { answer = resolve })
      await connection.respond(request.id, { action: 'accept', content: { count: 3 }, _meta: null })
      return {}
    })
    const provider = withCodexMcpAppElicitation(native, connection, 'root', handle)
    const call = provider.callTool({ tool: 'next', args: {} }, new AbortController().signal)
    await vi.waitFor(() => expect(finishCall).toBeDefined())
    pushNotification(connection, { method: 'mcpServer/elicitation/request', requestIdRaw: 0, params: { threadId: 'root', serverName: 'fixture', turnId: null } })
    for (const order of [1, 2]) {
      pushNotification(connection, { method: 'item/started', params: { threadId: 'root', order } })
      pushNotification(connection, { method: 'item/started', params: { threadId: 'child', order } })
    }
    for (const inbox of [dispatcher.mainInbox, child]) {
      expect((await inbox.next()).params.order).toBe(1)
      expect((await inbox.next()).params.order).toBe(2)
    }
    expect(connection.respond).not.toHaveBeenCalled()
    expect(handle).toHaveBeenCalledOnce()
    answer()
    await vi.waitFor(() => expect(connection.respond).toHaveBeenCalledWith(0, { action: 'accept', content: { count: 3 }, _meta: null }))
    finishCall({ content: [] })
    await call
    dispatcher.close()
    release()
  })
  it('routes unregistered thread notifications to mainInbox', async () => {
    const { connection } = makeQueueConnection([
      { method: 'item/started', params: { threadId: 'main-1', item: {} } },
    ])
    const dispatcher = createNotificationDispatcher(connection)
    const notif = await dispatcher.mainInbox.next()
    expect(notif.method).toBe('item/started')
    expect((notif.params as { threadId: string }).threadId).toBe('main-1')
    dispatcher.close()
  })

  it('routes notifications matching a registered fork thread to the fork inbox', async () => {
    const { connection } = makeQueueConnection([])
    const dispatcher = createNotificationDispatcher(connection)
    const forkInbox = dispatcher.registerForkInbox('fork-1')
    pushNotification(connection, { method: 'item/started', params: { thread_id: 'fork-1', item: { type: 'reasoning' } } })
    pushNotification(connection, { method: 'item/started', params: { threadId: 'main-1', item: {} } })

    const forkNotif = await forkInbox.next()
    expect((forkNotif.params as { thread_id: string }).thread_id).toBe('fork-1')
    const mainNotif = await dispatcher.mainInbox.next()
    expect((mainNotif.params as { threadId: string }).threadId).toBe('main-1')
    dispatcher.close()
  })

  it('falls back to mainInbox after fork inbox is unregistered', async () => {
    const { connection } = makeQueueConnection([])
    const dispatcher = createNotificationDispatcher(connection)
    dispatcher.registerForkInbox('fork-1')
    dispatcher.unregisterForkInbox('fork-1')
    pushNotification(connection, { method: 'item/completed', params: { thread_id: 'fork-1', item: {} } })

    const notif = await dispatcher.mainInbox.next()
    expect((notif.params as { thread_id: string }).thread_id).toBe('fork-1')
    dispatcher.close()
  })

  it('isolates realtime notifications without stealing ordinary thread events', async () => {
    const { connection } = makeQueueConnection([])
    const dispatcher = createNotificationDispatcher(connection)
    const realtimeInbox = dispatcher.registerRealtimeInbox('main-1')
    pushNotification(connection, { method: 'thread/realtime/sdp', params: { threadId: 'main-1', sdp: 'answer' } })
    pushNotification(connection, { method: 'item/completed', params: { threadId: 'main-1', item: {} } })

    await expect(realtimeInbox.next()).resolves.toMatchObject({ method: 'thread/realtime/sdp' })
    await expect(dispatcher.mainInbox.next()).resolves.toMatchObject({ method: 'item/completed' })
    dispatcher.close()
  })

  it('returns realtime notifications to the main inbox after unregister', async () => {
    const { connection } = makeQueueConnection([])
    const dispatcher = createNotificationDispatcher(connection)
    dispatcher.registerRealtimeInbox('main-1')
    dispatcher.unregisterRealtimeInbox('main-1')
    pushNotification(connection, { method: 'thread/realtime/closed', params: { threadId: 'main-1' } })

    await expect(dispatcher.mainInbox.next()).resolves.toMatchObject({ method: 'thread/realtime/closed' })
    dispatcher.close()
  })

  it('isolates backing Codex turns while realtime is active', async () => {
    const { connection } = makeQueueConnection([])
    const dispatcher = createNotificationDispatcher(connection)
    const turnInbox = dispatcher.registerRealtimeTurnInbox('main-1')
    const realtimeInbox = dispatcher.registerRealtimeInbox('main-1')
    pushNotification(connection, { method: 'turn/started', params: { threadId: 'main-1', turn: { id: 'turn-1' } } })
    pushNotification(connection, { method: 'thread/realtime/sdp', params: { threadId: 'main-1', sdp: 'answer' } })
    pushNotification(connection, { method: 'item/started', params: { threadId: 'other', item: {} } })

    await expect(turnInbox.next()).resolves.toMatchObject({ method: 'turn/started' })
    await expect(realtimeInbox.next()).resolves.toMatchObject({ method: 'thread/realtime/sdp' })
    await expect(dispatcher.mainInbox.next()).resolves.toMatchObject({ params: { threadId: 'other' } })
    dispatcher.close()
  })

  it('returns unread backing turn notifications to main after realtime', async () => {
    const { connection } = makeQueueConnection([])
    const dispatcher = createNotificationDispatcher(connection)
    dispatcher.registerRealtimeTurnInbox('main-1')
    pushNotification(connection, { method: 'turn/started', params: { threadId: 'main-1', turn: { id: 'turn-1' } } })
    await Promise.resolve()
    dispatcher.unregisterRealtimeTurnInbox('main-1')

    await expect(dispatcher.mainInbox.next()).resolves.toMatchObject({ method: 'turn/started' })
    dispatcher.close()
  })

  it('reads threadId from nested params.thread.id', async () => {
    const { connection } = makeQueueConnection([])
    const dispatcher = createNotificationDispatcher(connection)
    const forkInbox = dispatcher.registerForkInbox('nested-1')
    pushNotification(connection, { method: 'thread/started', params: { thread: { id: 'nested-1' } } })

    const notif = await forkInbox.next()
    expect((notif.params as { thread: { id: string } }).thread.id).toBe('nested-1')
    dispatcher.close()
  })

  it('rejects pending waiters when dispatcher closes', async () => {
    const { connection } = makeQueueConnection([])
    const dispatcher = createNotificationDispatcher(connection)
    const pending = dispatcher.mainInbox.next()
    dispatcher.close('shutdown')
    await expect(pending).rejects.toThrow(/shutdown/)
  })

  it('rejects pending waiters when underlying connection errors', async () => {
    const { connection, release } = makeQueueConnection([])
    const dispatcher = createNotificationDispatcher(connection)
    const pending = dispatcher.mainInbox.next()
    release()
    await expect(pending).rejects.toThrow(/test connection closed/)
    dispatcher.close()
  })

  it('poll returns null after timeout', async () => {
    const { connection } = makeQueueConnection([])
    const dispatcher = createNotificationDispatcher(connection)
    const result = await dispatcher.mainInbox.poll(10)
    expect(result).toBeNull()
    dispatcher.close()
  })

  it('invokes onSkillsChanged when skills/changed arrives and continues routing the notification', async () => {
    const { connection } = makeQueueConnection([
      { method: 'skills/changed', params: {} },
    ])
    const onSkillsChanged = vi.fn()
    const dispatcher = createNotificationDispatcher(connection, { onSkillsChanged })

    // Notification still flows into mainInbox so other consumers can observe it.
    const notif = await dispatcher.mainInbox.next()
    expect(notif.method).toBe('skills/changed')
    expect(onSkillsChanged).toHaveBeenCalledTimes(1)

    dispatcher.close()
  })

  it('does not crash when onSkillsChanged option is omitted', async () => {
    const { connection } = makeQueueConnection([
      { method: 'skills/changed', params: {} },
    ])
    const dispatcher = createNotificationDispatcher(connection)
    const notif = await dispatcher.mainInbox.next()
    expect(notif.method).toBe('skills/changed')
    dispatcher.close()
  })

  it('notifies the queue owner when thread/queue/changed arrives', async () => {
    const { connection } = makeQueueConnection([
      { method: 'thread/queue/changed', params: { threadId: 'thread-1' } },
    ])
    const onQueueChanged = vi.fn()
    const dispatcher = createNotificationDispatcher(connection, { onQueueChanged })

    await dispatcher.mainInbox.next()
    expect(onQueueChanged).toHaveBeenCalledWith('thread-1')
    dispatcher.close()
  })

  it('logs thread/status/changed and thread/settings/updated for observation while still routing them to inboxes', async () => {
    const log = (await import('../logger')).default
    const infoSpy = vi.mocked(log.info)
    infoSpy.mockClear()

    const { connection } = makeQueueConnection([
      { method: 'thread/status/changed', params: { threadId: 'obs-1', status: { type: 'active', activeFlags: ['x', 'y'] } } },
      { method: 'thread/settings/updated', params: { threadId: 'obs-1', threadSettings: {
        model: 'gpt-5.6-luna', effort: 'max', approvalPolicy: 'never',
        sandboxPolicy: { type: 'dangerFullAccess' }, serviceTier: 'priority',
        developerInstructions: 'private-instructions',
      } } },
    ])
    const dispatcher = createNotificationDispatcher(connection)
    await dispatcher.mainInbox.next()
    await dispatcher.mainInbox.next()

    const messages = infoSpy.mock.calls.map((args) => args.map(String).join(' '))
    expect(messages.some((m) => m.includes('thread/status/changed') && m.includes('status=active') && m.includes('activeFlags=2'))).toBe(true)
    expect(messages.some((m) => m.includes('thread/settings/updated') && m.includes('model') && m.includes('effort'))).toBe(true)
    const settingsLog = messages.find((m) => m.includes('thread/settings/updated'))!
    expect(settingsLog).toContain('"model":"gpt-5.6-luna"')
    expect(settingsLog).toContain('"approvalPolicy":"never"')
    expect(settingsLog).toContain('"sandboxPolicy":"dangerFullAccess"')
    expect(settingsLog).not.toContain('private-instructions')
    dispatcher.close()
  })
})
