import type { RemoteCommand } from '@superone/shared/agent-types'
import type { Session } from '../session/types'
import { getDb } from '../database'
import { rowToChatMessage } from '../session/session-repo'
import { detailMessageId, subscribeDetail, unsubscribeDetail } from './progressive-session'
import { loadRealtimeTimeline } from '../session/realtime-timeline-repo'

/** The caller checks project/session access before entering this handler. */
export function handleDetailCommand(
  command: Extract<RemoteCommand, { type: 'subscribe_detail' | 'unsubscribe_detail' }>,
  deviceId: string,
  session: Session | undefined | null,
): Record<string, unknown> {
  if (command.type === 'unsubscribe_detail') {
    unsubscribeDetail(deviceId, command.sessionId, command.subscriptionId)
    return { ok: true }
  }
  const messageId = detailMessageId(command.detailRef)
  let message = session?.snapshot.messages.find(message => message.id === messageId)
  if (!message) {
    const row = getDb().prepare('SELECT * FROM chat_messages WHERE session_id = ? AND id = ?').get(command.sessionId, messageId)
    if (row) message = rowToChatMessage(row as Parameters<typeof rowToChatMessage>[0])
  }
  // Canonical Codex rows can have provider ids and live outside the saved message page.
  if (!message) message = loadRealtimeTimeline(command.sessionId)?.threadMessages.find(row => row.id === messageId)
  if (!message) throw new Error('Detail not found')
  return subscribeDetail(deviceId, command.sessionId, command.subscriptionId, command.detailRef, message)
}
