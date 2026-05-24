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
    respond: vi.fn(),
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

  it('logs thread/status/changed and thread/settings/updated for observation while still routing them to inboxes', async () => {
    const log = (await import('../logger')).default
    const infoSpy = vi.mocked(log.info)
    infoSpy.mockClear()

    const { connection } = makeQueueConnection([
      { method: 'thread/status/changed', params: { threadId: 'obs-1', status: { type: 'active', activeFlags: ['x', 'y'] } } },
      { method: 'thread/settings/updated', params: { threadId: 'obs-1', threadSettings: { model: 'gpt-5', effort: 'high' } } },
    ])
    const dispatcher = createNotificationDispatcher(connection)
    await dispatcher.mainInbox.next()
    await dispatcher.mainInbox.next()

    const messages = infoSpy.mock.calls.map((args) => args.map(String).join(' '))
    expect(messages.some((m) => m.includes('thread/status/changed') && m.includes('status=active') && m.includes('activeFlags=2'))).toBe(true)
    expect(messages.some((m) => m.includes('thread/settings/updated') && m.includes('model') && m.includes('effort'))).toBe(true)
    dispatcher.close()
  })
})
