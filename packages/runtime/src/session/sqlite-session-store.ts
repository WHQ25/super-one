import type { NodeSessionRecord } from './types'
import type { SessionStore } from './ports'
import type { SqliteDatabase } from '../sqlite'

/** SQLite-backed SessionStore (better-sqlite3 compatible). */
export function createSqliteSessionStore(db: SqliteDatabase): SessionStore {
  return {
    loadAll(): NodeSessionRecord[] {
      const rows = db
        .prepare(
          `SELECT session_id, project_id, harness_id, provider_id, title, status, transcript_json,
                  pending_interaction_json, provider_resume, cwd, created_at, updated_at,
                  COALESCE(is_pinned, 0) AS is_pinned, COALESCE(is_hidden, 0) AS is_hidden
           FROM sessions`,
        )
        .all() as Array<{
        session_id: string
        project_id: string
        harness_id: string
        provider_id: string
        title: string | null
        status: NodeSessionRecord['status']
        transcript_json: string
        pending_interaction_json: string | null
        provider_resume: string | null
        cwd: string | null
        created_at: number
        updated_at: number
        is_pinned: number
        is_hidden: number
      }>
      return rows.map((r) => ({
        sessionId: r.session_id,
        projectId: r.project_id,
        harnessId: r.harness_id,
        providerId: r.provider_id,
        title: r.title,
        status: r.status,
        transcript: JSON.parse(r.transcript_json) as NodeSessionRecord['transcript'],
        pendingInteraction: r.pending_interaction_json
          ? (JSON.parse(r.pending_interaction_json) as NodeSessionRecord['pendingInteraction'])
          : null,
        providerResume: r.provider_resume,
        cwd: r.cwd ?? null,
        createdAt: r.created_at,
        updatedAt: r.updated_at,
        isPinned: r.is_pinned === 1,
        isHidden: r.is_hidden === 1,
      }))
    },

    save(session: NodeSessionRecord): void {
      db.prepare(
        `INSERT INTO sessions
         (session_id, project_id, harness_id, provider_id, title, status, transcript_json,
          pending_interaction_json, provider_resume, cwd, created_at, updated_at, is_pinned, is_hidden)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(session_id) DO UPDATE SET
           title = excluded.title,
           status = excluded.status,
           transcript_json = excluded.transcript_json,
           pending_interaction_json = excluded.pending_interaction_json,
           provider_resume = excluded.provider_resume,
           cwd = excluded.cwd,
           updated_at = excluded.updated_at,
           is_pinned = excluded.is_pinned,
           is_hidden = excluded.is_hidden`,
      ).run(
        session.sessionId,
        session.projectId,
        session.harnessId,
        session.providerId,
        session.title,
        session.status,
        JSON.stringify(session.transcript),
        session.pendingInteraction ? JSON.stringify(session.pendingInteraction) : null,
        session.providerResume,
        session.cwd,
        session.createdAt,
        session.updatedAt,
        session.isPinned ? 1 : 0,
        session.isHidden ? 1 : 0,
      )
    },

    delete(sessionId: string): void {
      db.prepare(`DELETE FROM sessions WHERE session_id = ?`).run(sessionId)
    },
  }
}
