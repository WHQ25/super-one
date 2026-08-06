import type { NodeSessionRecord } from './types'
import type { SessionStore } from './ports'
import type { SqliteDatabase } from '../sqlite'

/** Parse durable settings blob (settings_json) into flat session fields. */
function parseSettingsJson(raw: string | null | undefined): {
  permissionMode: string | null
  sandboxMode: string | null
  model: string | null
  effort: string | null
  apiProviderId: string | null
} {
  const empty = {
    permissionMode: null as string | null,
    sandboxMode: null as string | null,
    model: null as string | null,
    effort: null as string | null,
    apiProviderId: null as string | null,
  }
  if (!raw) return empty
  try {
    const obj = JSON.parse(raw) as Record<string, unknown>
    const str = (key: string): string | null => {
      const v = obj[key]
      if (typeof v !== 'string') return null
      const t = v.trim()
      return t.length > 0 ? t : null
    }
    return {
      permissionMode: str('permissionMode'),
      sandboxMode: str('sandboxMode'),
      model: str('model'),
      effort: str('effort'),
      apiProviderId: str('apiProviderId'),
    }
  } catch {
    return empty
  }
}

function serializeSettingsJson(session: NodeSessionRecord): string {
  return JSON.stringify({
    permissionMode: session.permissionMode ?? null,
    sandboxMode: session.sandboxMode ?? null,
    model: session.model ?? null,
    effort: session.effort ?? null,
    apiProviderId: session.apiProviderId ?? null,
  })
}

/** SQLite-backed SessionStore (better-sqlite3 compatible). */
export function createSqliteSessionStore(db: SqliteDatabase): SessionStore {
  return {
    loadAll(): NodeSessionRecord[] {
      const rows = db
        .prepare(
          `SELECT session_id, project_id, harness_id, provider_id, title, status, transcript_json,
                  pending_interaction_json, provider_resume, cwd, created_at, updated_at,
                  COALESCE(is_pinned, 0) AS is_pinned, COALESCE(is_hidden, 0) AS is_hidden,
                  COALESCE(is_user_renamed, 0) AS is_user_renamed,
                  controller_client_session_id, COALESCE(host_action_capability_version, 0) AS host_action_capability_version,
                  COALESCE(host_action_tool_groups_json, '[]') AS host_action_tool_groups_json,
                  COALESCE(always_allowed_tools_json, '[]') AS always_allowed_tools_json,
                  settings_json,
                  COALESCE(is_automation, 0) AS is_automation,
                  automation_id
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
        is_user_renamed: number
        controller_client_session_id: string | null
        host_action_capability_version: number
        host_action_tool_groups_json: string
        always_allowed_tools_json: string
        settings_json: string | null
        is_automation: number
        automation_id: string | null
      }>
      const parseStringArray = (raw: string | null | undefined): string[] => {
        try {
          const parsed = JSON.parse(raw || '[]') as unknown
          return Array.isArray(parsed) ? parsed.filter((x): x is string => typeof x === 'string') : []
        } catch {
          return []
        }
      }
      return rows.map((r) => {
        const settings = parseSettingsJson(r.settings_json)
        return {
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
          permissionMode: settings.permissionMode,
          sandboxMode: settings.sandboxMode,
          model: settings.model,
          effort: settings.effort,
          apiProviderId: settings.apiProviderId,
          createdAt: r.created_at,
          updatedAt: r.updated_at,
          isPinned: r.is_pinned === 1,
          isHidden: r.is_hidden === 1,
          isUserRenamed: r.is_user_renamed === 1,
          controllerClientSessionId: r.controller_client_session_id ?? null,
          hostActionCapabilityVersion: r.host_action_capability_version ?? 0,
          hostActionToolGroups: parseStringArray(r.host_action_tool_groups_json),
          alwaysAllowedTools: parseStringArray(r.always_allowed_tools_json),
          isAutomation: r.is_automation === 1,
          automationId: r.automation_id ?? null,
        }
      })
    },

    save(session: NodeSessionRecord): void {
      db.prepare(
        `INSERT INTO sessions
         (session_id, project_id, harness_id, provider_id, title, status, transcript_json,
          pending_interaction_json, provider_resume, cwd, created_at, updated_at, is_pinned, is_hidden,
          is_user_renamed,
          controller_client_session_id, host_action_capability_version, host_action_tool_groups_json,
          always_allowed_tools_json, settings_json, is_automation, automation_id)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(session_id) DO UPDATE SET
           title = excluded.title,
           status = excluded.status,
           transcript_json = excluded.transcript_json,
           pending_interaction_json = excluded.pending_interaction_json,
           provider_resume = excluded.provider_resume,
           cwd = excluded.cwd,
           updated_at = excluded.updated_at,
           is_pinned = excluded.is_pinned,
           is_hidden = excluded.is_hidden,
           is_user_renamed = excluded.is_user_renamed,
           controller_client_session_id = excluded.controller_client_session_id,
           host_action_capability_version = excluded.host_action_capability_version,
           host_action_tool_groups_json = excluded.host_action_tool_groups_json,
           always_allowed_tools_json = excluded.always_allowed_tools_json,
           settings_json = excluded.settings_json,
           is_automation = excluded.is_automation,
           automation_id = excluded.automation_id`,
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
        session.isUserRenamed ? 1 : 0,
        session.controllerClientSessionId,
        session.hostActionCapabilityVersion,
        JSON.stringify(session.hostActionToolGroups ?? []),
        JSON.stringify(session.alwaysAllowedTools ?? []),
        serializeSettingsJson(session),
        session.isAutomation ? 1 : 0,
        session.automationId ?? null,
      )
    },

    delete(sessionId: string): void {
      db.prepare(`DELETE FROM sessions WHERE session_id = ?`).run(sessionId)
    },
  }
}
