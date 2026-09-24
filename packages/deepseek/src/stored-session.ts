/**
 * Cold reads of a persisted dsh session.
 *
 * Persistence is handle-based: `open(id, 'read')` hands out a reader that must
 * be closed, and only one WRITE handle may exist per session. Reading through a
 * read handle is what keeps a cold read from ever contending with the agent
 * that is about to resume the same session.
 */

import type { Context } from '@deepseek-ai/cordis'
import type { SessionEvent, SessionHeader, SessionId } from '@deepseek-ai/dsh-session'
// Side-effect type import: merges `sessionPersistence` onto `Context`.
import type {} from '@deepseek-ai/dsh-session-persistence'

export interface StoredSession {
  header: SessionHeader
  events: readonly SessionEvent[]
}

/**
 * Read one stored session's header and full event log.
 *
 * `stat` answers existence first, so "never materialized" is told apart from
 * "unreadable" without matching on a backend error. A created-but-empty log is
 * returned as such — its header is real.
 * @param ctx - a context that can resolve session persistence.
 * @param id - the session to read.
 * @returns the session, or `undefined` without persistence or without a log.
 */
export async function readStoredSession(ctx: Context, id: SessionId): Promise<StoredSession | undefined> {
  const persistence = ctx.get('sessionPersistence')
  if (!persistence) return undefined
  if (!(await persistence.stat(id))) return undefined
  const handle = await persistence.open(id, 'read')
  try {
    const { events } = await handle.read()
    return { header: handle.header, events }
  } finally {
    await handle.close()
  }
}
