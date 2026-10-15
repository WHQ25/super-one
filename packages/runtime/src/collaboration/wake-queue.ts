import type { SqliteDatabase } from '../sqlite'
import type { AgentEvent } from '@superone/shared/agent-types'
import { isNodeRestartInterruption } from '@superone/shared/session-interruption'

export const COLLABORATION_WAKE_TABLE_DDL = `
CREATE TABLE IF NOT EXISTS collaboration_wakes (
  session_id TEXT NOT NULL,
  notification_id TEXT NOT NULL,
  content TEXT NOT NULL,
  state TEXT NOT NULL DEFAULT 'queued',
  attempts INTEGER NOT NULL DEFAULT 0,
  next_attempt_at INTEGER NOT NULL DEFAULT 0,
  last_error TEXT,
  created_at INTEGER NOT NULL,
  PRIMARY KEY (session_id, notification_id)
);
CREATE INDEX IF NOT EXISTS idx_collaboration_wakes_pending
  ON collaboration_wakes(state, next_attempt_at);
CREATE TABLE IF NOT EXISTS collaboration_wake_recipients (
  session_id TEXT PRIMARY KEY NOT NULL,
  paused INTEGER NOT NULL DEFAULT 0
);
`

export const COLLABORATION_WAKE_MAX_ATTEMPTS = 3
const RETRY_DELAYS_MS = [10_000, 30_000]

/** Readiness changed during preparation; retry only on a later readiness event. */
export class CollaborationWakeDeferredError extends Error {}

interface WakeRow {
  session_id: string
  notification_id: string
  content: string
  attempts: number
  next_attempt_at: number
}

/**
 * Durable collaboration wake inbox. Enqueue is the producer's acknowledgement;
 * harness admission is a separate, bounded consumer operation. Provider errors
 * after admission never cause the producer to enqueue the notification again.
 * Rows are retained after admission for deduplication and failure inspection.
 */
export class CollaborationWakeQueue {
  private readonly delivering = new Set<string>()
  private readonly paused = new Set<string>()
  private timer: ReturnType<typeof setTimeout> | null = null
  private closed = false
  private scheduled = false

  constructor(
    private readonly db: SqliteDatabase & { exec(sql: string): unknown },
    private readonly deps: {
      admit(sessionId: string, content: string, notificationId: string, onAdmitted: () => void, beforeInput: () => void): Promise<unknown>
      canAdmit?(sessionId: string): boolean
      warn(message: string): void
      now?: () => number
    },
  ) {
    // Also supports isolated host fixtures; production migrations use this DDL.
    db.exec(COLLABORATION_WAKE_TABLE_DDL)
    // A process crash may leave dispatch outcome unknown. Keep the payload,
    // but never replay potentially executed work automatically.
    db.prepare(`INSERT INTO collaboration_wake_recipients (session_id, paused)
      SELECT DISTINCT session_id, 1 FROM collaboration_wakes WHERE state = 'dispatching'
      ON CONFLICT (session_id) DO UPDATE SET paused = 1`).run()
    db.prepare(`UPDATE collaboration_wakes SET state = 'uncertain',
      last_error = 'Notification admission interrupted before acknowledgement; automatic replay paused'
      WHERE state = 'dispatching'`).run()
    // Preparation cannot submit input. A crash here retains the counted
    // attempt, but may safely resume without permanently pausing the recipient.
    db.prepare("UPDATE collaboration_wakes SET state = 'queued' WHERE state = 'preparing'").run()
    for (const row of db.prepare('SELECT session_id FROM collaboration_wake_recipients WHERE paused = 1').all() as Array<{ session_id: string }>) {
      this.paused.add(row.session_id)
    }
  }

  enqueue(sessionId: string, notificationId: string, content: string): void {
    if (this.closed) throw new Error('Collaboration notification queue is closed')
    if (!sessionId || !notificationId || !content.trim()) throw new Error('Invalid collaboration notification')
    this.db.prepare(`
      INSERT INTO collaboration_wakes (session_id, notification_id, content, created_at)
      VALUES (?, ?, ?, ?) ON CONFLICT (session_id, notification_id) DO NOTHING
    `).run(sessionId, notificationId, content, this.now())
    this.start()
  }

  /** Resume queued admission attempts, retaining their budget across restarts. */
  start(): void {
    if (this.closed || this.scheduled) return
    this.scheduled = true
    queueMicrotask(() => {
      this.scheduled = false
      if (!this.closed) this.flush()
    })
  }

  private now(): number { return (this.deps.now ?? Date.now)() }

  /** Runtime errors and human stops pause consumption, without rejecting new mail. */
  observe(sessionId: string, event: AgentEvent): void {
    if (this.closed) return
    if (event.type === 'message_interrupted' && isNodeRestartInterruption(event.reason)) return
    if (event.type === 'message_error' || event.type === 'message_interrupted') {
      this.pause(sessionId)
    } else if (event.type === 'content_delta' || event.type === 'message_complete') {
      if (!this.paused.has(sessionId)) return
      // Provider output, rather than an optimistic local message_start, proves
      // the session can run again. This never refreshes exhausted attempt budgets.
      this.db.prepare('UPDATE collaboration_wake_recipients SET paused = 0 WHERE session_id = ?').run(sessionId)
      this.paused.delete(sessionId)
      this.start()
    }
  }

  /** True while a wake for `sessionId` is being prepared or handed to its harness. */
  hasInFlight(sessionId: string): boolean {
    if (this.delivering.has(sessionId)) return true
    return Boolean(this.db.prepare(`SELECT 1 FROM collaboration_wakes
      WHERE session_id = ? AND state IN ('preparing', 'dispatching') LIMIT 1`).get(sessionId))
  }

  /**
   * Hand `from`'s wakes to `to`, the session that continues it. Settled rows
   * move too, so deduplication by notification id keeps holding for the new
   * recipient. `to` starts paused: its own first output (see {@link observe})
   * releases the moved wakes, so none runs ahead of the turn the user starts.
   * Throws while a wake for `from` is in flight.
   */
  migrate(from: string, to: string): void {
    if (this.hasInFlight(from)) throw new Error(`A collaboration wake for ${from} is being delivered`)
    this.db.prepare('UPDATE collaboration_wakes SET session_id = ? WHERE session_id = ?').run(to, from)
    this.db.prepare('DELETE FROM collaboration_wake_recipients WHERE session_id = ?').run(from)
    this.paused.delete(from)
    this.pause(to)
  }

  private pause(sessionId: string): void {
    if (this.paused.has(sessionId)) return
    this.db.prepare(`INSERT INTO collaboration_wake_recipients (session_id, paused)
      VALUES (?, 1) ON CONFLICT (session_id) DO UPDATE SET paused = 1`).run(sessionId)
    this.paused.add(sessionId)
  }

  private flush(): void {
    if (this.closed) return
    if (this.timer) clearTimeout(this.timer)
    this.timer = null
    const rows = this.db.prepare(`
      SELECT session_id, notification_id, content, attempts, next_attempt_at
      FROM collaboration_wakes w WHERE state = 'queued' AND NOT EXISTS (
        SELECT 1 FROM collaboration_wake_recipients r WHERE r.session_id = w.session_id AND r.paused = 1
      ) ORDER BY created_at, rowid
    `).all() as WakeRow[]
    let nextAttemptAt = Infinity
    for (const row of rows) {
      if (this.delivering.has(row.session_id) || this.paused.has(row.session_id)) continue
      if (this.deps.canAdmit?.(row.session_id) === false) continue
      if (row.attempts >= COLLABORATION_WAKE_MAX_ATTEMPTS) {
        this.db.prepare(`UPDATE collaboration_wakes SET state = 'failed'
          WHERE session_id = ? AND notification_id = ?`).run(row.session_id, row.notification_id)
        this.pause(row.session_id)
        continue
      }
      if (row.next_attempt_at > this.now()) {
        nextAttemptAt = Math.min(nextAttemptAt, row.next_attempt_at)
        continue
      }
      this.delivering.add(row.session_id)
      // Persist the attempt before dispatch, so a crash cannot reset the budget.
      this.db.prepare(`UPDATE collaboration_wakes SET state = 'preparing', attempts = attempts + 1
        WHERE session_id = ? AND notification_id = ?`).run(row.session_id, row.notification_id)
      void this.admit(row)
    }
    if (Number.isFinite(nextAttemptAt)) {
      this.timer = setTimeout(() => { this.timer = null; this.flush() }, Math.max(1, nextAttemptAt - this.now()))
      this.timer.unref?.()
    }
  }

  private async admit(row: WakeRow): Promise<void> {
    let admitted = false
    let deferred = false
    const confirm = () => {
      if (admitted) return
      // This callback runs immediately before the actual prompt handoff.
      // Only a failure to persist its final receipt leaves an ambiguous row.
      this.db.prepare(`UPDATE collaboration_wakes SET state = 'dispatching'
        WHERE session_id = ? AND notification_id = ?`).run(row.session_id, row.notification_id)
      admitted = true
      // The receipt must survive graceful shutdown too. Write inside the
      // backend acceptance callback, before promise continuations or disposal.
      try {
        this.db.prepare(`UPDATE collaboration_wakes SET state = 'admitted', last_error = NULL
          WHERE session_id = ? AND notification_id = ?`).run(row.session_id, row.notification_id)
      } catch (error) {
        // Input already reached the backend. Retain the dispatching row for
        // uncertain-outcome recovery, and never resend on a receipt-write error.
        this.paused.add(row.session_id)
        this.deps.warn(`[collaboration-wake] accepted input receipt failed sid=${row.session_id}: ${String(error)}`)
      }
    }
    try {
      await this.deps.admit(row.session_id, row.content, row.notification_id, confirm, () => {
        if (this.closed || this.paused.has(row.session_id)) throw new CollaborationWakeDeferredError('Notification recipient is paused or shutting down')
      })
      // Remote admission already has a durable, idempotent node receipt.
      confirm()
    } catch (error) {
      if (!admitted) {
        const message = error instanceof Error ? error.message : String(error)
        deferred = this.closed || error instanceof CollaborationWakeDeferredError
        const attempts = row.attempts + (deferred ? 0 : 1)
        this.db.prepare(`UPDATE collaboration_wakes SET state = ?, attempts = ?, next_attempt_at = ?, last_error = ?
          WHERE session_id = ? AND notification_id = ?`).run(
          attempts >= COLLABORATION_WAKE_MAX_ATTEMPTS ? 'failed' : 'queued', attempts,
          deferred ? 0 : this.now() + (RETRY_DELAYS_MS[attempts - 1] ?? 0), message, row.session_id, row.notification_id,
        )
        if (attempts >= COLLABORATION_WAKE_MAX_ATTEMPTS) {
          this.pause(row.session_id)
        }
        if (!deferred) this.deps.warn(`[collaboration-wake] admission failed sid=${row.session_id} attempt=${attempts}/${COLLABORATION_WAKE_MAX_ATTEMPTS}: ${message}`)
      }
    } finally {
      this.delivering.delete(row.session_id)
      if (!this.closed && !deferred) this.start()
    }
  }

  /** Leave durable work and attempt counts intact when the host shuts down. */
  dispose(): void {
    this.closed = true
    if (this.timer) clearTimeout(this.timer)
    this.timer = null
  }
}
