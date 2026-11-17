import { isRateLimitErrorInfo } from '@superone/shared/agent-error'
import { SESSION_DURABLE_EVENT, type EnvironmentEventEnvelope } from '@superone/shared/environment'
import { randomUUID } from 'node:crypto'
import {
  SCHEDULED_SEND_DEFAULT_MESSAGE, type AgentEvent, type ImageAttachment, type ScheduledSend, type ScheduledSendPatch,
} from '@superone/shared/agent-types'
import type { SessionRuntime } from '@superone/runtime/session'
import type { NodeDatabase } from '../db/database'

type Changed = (sessionId: string, scheduled: ScheduledSend | null, delivered: boolean) => void
type Row = Omit<ScheduledSend, 'armed'> & { armed: number }
const summaryColumns = 'session_id AS sessionId, send_at AS sendAt, armed, source, message'

function schedule(row: Row): ScheduledSend { return { ...row, armed: Boolean(row.armed) } }

/** The node owns both the clock and the durable user turn, even with no clients connected. */
export class NodeScheduledSends {
  private timer?: ReturnType<typeof setInterval>
  private changed?: Changed
  private readonly resets = new Map<string, number>()
  private readonly continuations = new Map<string, { requestId: string; message: string | null; attachments: ImageAttachment[] }>()
  private readonly sending = new Set<string>()

  constructor(private readonly db: NodeDatabase, private readonly sessions: SessionRuntime) {}

  start(changed: Changed, pollMs = 30_000): void {
    this.changed = changed
    this.timer = setInterval(() => this.flush(), pollMs)
    this.timer.unref()
    this.flush()
  }

  stop(): void {
    clearInterval(this.timer)
    this.changed = undefined
  }

  get(sessionId: string): ScheduledSend | null {
    const row = this.db.prepare(`SELECT ${summaryColumns} FROM scheduled_sends WHERE session_id = ?`).get(sessionId) as Row | undefined
    return row ? schedule(row) : null
  }

  list(): ScheduledSend[] {
    return (this.db.prepare(`SELECT ${summaryColumns} FROM scheduled_sends ORDER BY send_at`).all() as Row[]).map(schedule)
  }

  set(sessionId: string, patch: ScheduledSendPatch): ScheduledSend | null {
    const prev = this.get(sessionId)
    const sendAt = patch.sendAt ?? prev?.sendAt
    if (sendAt === undefined) return null
    const source = patch.source ?? prev?.source ?? 'manual'
    if (patch.armed && !prev?.armed && source === 'manual' && sendAt <= Date.now()) return prev
    this.continuations.delete(sessionId)
    const next: ScheduledSend = {
      sessionId, sendAt, armed: patch.armed ?? prev?.armed ?? false, source,
      message: patch.message === undefined ? prev?.message ?? null : patch.message?.trim() || null,
    }
    this.db.prepare(`INSERT INTO scheduled_sends(session_id, send_at, armed, source, message, attachments, delivery_id)
      VALUES (?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(session_id) DO UPDATE SET send_at = excluded.send_at, armed = excluded.armed,
        source = excluded.source, message = excluded.message, delivery_id = excluded.delivery_id,
        attachments = CASE WHEN ? THEN excluded.attachments ELSE attachments END`).run(
      sessionId, sendAt, Number(next.armed), next.source, next.message,
      patch.attachments?.length ? JSON.stringify(patch.attachments) : null, randomUUID(), Number(patch.attachments !== undefined),
    )
    this.changed?.(sessionId, next, false)
    return next
  }

  clear(sessionId: string): null {
    this.continuations.delete(sessionId)
    this.resets.delete(sessionId)
    if (this.db.prepare('DELETE FROM scheduled_sends WHERE session_id = ?').run(sessionId).changes) {
      this.changed?.(sessionId, null, false)
    }
    return null
  }

  observe(envelope: EnvironmentEventEnvelope): void {
    if (envelope.aggregateType !== 'session') return
    const sessionId = envelope.aggregateId
    if (envelope.eventType === SESSION_DURABLE_EVENT.turnCompleted || envelope.eventType === SESSION_DURABLE_EVENT.turnInterrupted
      || envelope.eventType === SESSION_DURABLE_EVENT.turnError) {
      this.continuations.delete(sessionId)
      return
    }
    if (envelope.eventType !== SESSION_DURABLE_EVENT.agentEvent) return
    const event = (envelope.payload as { event?: AgentEvent })?.event
    if (event?.type === 'rate_limit' && event.resetsAt) this.resets.set(sessionId, event.resetsAt)
    if (event?.type === 'message_error' && event.errorInfo && isRateLimitErrorInfo(event.errorInfo)) {
      const reset = event.errorInfo.resetsAt ?? this.resets.get(sessionId)
      if (!reset || reset * 1000 <= Date.now()) return
      const existing = this.get(sessionId)
      const continuation = this.continuations.get(sessionId)
      const retry = continuation?.requestId === envelope.causationRequestId ? continuation : undefined
      if (existing?.source === 'manual' || (existing?.armed && !retry)) return
      this.set(sessionId, { source: 'rate_limit', sendAt: reset * 1000 + 60_000, armed: !!retry,
        message: retry?.message ?? null, attachments: retry?.attachments ?? null })
    } else if (event?.type === 'message_complete' || event?.type === 'message_interrupted'
      || (event?.type === 'agent_setting_change' && event.patch?.apiProviderId !== undefined)) {
      const row = this.get(sessionId)
      if (row?.source === 'rate_limit' && !row.armed) this.clear(sessionId)
    }
  }

  private flush(): void {
    const due = this.db.prepare(`SELECT session_id AS sessionId, armed FROM scheduled_sends
      WHERE send_at <= ? AND (armed = 1 OR source = 'rate_limit')`)
      .all(Date.now()) as Array<{ sessionId: string; armed: number }>
    for (const { sessionId, armed } of due) {
      if (!armed) {
        this.clear(sessionId)
        continue
      }
      if (!this.sending.has(sessionId)) void this.deliver(sessionId)
    }
  }

  private async deliver(sessionId: string): Promise<void> {
    this.sending.add(sessionId)
    try {
      const session = this.sessions.get(sessionId)
      if (!session || session.closed) {
        this.clear(sessionId)
        return
      }
      if (session.status === 'streaming' || session.pendingInteraction) return
      const row = this.db.prepare('SELECT message, source, attachments, delivery_id FROM scheduled_sends WHERE session_id = ? AND armed = 1 AND send_at <= ?')
        .get(sessionId, Date.now()) as { message: string | null; source: string; attachments: string | null; delivery_id: string } | undefined
      if (!row) return
      const images: ImageAttachment[] = row.attachments ? JSON.parse(row.attachments) : []
      if (row.source === 'rate_limit') {
        this.continuations.set(sessionId, { requestId: row.delivery_id, message: row.message, attachments: images })
      }
      await this.sessions.sendWithoutLease({
        sessionId, text: row.message || (images.length ? '' : SCHEDULED_SEND_DEFAULT_MESSAGE),
        requestId: row.delivery_id, clientMessageId: row.delivery_id, images, echoUserMessage: true,
      })
      // The transcript is durable now. A retry after a crash has the same message ID.
      if (this.db.prepare('DELETE FROM scheduled_sends WHERE session_id = ? AND delivery_id = ?').run(sessionId, row.delivery_id).changes) {
        this.changed?.(sessionId, null, true)
      }
    } catch (error) {
      console.warn('[scheduled-send] delivery failed, will retry', sessionId, error)
    } finally {
      this.sending.delete(sessionId)
    }
  }
}
