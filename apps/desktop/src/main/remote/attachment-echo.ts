import type { AgentEvent } from '@superone/shared/agent-types'

/**
 * The device that sent a user message already holds its attachment bytes and
 * paints the bubble before the host echoes it, so the echo it receives can
 * carry the attachment list without the data — a picture otherwise costs the
 * phone seconds of JS-side decryption on the way back. Keyed by the message id
 * the phone chose (`clientMessageId`), consumed on the first echo.
 */
const origins = new Map<string, string>()
const MAX_PENDING = 64

export function rememberAttachmentOrigin(messageId: string, deviceId: string): void {
  origins.delete(messageId)
  origins.set(messageId, deviceId)
  if (origins.size > MAX_PENDING) origins.delete(origins.keys().next().value!)
}

export function takeAttachmentOrigin(messageId: string): string | undefined {
  const deviceId = origins.get(messageId)
  origins.delete(messageId)
  return deviceId
}

/** The echo as the sender sees it: same message, attachment bytes emptied. */
export function withoutAttachmentBytes(event: AgentEvent): AgentEvent {
  if (event.type !== 'user_message_appended' || !event.message.attachments?.length) return event
  return {
    ...event,
    message: {
      ...event.message,
      attachments: event.message.attachments.map((attachment) => ({ ...attachment, base64: '' })),
    },
  }
}
