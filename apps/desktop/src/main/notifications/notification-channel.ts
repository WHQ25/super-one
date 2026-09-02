/**
 * Dispatch layer contract.
 *
 * A channel is a *transport*, not a policy: by the time `deliver` is called the
 * service has already decided the user should be interrupted. A channel only
 * decides whether it can physically deliver (`isAvailable`) and how.
 *
 * Planned channels beyond the desktop one:
 * - mobile push (relay → APNs/FCM) — needs the relay to hold device push tokens,
 *   because the WebSocket is down exactly when a push matters most
 * - webhook / Slack for headless remote nodes
 */

import type { NotificationIntent } from '@superone/shared/notifications'

export interface NotificationChannel {
  /** Stable id for logging and (later) per-channel settings. */
  readonly id: string

  /**
   * Whether this channel can deliver right now. Checked per intent, not once at
   * startup: OS permission can be revoked, and a push channel has no target
   * until a device pairs.
   */
  isAvailable(): boolean

  deliver(intent: NotificationIntent): void | Promise<void>

  /**
   * Retract an already-delivered notification (the human answered elsewhere).
   * Must be a no-op for unknown ids — resolutions routinely arrive for
   * interactions that were never notified (e.g. answered while focused).
   */
  withdraw(id: string): void

  /** Drop all state on shutdown. */
  dispose?(): void
}
