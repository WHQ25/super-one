/**
 * Policy + dispatch: the one place that decides whether an AgentEvent becomes a
 * user-facing notification, and fans the result to every registered channel.
 *
 * Deliberately free of Electron imports — the window-focus check and the clock
 * are injected — so the whole policy is unit-testable without an app instance.
 */

import type { AgentEvent } from '@superone/shared/agent-types'
import type { NotificationIntent, NotificationSettings } from '@superone/shared/notifications'
import { isNotificationKindEnabled } from '@superone/shared/notifications'
import log from '../logger'
import type { NotificationChannel } from './notification-channel'
import { RunTracker, intentForEvent, withdrawIdForEvent, type IntentContext } from './notification-intent'

export interface NotificationServiceDeps {
  readSettings(): NotificationSettings
  /**
   * True when any SuperOne window has OS focus. The chosen policy is
   * whole-app: if the user is looking at SuperOne at all, the in-app UI is
   * enough and a system banner would be redundant noise.
   */
  isAppFocused(): boolean
  /**
   * True while any paired phone holds a live transport to this host. The user
   * chose to be reached on the phone, whose UI already surfaces the request;
   * a desktop banner on top of that is noise. Coarse by design — "connected"
   * is not "in the foreground" — and accepted as such until a mobile push
   * channel exists.
   */
  hasMobileOnline(): boolean
  describeSession: IntentContext['describeSession']
  t: IntentContext['t']
  now?: () => number
}

export class NotificationService {
  private readonly channels: NotificationChannel[] = []
  /**
   * Notification ids currently outstanding. Doubles as the dedupe set: pending
   * interactions are replayed verbatim on reconnect / window reopen, and
   * without this every reconnect would re-ring the same permission gate.
   */
  private readonly active = new Set<string>()
  private readonly runs = new RunTracker()
  private readonly now: () => number

  constructor(private readonly deps: NotificationServiceDeps) {
    this.now = deps.now ?? Date.now
  }

  registerChannel(channel: NotificationChannel): () => void {
    this.channels.push(channel)
    return () => {
      const i = this.channels.indexOf(channel)
      if (i >= 0) this.channels.splice(i, 1)
    }
  }

  /**
   * Feed every event that reaches the renderer through here. Cheap for the
   * ~99% of events that are not interactions: one switch on `event.type`.
   */
  handleEvent(event: AgentEvent): void {
    // Observed unconditionally, before any early return: the tracker must see
    // the stream open even when notifications are switched off, or a run that
    // started disabled and ended enabled would never ring.
    const runCompleted = this.runs.observe(event)

    const withdrawId = withdrawIdForEvent(event)
    if (withdrawId) {
      this.withdraw(withdrawId)
      return
    }

    const settings = this.deps.readSettings()
    if (!settings.enabled) return

    const intent = intentForEvent(event, {
      t: this.deps.t,
      describeSession: this.deps.describeSession,
      now: this.now,
      runCompleted,
    })
    if (!intent) return
    if (!isNotificationKindEnabled(settings, intent.kind)) return
    if (this.active.has(intent.id)) return

    // Claim the slot even when suppressed. Pending interactions are replayed
    // verbatim on every reconnect, so a request the user already saw in-app
    // must not ring later just because the window happens to be blurred by
    // then — that reads as a banner arriving out of nowhere.
    this.active.add(intent.id)
    // Logged, not silent: "why did I not get a notification" is the first
    // question this feature will ever be debugged for.
    if (this.deps.isAppFocused()) {
      log.info('[notifications] suppressed (app focused) kind=%s id=%s', intent.kind, intent.id)
      return
    }
    if (this.deps.hasMobileOnline()) {
      log.info('[notifications] suppressed (mobile online) kind=%s id=%s', intent.kind, intent.id)
      return
    }

    this.dispatch(intent)
  }

  private dispatch(intent: NotificationIntent): void {
    for (const channel of this.channels) {
      if (!channel.isAvailable()) continue
      try {
        // A channel may deliver asynchronously (a push round-trip); a failure
        // in one channel must not stop the others.
        void Promise.resolve(channel.deliver(intent)).catch((err) => {
          log.warn('[notifications] channel %s deliver failed: %s', channel.id, err instanceof Error ? err.message : String(err))
        })
      } catch (err) {
        log.warn('[notifications] channel %s threw: %s', channel.id, err instanceof Error ? err.message : String(err))
      }
    }
  }

  private withdraw(id: string): void {
    if (!this.active.delete(id)) return
    for (const channel of this.channels) {
      try {
        channel.withdraw(id)
      } catch (err) {
        log.warn('[notifications] channel %s withdraw failed: %s', channel.id, err instanceof Error ? err.message : String(err))
      }
    }
  }

  dispose(): void {
    for (const channel of this.channels) channel.dispose?.()
    this.channels.length = 0
    this.active.clear()
  }
}
