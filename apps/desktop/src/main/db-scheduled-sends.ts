import { getDb } from './database'
import log from './logger'
import type { ScheduledSend, ScheduledSendPatch, ScheduledSendSource } from '@superone/shared/agent-types'

/**
 * Persistence for the composer's scheduled send — at most one per session.
 *
 * `armed = 0` is an offer on screen that nothing owes yet; `armed = 1` means the
 * scheduler owes this session a send at `send_at`. Both states are persisted
 * because the case this exists for — waiting out a rate-limit window — is
 * routinely measured in hours, far longer than one app run, so an in-memory
 * timer would silently never fire.
 */

interface DbScheduledSend {
  session_id: string
  send_at: string
  message: string | null
  armed: number
  source: string
  created_at: string
}

function toScheduledSend(row: DbScheduledSend): ScheduledSend {
  return {
    sessionId: row.session_id,
    sendAt: Date.parse(row.send_at),
    message: row.message,
    armed: row.armed === 1,
    source: row.source === 'rate_limit' ? 'rate_limit' : 'manual',
  }
}

export function getScheduledSend(sessionId: string): ScheduledSend | null {
  const row = getDb()
    .prepare('SELECT * FROM scheduled_sends WHERE session_id = ?')
    .get(sessionId) as DbScheduledSend | undefined
  return row ? toScheduledSend(row) : null
}

/**
 * Every queued send, for the sidebar.
 *
 * The list is one row per session and only grows with things the user armed by
 * hand or was offered, so there is nothing to paginate — the renderer keeps the
 * whole set and the change broadcast keeps it current.
 */
export function listScheduledSends(): ScheduledSend[] {
  const rows = getDb()
    .prepare('SELECT * FROM scheduled_sends ORDER BY send_at ASC')
    .all() as DbScheduledSend[]
  return rows.map(toScheduledSend)
}

/** Armed rows whose `send_at` has passed. */
export function listDueScheduledSends(nowMs: number): ScheduledSend[] {
  const rows = getDb()
    .prepare('SELECT * FROM scheduled_sends WHERE armed = 1 AND send_at <= ?')
    .all(new Date(nowMs).toISOString()) as DbScheduledSend[]
  return rows.map(toScheduledSend)
}

/**
 * Create or amend the session's scheduled send.
 *
 * Omitted fields keep their stored value, which is what lets the composer flip
 * `armed` without restating the time and re-time a queued message without
 * restating its text. Creating a row needs `sendAt` — there is nothing sensible
 * to schedule against otherwise, and inventing one would fire at a time nobody
 * chose.
 */
export function upsertScheduledSend(sessionId: string, patch: ScheduledSendPatch): ScheduledSend | null {
  const prev = getScheduledSend(sessionId)
  const sendAt = patch.sendAt ?? prev?.sendAt
  if (sendAt === undefined) return null

  const message = patch.message === undefined ? (prev?.message ?? null) : (patch.message?.trim() || null)
  const armed = patch.armed ?? prev?.armed ?? false
  const source: ScheduledSendSource = patch.source ?? prev?.source ?? 'manual'

  try {
    getDb()
      .prepare(`
        INSERT INTO scheduled_sends (session_id, send_at, message, armed, source, created_at)
        VALUES (?, ?, ?, ?, ?, ?)
        ON CONFLICT(session_id) DO UPDATE SET
          send_at = excluded.send_at,
          message = excluded.message,
          armed = excluded.armed,
          source = excluded.source
      `)
      .run(
        sessionId,
        new Date(sendAt).toISOString(),
        message,
        armed ? 1 : 0,
        source,
        // Only read on insert — the conflict branch deliberately leaves it alone.
        new Date().toISOString(),
      )
  } catch (err) {
    // Session row not persisted yet (never-messaged session) — nothing to queue.
    log.debug('[scheduled-send] upsert failed sid=%s: %s', sessionId, String(err))
    return null
  }
  return getScheduledSend(sessionId)
}

export function deleteScheduledSend(sessionId: string): void {
  getDb().prepare('DELETE FROM scheduled_sends WHERE session_id = ?').run(sessionId)
}

/** Drop only rows a stall created — a manual schedule outlives the turn it sat through. */
export function deleteScheduledSendBySource(sessionId: string, source: ScheduledSendSource): void {
  getDb().prepare('DELETE FROM scheduled_sends WHERE session_id = ? AND source = ?').run(sessionId, source)
}
