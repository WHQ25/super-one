import { reduceUserMessageSendFailed, withoutSendFailure } from '@superone/chat-core'
import { unwrapIpcInvokeError } from '@superone/shared/ipc-error'
import type { PerSessionState } from '../types'
import { promptForMissingCursorKey } from './send-error-toast'

type PatchSession = (updater: (s: PerSessionState) => Partial<PerSessionState>) => void

/**
 * Replays of failed sends, keyed by user message id. In memory on purpose: a
 * replay resends exactly what went out — mention reminders, grants and
 * annotations included — and none of that survives a reload anyway.
 */
const replays = new Map<string, () => Promise<void>>()

export function dropSendReplay(messageId: string): void {
  replays.delete(messageId)
}

/** Resend a failed message as it originally went out. No-op when it cannot be replayed. */
export async function replayFailedSend(messageId: string): Promise<void> {
  const replay = replays.get(messageId)
  if (!replay) return
  replays.delete(messageId)
  await replay()
}

export interface UserSendDelivery<T> {
  messageId: string
  /** Writes to the session that sent, whichever pane is focused when it fails. */
  patchSession: PatchSession
  /** Hands the message to the host; a throw here means the host never took it. */
  deliver: () => Promise<T>
  /** Follow-up once the host took the message (also after a replay). */
  onDelivered?: (result: T) => void | Promise<void>
  /** In-flight state the original send set up, restored before a replay. */
  retryState?: (s: PerSessionState) => Partial<PerSessionState>
  /** Extra state to settle once the send is known to have failed. */
  failureState?: (s: PerSessionState) => Partial<PerSessionState>
}

/**
 * Deliver one user send. A failure never loses the message: the bubble keeps a
 * failure row and a replay is kept for Resend.
 */
export async function deliverUserSend<T>(delivery: UserSendDelivery<T>): Promise<void> {
  const { messageId, patchSession } = delivery
  let result: T
  try {
    result = await delivery.deliver()
  } catch (err) {
    const error = unwrapIpcInvokeError(err instanceof Error ? err.message : String(err))
    patchSession((s) => ({
      ...reduceUserMessageSendFailed(s, { type: 'user_message_send_failed', clientMessageId: messageId, error }),
      ...delivery.failureState?.(s),
    }))
    replays.set(messageId, async () => {
      patchSession((s) => ({
        messages: s.messages.map((m) => (m.id === messageId ? withoutSendFailure(m) : m)),
        ...delivery.retryState?.(s),
      }))
      await deliverUserSend(delivery)
    })
    promptForMissingCursorKey(err)
    return
  }
  await delivery.onDelivered?.(result)
}
