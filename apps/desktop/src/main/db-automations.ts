import { randomUUID } from 'crypto'
import { getDb } from './database'
import { getProjectId } from './recent-folders'
import { computeNextRunAt } from '@superone/runtime/automations'
import type {
  Automation,
  AutomationRunStatus,
  AutomationSchedule,
  AgentRunConfig,
  CreateAutomationRequest,
  UpdateAutomationRequest,
} from '@superone/shared/agent-types'

export { computeNextRunAt }

interface DbAutomation {
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

function toAutomation(row: DbAutomation, projectPath: string): Automation {
  return {
    id: row.id,
    name: row.name,
    prompt: row.prompt,
    agentConfig: JSON.parse(row.agent_config_json) as AgentRunConfig,
    schedule: JSON.parse(row.schedule_json) as AutomationSchedule,
    projectPath,
    enabled: row.enabled === 1,
    lastRunAt: row.last_run_at ?? undefined,
    lastRunStatus: (row.last_run_status as AutomationRunStatus) ?? undefined,
    lastRunSessionId: row.last_run_session_id ?? undefined,
    nextRunAt: row.next_run_at ?? undefined,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }
}

export function listAutomationsForProject(projectPath: string): Automation[] {
  const projectId = getProjectId(projectPath)
  if (!projectId) return []

  const db = getDb()
  const rows = db
    .prepare('SELECT * FROM automations WHERE project_id = ? ORDER BY created_at DESC')
    .all(projectId) as DbAutomation[]

  return rows.map((r) => toAutomation(r, projectPath))
}

export function getAutomation(id: string): (Automation & { projectId: string }) | undefined {
  const db = getDb()
  const row = db.prepare('SELECT a.*, p.path as project_path FROM automations a JOIN projects p ON a.project_id = p.id WHERE a.id = ?').get(id) as
    | (DbAutomation & { project_path: string })
    | undefined
  if (!row) return undefined
  return { ...toAutomation(row, row.project_path), projectId: row.project_id }
}

export function createAutomation(projectPath: string, data: CreateAutomationRequest): Automation {
  const projectId = getProjectId(projectPath)
  if (!projectId) throw new Error(`Project not found for path: ${projectPath}`)

  const db = getDb()
  const id = randomUUID()
  const now = new Date().toISOString()
  const nextRunAt = computeNextRunAt(data.schedule)

  db.prepare(`
    INSERT INTO automations (id, project_id, name, prompt, agent_config_json, schedule_json, enabled, next_run_at, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, 1, ?, ?, ?)
  `).run(
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

  return getAutomation(id)! as Automation
}

export function updateAutomation(id: string, data: UpdateAutomationRequest): Automation | undefined {
  const existing = getAutomation(id)
  if (!existing) return undefined

  const db = getDb()
  const now = new Date().toISOString()

  const name = data.name ?? existing.name
  const prompt = data.prompt ?? existing.prompt
  const agentConfig = data.agentConfig ?? existing.agentConfig
  const schedule = data.schedule ?? existing.schedule
  // Preserve enabled unless the caller sets it explicitly. Schedule edits must not
  // silently re-arm a paused automation (MCP toggle + UI both rely on that).
  const enabled = data.enabled ?? existing.enabled

  const nextRunAt = data.schedule ? computeNextRunAt(schedule) : existing.nextRunAt

  db.prepare(`
    UPDATE automations SET
      name = ?, prompt = ?, agent_config_json = ?, schedule_json = ?,
      enabled = ?, next_run_at = ?, updated_at = ?
    WHERE id = ?
  `).run(
    name,
    prompt,
    JSON.stringify(agentConfig),
    JSON.stringify(schedule),
    enabled ? 1 : 0,
    nextRunAt ?? null,
    now,
    id,
  )

  return getAutomation(id) as Automation
}

export function deleteAutomation(id: string): boolean {
  return getDb().prepare('DELETE FROM automations WHERE id = ?').run(id).changes > 0
}

export function listDueAutomations(now: string): Automation[] {
  const db = getDb()
  const rows = db
    .prepare(`
      SELECT a.*, p.path as project_path
      FROM automations a
      JOIN projects p ON a.project_id = p.id
      WHERE a.enabled = 1
        AND a.next_run_at IS NOT NULL
        AND a.next_run_at <= ?
        AND (a.last_run_status IS NULL OR a.last_run_status != 'running')
    `)
    .all(now) as (DbAutomation & { project_path: string })[]

  return rows.map((r) => toAutomation(r, r.project_path))
}

export function updateAutomationRunStatus(
  id: string,
  status: AutomationRunStatus,
  sessionId?: string,
  nextRunAt?: string | null,
): void {
  const db = getDb()
  const now = new Date().toISOString()

  if (status === 'running') {
    db.prepare('UPDATE automations SET last_run_status = ?, updated_at = ? WHERE id = ?').run(status, now, id)
  } else {
    db.prepare(`
      UPDATE automations SET
        last_run_at = ?, last_run_status = ?, last_run_session_id = ?,
        next_run_at = ?, updated_at = ?
      WHERE id = ?
    `).run(now, status, sessionId ?? null, nextRunAt ?? null, now, id)
  }
}

export function refreshAllNextRunAt(): void {
  const db = getDb()
  const rows = db
    .prepare('SELECT id, schedule_json FROM automations WHERE enabled = 1')
    .all() as Array<{ id: string; schedule_json: string }>

  const stmt = db.prepare('UPDATE automations SET next_run_at = ? WHERE id = ?')
  db.transaction(() => {
    for (const row of rows) {
      const schedule = JSON.parse(row.schedule_json) as AutomationSchedule
      const nextRunAt = computeNextRunAt(schedule)
      stmt.run(nextRunAt ?? null, row.id)
    }
  })()
}
