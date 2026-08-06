/**
 * SQLite-backed automations table (node / CLI).
 * Project-scoped CRUD + due-row query + run status updates.
 */

import { randomUUID } from 'node:crypto'
import type {
  AgentRunConfig,
  AutomationRunStatus,
  AutomationSchedule,
  CreateAutomationRequest,
  UpdateAutomationRequest,
} from '@superone/shared/agent-types'
import type { SqliteDatabase } from '../sqlite'
import { computeNextRunAt } from './schedule'

export interface AutomationRecord {
  id: string
  projectId: string
  /** Absolute project path when known (joined at list time). */
  projectPath: string
  name: string
  prompt: string
  agentConfig: AgentRunConfig
  schedule: AutomationSchedule
  enabled: boolean
  lastRunAt?: string
  lastRunStatus?: AutomationRunStatus
  lastRunSessionId?: string
  nextRunAt?: string
  createdAt: string
  updatedAt: string
}

interface DbAutomationRow {
  id: string
  project_id: string
  name: string
  prompt: string
  agent_config_json: string
  schedule_json: string
  enabled: number
  last_run_at: string | null
  last_run_status: string | null
  last_run_session_id: string | null
  next_run_at: string | null
  created_at: string
  updated_at: string
}

export function ensureAutomationsTable(db: SqliteDatabase & { exec?: (sql: string) => void }): void {
  const exec =
    typeof db.exec === 'function'
      ? db.exec.bind(db)
      : (sql: string) => {
          // better-sqlite3 Database has exec; pure SqliteDatabase may not.
          // Fall back to prepare for single-statement DDL only.
          for (const stmt of sql
            .split(';')
            .map((s) => s.trim())
            .filter(Boolean)) {
            db.prepare(stmt).run()
          }
        }
  exec(`
CREATE TABLE IF NOT EXISTS automations (
  id TEXT PRIMARY KEY NOT NULL,
  project_id TEXT NOT NULL,
  name TEXT NOT NULL,
  prompt TEXT NOT NULL,
  agent_config_json TEXT NOT NULL,
  schedule_json TEXT NOT NULL,
  enabled INTEGER NOT NULL DEFAULT 1,
  last_run_at TEXT,
  last_run_status TEXT,
  last_run_session_id TEXT,
  next_run_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_automations_project ON automations(project_id);
CREATE INDEX IF NOT EXISTS idx_automations_next_run ON automations(enabled, next_run_at);
`)
}

function toRecord(row: DbAutomationRow, projectPath: string): AutomationRecord {
  return {
    id: row.id,
    projectId: row.project_id,
    projectPath,
    name: row.name,
    prompt: row.prompt,
    agentConfig: JSON.parse(row.agent_config_json) as AgentRunConfig,
    schedule: JSON.parse(row.schedule_json) as AutomationSchedule,
    enabled: row.enabled === 1,
    lastRunAt: row.last_run_at ?? undefined,
    lastRunStatus: (row.last_run_status as AutomationRunStatus) ?? undefined,
    lastRunSessionId: row.last_run_session_id ?? undefined,
    nextRunAt: row.next_run_at ?? undefined,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }
}

export interface AutomationStore {
  listForProject(projectId: string, projectPath: string): AutomationRecord[]
  get(id: string): (AutomationRecord & { projectId: string }) | undefined
  create(projectId: string, projectPath: string, data: CreateAutomationRequest): AutomationRecord
  update(id: string, data: UpdateAutomationRequest): AutomationRecord | undefined
  delete(id: string): boolean
  listDue(nowIso: string): AutomationRecord[]
  updateRunStatus(
    id: string,
    status: AutomationRunStatus,
    sessionId?: string,
    nextRunAt?: string | null,
  ): void
  refreshAllNextRunAt(): void
}

/**
 * Resolve project path for an automation row.
 * When joining projects fails, pass empty path (listDue uses projects join).
 */
export function createAutomationStore(
  db: SqliteDatabase,
  resolveProjectPath: (projectId: string) => string | null,
): AutomationStore {
  return {
    listForProject(projectId, projectPath) {
      const rows = db
        .prepare('SELECT * FROM automations WHERE project_id = ? ORDER BY created_at DESC')
        .all(projectId) as DbAutomationRow[]
      return rows.map((r) => toRecord(r, projectPath))
    },

    get(id) {
      const row = db.prepare('SELECT * FROM automations WHERE id = ?').get(id) as
        | DbAutomationRow
        | undefined
      if (!row) return undefined
      const path = resolveProjectPath(row.project_id) ?? ''
      return { ...toRecord(row, path), projectId: row.project_id }
    },

    create(projectId, projectPath, data) {
      const id = randomUUID()
      const now = new Date().toISOString()
      const nextRunAt = computeNextRunAt(data.schedule)
      db.prepare(
        `INSERT INTO automations
         (id, project_id, name, prompt, agent_config_json, schedule_json, enabled, next_run_at, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, 1, ?, ?, ?)`,
      ).run(
        id,
        projectId,
        data.name,
        data.prompt,
        JSON.stringify(data.agentConfig),
        JSON.stringify(data.schedule),
        nextRunAt ?? null,
        now,
        now,
      )
      return this.get(id)! as AutomationRecord
    },

    update(id, data) {
      const existing = this.get(id)
      if (!existing) return undefined
      const now = new Date().toISOString()
      const name = data.name ?? existing.name
      const prompt = data.prompt ?? existing.prompt
      const agentConfig = data.agentConfig ?? existing.agentConfig
      const schedule = data.schedule ?? existing.schedule
      const enabled = data.enabled ?? (data.schedule ? true : existing.enabled)
      const nextRunAt = data.schedule ? computeNextRunAt(schedule) : existing.nextRunAt

      db.prepare(
        `UPDATE automations SET
          name = ?, prompt = ?, agent_config_json = ?, schedule_json = ?,
          enabled = ?, next_run_at = ?, updated_at = ?
         WHERE id = ?`,
      ).run(
        name,
        prompt,
        JSON.stringify(agentConfig),
        JSON.stringify(schedule),
        enabled ? 1 : 0,
        nextRunAt ?? null,
        now,
        id,
      )
      return this.get(id)
    },

    delete(id) {
      return db.prepare('DELETE FROM automations WHERE id = ?').run(id).changes > 0
    },

    listDue(nowIso) {
      // Treat long-running as reclaimable: if last_run_at (or updated_at when
      // status flipped to running without last_run_at) is older than the
      // reclaim window, allow re-schedule after a process crash.
      const reclaimBefore = new Date(Date.parse(nowIso) - 30 * 60 * 1000).toISOString()
      const rows = db
        .prepare(
          `SELECT * FROM automations
           WHERE enabled = 1
             AND next_run_at IS NOT NULL
             AND next_run_at <= ?
             AND (
               last_run_status IS NULL
               OR last_run_status != 'running'
               OR COALESCE(last_run_at, updated_at) < ?
             )`,
        )
        .all(nowIso, reclaimBefore) as DbAutomationRow[]
      return rows.map((r) => {
        const path = resolveProjectPath(r.project_id) ?? ''
        return toRecord(r, path)
      })
    },

    updateRunStatus(id, status, sessionId, nextRunAt) {
      const now = new Date().toISOString()
      if (status === 'running') {
        db.prepare('UPDATE automations SET last_run_status = ?, updated_at = ? WHERE id = ?').run(
          status,
          now,
          id,
        )
      } else {
        db.prepare(
          `UPDATE automations SET
            last_run_at = ?, last_run_status = ?, last_run_session_id = ?,
            next_run_at = ?, updated_at = ?
           WHERE id = ?`,
        ).run(now, status, sessionId ?? null, nextRunAt ?? null, now, id)
      }
    },

    refreshAllNextRunAt() {
      const rows = db
        .prepare('SELECT id, schedule_json FROM automations WHERE enabled = 1')
        .all() as Array<{ id: string; schedule_json: string }>
      const stmt = db.prepare('UPDATE automations SET next_run_at = ? WHERE id = ?')
      for (const row of rows) {
        const schedule = JSON.parse(row.schedule_json) as AutomationSchedule
        const nextRunAt = computeNextRunAt(schedule)
        stmt.run(nextRunAt ?? null, row.id)
      }
    },
  }
}
