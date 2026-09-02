/**
 * Desktop channel — native OS banner via Electron `Notification`.
 *
 * The only channel in v1. Everything platform-specific about desktop delivery
 * belongs here; `NotificationService` must stay ignorant of Electron.
 */

import { Notification } from 'electron'
import type { NativeImage } from 'electron'
import type { NotificationIntent } from '@superone/shared/notifications'
import log from '../logger'
import type { NotificationChannel } from './notification-channel'

export interface DesktopNotificationChannelDeps {
  /** Focus the app and route to the session the user just acted on. */
  onActivate(intent: NotificationIntent): void
  /**
   * App icon for the banner. macOS derives it from the bundle and ignores this;
   * Linux (libnotify) and Windows both want it explicitly or fall back to a
   * generic placeholder.
   */
  getIcon?(): NativeImage | null
}

export class DesktopNotificationChannel implements NotificationChannel {
  readonly id = 'desktop'
  /** Live banners, so `withdraw` can close the one the user already answered. */
  private readonly shown = new Map<string, Notification>()

  constructor(private readonly deps: DesktopNotificationChannelDeps) {}

  isAvailable(): boolean {
    return Notification.isSupported()
  }

  deliver(intent: NotificationIntent): void {
    const icon = this.deps.getIcon?.() ?? undefined
    const notification = new Notification({
      title: intent.title,
      body: intent.body,
      // Let the OS dedupe/replace by our own key instead of a random UUID.
      id: intent.id,
      silent: false,
      ...(icon ? { icon } : {}),
      /**
       * The whole point of this notification is to survive the user having
       * walked away, so it must not time out on its own (Linux + Windows).
       * macOS has no equivalent option — banner-vs-alert persistence there is
       * a per-app user setting we cannot override; an unseen banner still
       * lands in Notification Center.
       */
      timeoutType: 'never',
    })
    notification.on('click', () => {
      this.shown.delete(intent.id)
      this.deps.onActivate(intent)
    })
    notification.on('close', () => {
      this.shown.delete(intent.id)
    })
    /**
     * Delivery receipt. `show()` only hands the notification to the OS — it
     * returns nothing and throws nothing when the OS drops it (an unregistered
     * bundle, a Focus filter, a missing Linux notification daemon). The 'show'
     * event is the only signal that it actually reached the user, so the two
     * are logged separately: a `posted` with no `shown` means the OS ate it.
     */
    notification.on('show', () => {
      log.info('[notifications] shown id=%s', intent.id)
    })
    /**
     * Documented as Windows-only, but macOS emits it too when
     * UNUserNotificationCenter refuses the post — e.g. `UNErrorDomain error 1`
     * (notifications not allowed for this bundle), which is exactly what an
     * unsigned dev build hits. Worth keeping: it is the difference between
     * "nothing happened" and a one-line diagnosis.
     */
    notification.on('failed', (_event, error) => {
      log.warn('[notifications] failed id=%s error=%s', intent.id, error)
    })
    this.shown.set(intent.id, notification)
    notification.show()
    log.info('[notifications] posted kind=%s session=%s id=%s', intent.kind, intent.sessionId, intent.id)
  }

  withdraw(id: string): void {
    const notification = this.shown.get(id)
    if (!notification) return
    this.shown.delete(id)
    notification.close()
  }

  dispose(): void {
    for (const notification of this.shown.values()) notification.close()
    this.shown.clear()
  }
}
