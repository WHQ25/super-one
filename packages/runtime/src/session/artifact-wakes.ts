import type { HostActionStore } from './host-action-store'

/**
 * Artifact-completion wakes, injected once per session and `notificationId`
 * (`docs/architecture/session-sync-zone.md` §5.3), because the desktop retries
 * a wake until it is acknowledged.
 */
export class ArtifactWakes {
  /**
   * Stands in for the host-action store when there is none. In memory: a
   * restart may let one duplicate through, which is the right way round — a
   * repeated wake is noise, a lost one leaves the agent believing a path it can
   * read is gone.
   */
  private readonly delivered = new Set<string>()
  /** Deliveries in flight, so concurrent retries share one turn instead of racing. */
  private readonly delivering = new Map<string, Promise<void>>()

  constructor(private readonly store: Pick<HostActionStore, 'hasDeliveredNotification' | 'recordDeliveredNotification'> | null) {}

  async deliverOnce(sessionId: string, notificationId: string, inject: () => Promise<unknown>): Promise<{ delivered: true }> {
    // Keyed by session as well as id: two sessions' jobs are unrelated even
    // when their ids collide. Recorded only *after* the turn is accepted — a
    // receipt written before the await turns a transient failure into a
    // permanently lost notification, which is the one outcome this channel
    // exists to prevent.
    const key = `${sessionId}\u0000${notificationId}`
    const delivered = this.store ? this.store.hasDeliveredNotification(sessionId, notificationId) : this.delivered.has(key)
    if (delivered) return { delivered: true }
    const existing = this.delivering.get(key)
    if (existing) {
      await existing
      return { delivered: true }
    }
    const work = inject()
      .then(() => {
        if (this.store) {
          this.store.recordDeliveredNotification(sessionId, notificationId)
          return
        }
        this.delivered.add(key)
        if (this.delivered.size > 4096) {
          const oldest = this.delivered.values().next().value
          if (oldest !== undefined) this.delivered.delete(oldest)
        }
      })
      .finally(() => this.delivering.delete(key))
    this.delivering.set(key, work)
    await work
    return { delivered: true }
  }
}
