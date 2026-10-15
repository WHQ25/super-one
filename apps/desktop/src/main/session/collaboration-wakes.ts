import { CollaborationWakeQueue } from '@superone/runtime/collaboration'
import { getDb } from '../database'
import log from '../logger'
import { runHostReaction } from './control-context'
import { isCollaborationTargetReadOnly, resolveLiveSession } from './collaboration-target'
import { remoteChildTarget, sendToRemoteChild } from './collaboration-remote'
import type { SessionManager } from './types'

const queues = new WeakMap<ReturnType<typeof getDb>, CollaborationWakeQueue>()
const subscriptions = new WeakMap<ReturnType<typeof getDb>, () => void>()

/** Producer acknowledgement is a durable local inbox write, independent of the harness. */
export function collaborationWakeQueue(host: SessionManager): CollaborationWakeQueue {
  const db = getDb()
  const existing = queues.get(db)
  if (existing) return existing
  const queue = new CollaborationWakeQueue(db, {
    canAdmit: (sessionId) => {
      const session = host.getSession(sessionId)
      return !session || (session.activityStatus() !== 'error' && !session.isStreaming() && session.getPendingInteractions().length === 0)
    },
    admit: (sessionId, content, notificationId, onInputAccepted, beforeInput) => runHostReaction(async () => {
      if (remoteChildTarget(sessionId)) {
        await sendToRemoteChild(sessionId, content, { clientMessageId: notificationId })
        return
      }
      const session = resolveLiveSession(host, sessionId)
      if (!session) throw new Error(`Notification recipient is unavailable: ${sessionId}`)
      if (isCollaborationTargetReadOnly(sessionId, session)) throw new Error(`Notification recipient is read-only: ${sessionId}`)
      await session.admitTaskNotification(content, { clientMessageId: notificationId, onInputAccepted, beforeInput })
    }),
    warn: (message) => log.warn(message),
  })
  queues.set(db, queue)
  const unsubscribe = host.onAny?.((sessionId, event, replay) => {
    if (replay) return
    queue.observe(sessionId, event)
    if (event.type === 'status_change') queue.start()
  })
  if (unsubscribe) subscriptions.set(db, unsubscribe)
  return queue
}

/** The queue {@link collaborationWakeQueue} started for the current database; null before startup. */
export function startedCollaborationWakeQueue(): CollaborationWakeQueue | null {
  return queues.get(getDb()) ?? null
}

export function stopCollaborationWakes(): void {
  const db = getDb()
  queues.get(db)?.dispose()
  subscriptions.get(db)?.()
}
