import type { SendMessageRequest } from '@superone/shared/agent-types'
import type { TaskNotificationAdmissionOptions, TaskNotificationInjectResult } from './types'
import { taskNotificationRequest } from './task-notification-queue'

/** Stable inbox IDs bypass lossy backend queues and ride Session's send chain. */
export async function deliverTaskNotification(
  content: string,
  host: {
    assertAvailable(): void
    start(): Promise<void>
    inject(content: string): Promise<TaskNotificationInjectResult>
    send(request: SendMessageRequest, onAccepted?: () => void): Promise<unknown>
    isStreaming(): boolean
    warn(error: unknown): void
  },
  onAccepted?: () => void,
  opts?: TaskNotificationAdmissionOptions,
): Promise<void> {
  host.assertAvailable()
  const text = content.trim()
  if (!text) { onAccepted?.(); return }
  await host.start()
  if (!opts) {
    try {
      const outcome = await host.inject(text)
      if (outcome === 'sent-inline' || outcome === 'deferred') { onAccepted?.(); return }
    } catch (error) { host.warn(error) }
  }
  await host.send({
    ...taskNotificationRequest(text),
    ...(opts ? { clientMessageId: opts.clientMessageId } : {}),
    // Stable inbox work stays on the Session chain even if another turn starts
    // during runtime preparation; it must not enter an ephemeral backend queue.
    priority: opts ? 'now' : host.isStreaming() ? 'next' : 'now',
  }, onAccepted)
}
