import type { AppServerConnection, AppServerNotification } from './app-server-connection'
import { trace } from '../agent/event-trace'
import log from '../logger'

const OBSERVED_THREAD_NOTIFICATIONS = new Set([
  'thread/status/changed',
  'thread/settings/updated',
])

function summarizeThreadNotification(notif: AppServerNotification): string {
  const params = notif.params
  const threadId = readString(params.threadId) ?? readString(params.thread_id) ?? 'unknown'
  if (notif.method === 'thread/status/changed') {
    const status = asRecord(params.status)
    const type = readString(status?.type) ?? 'unknown'
    const flags = Array.isArray(status?.activeFlags) ? status.activeFlags.length : 0
    return `thread=${threadId} status=${type}${type === 'active' ? ` activeFlags=${flags}` : ''}`
  }
  if (notif.method === 'thread/settings/updated') {
    const settings = asRecord(params.threadSettings)
    const keys = settings ? Object.keys(settings).join(',') : ''
    return `thread=${threadId} settings=[${keys}]`
  }
  return `thread=${threadId}`
}

function readString(value: unknown): string | null {
  return typeof value === 'string' && value.length > 0 ? value : null
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null
}

function extractThreadId(params: Record<string, unknown>): string | null {
  return readString(params.threadId)
    ?? readString(params.thread_id)
    ?? readString(asRecord(params.thread)?.id)
}

export interface NotificationInbox {
  next(): Promise<AppServerNotification>
  poll(timeoutMs: number): Promise<AppServerNotification | null>
}

interface InboxState {
  queue: AppServerNotification[]
  waiters: Array<(n: AppServerNotification | null, err?: Error) => void>
  closed: boolean
}

function makeInbox(state: InboxState): NotificationInbox {
  return {
    next: () => {
      const queued = state.queue.shift()
      if (queued) return Promise.resolve(queued)
      if (state.closed) return Promise.reject(new Error('Notification inbox closed'))
      return new Promise((resolve, reject) => {
        state.waiters.push((notif, err) => {
          if (err) reject(err)
          else if (notif) resolve(notif)
          else reject(new Error('Notification inbox closed'))
        })
      })
    },
    poll: (timeoutMs) => {
      const queued = state.queue.shift()
      if (queued) return Promise.resolve(queued)
      if (state.closed) return Promise.reject(new Error('Notification inbox closed'))
      return new Promise((resolve, reject) => {
        let settled = false
        let waiter: (n: AppServerNotification | null, err?: Error) => void
        const timer = setTimeout(() => {
          if (settled) return
          settled = true
          const idx = state.waiters.indexOf(waiter)
          if (idx >= 0) state.waiters.splice(idx, 1)
          resolve(null)
        }, Math.max(0, timeoutMs))
        waiter = (notif, err) => {
          if (settled) return
          settled = true
          clearTimeout(timer)
          if (err) reject(err)
          else resolve(notif)
        }
        state.waiters.push(waiter)
      })
    },
  }
}

export interface NotificationDispatcher {
  readonly mainInbox: NotificationInbox
  registerForkInbox(threadId: string): NotificationInbox
  unregisterForkInbox(threadId: string): void
  hasForkInbox(threadId: string): boolean
  forkThreadIds(): string[]
  close(reason?: string): void
}

export interface NotificationDispatcherOptions {
  onSkillsChanged?: () => void
}

export function createNotificationDispatcher(
  connection: AppServerConnection,
  options: NotificationDispatcherOptions = {},
): NotificationDispatcher {
  const mainState: InboxState = { queue: [], waiters: [], closed: false }
  const forkStates = new Map<string, InboxState>()
  let dispatcherClosed = false

  const pushTo = (state: InboxState, notif: AppServerNotification): void => {
    const waiter = state.waiters.shift()
    if (waiter) waiter(notif)
    else state.queue.push(notif)
  }

  const closeInboxState = (state: InboxState, err?: Error): void => {
    state.closed = true
    while (state.waiters.length > 0) {
      const waiter = state.waiters.shift()
      waiter?.(null, err)
    }
  }

  const dispatcher: NotificationDispatcher = {
    mainInbox: makeInbox(mainState),
    registerForkInbox: (threadId) => {
      let state = forkStates.get(threadId)
      if (!state) {
        state = { queue: [], waiters: [], closed: false }
        forkStates.set(threadId, state)
      }
      const drained: AppServerNotification[] = []
      const keep: AppServerNotification[] = []
      for (const notif of mainState.queue) {
        if (extractThreadId(notif.params) === threadId) drained.push(notif)
        else keep.push(notif)
      }
      if (drained.length > 0) {
        mainState.queue = keep
        for (const notif of drained) pushTo(state, notif)
        if (process.env.NODE_ENV === 'development') {
          trace('codex.dispatch', 'backfill_fork_inbox', { threadId, drained: drained.length })
        }
      }
      return makeInbox(state)
    },
    unregisterForkInbox: (threadId) => {
      const state = forkStates.get(threadId)
      if (!state) return
      forkStates.delete(threadId)
      closeInboxState(state)
    },
    hasForkInbox: (threadId) => forkStates.has(threadId),
    forkThreadIds: () => Array.from(forkStates.keys()),
    close: (reason) => {
      if (dispatcherClosed) return
      dispatcherClosed = true
      const err = reason ? new Error(reason) : undefined
      closeInboxState(mainState, err)
      for (const state of forkStates.values()) {
        closeInboxState(state, err)
      }
      forkStates.clear()
    },
  }

  void (async () => {
    while (true) {
      let notif: AppServerNotification
      try {
        notif = await connection.nextNotification()
      } catch (err) {
        const error = err instanceof Error ? err : new Error(String(err))
        closeInboxState(mainState, error)
        for (const state of forkStates.values()) closeInboxState(state, error)
        forkStates.clear()
        dispatcherClosed = true
        return
      }
      if (dispatcherClosed) return
      if (OBSERVED_THREAD_NOTIFICATIONS.has(notif.method)) {
        log.info('[codex] %s %s', notif.method, summarizeThreadNotification(notif))
      }
      if (notif.method === 'skills/changed' && options.onSkillsChanged) {
        try { options.onSkillsChanged() } catch (err) {
          log.warn('[codex] onSkillsChanged callback threw:', err)
        }
      }
      const threadId = extractThreadId(notif.params)
      const forkState = threadId ? forkStates.get(threadId) : undefined
      if (process.env.NODE_ENV === 'development' && (notif.method === 'mcpServer/elicitation/request' || notif.method.startsWith('applyExecApproval') || notif.method.startsWith('applyPatchApproval'))) {
        trace('codex.dispatch', 'approval_route', {
          method: notif.method,
          threadId,
          routedTo: forkState ? 'fork' : 'main',
          forkInboxes: Array.from(forkStates.keys()),
          paramsKeys: Object.keys(notif.params),
        })
      }
      if (forkState) pushTo(forkState, notif)
      else pushTo(mainState, notif)
    }
  })()

  return dispatcher
}
