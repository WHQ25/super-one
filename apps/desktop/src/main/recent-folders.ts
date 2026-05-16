import { basename } from 'path'
import { randomUUID } from 'crypto'
import { existsSync } from 'fs'
import { getDb } from './database'
import { dropMiniAppOrderBucket } from './app-settings-service'
import type { RecentFolder } from '@superone/shared/agent-types'

export function getRecentFolders(): RecentFolder[] {
  const db = getDb()
  const rows = db.prepare(`
    SELECT p.id, p.path, p.name, p.added_at,
           COALESCE(MAX(COALESCE(s.last_user_message_at, s.created_at)), p.added_at) AS last_active
    FROM projects p
    LEFT JOIN sessions s ON s.project_id = p.id
    GROUP BY p.id, p.path, p.name, p.added_at
    ORDER BY last_active DESC
  `).all() as Array<{ id: string; path: string; name: string; added_at: string; last_active: string }>

  return rows.map((r) => ({
    id: r.id,
    path: r.path,
    name: r.name,
    addedAt: r.added_at,
    lastOpened: r.last_active,
    ...(!existsSync(r.path) && { missing: true }),
  }))
}

export function addRecentFolder(folderPath: string): void {
  const db = getDb()
  const now = new Date().toISOString()
  const name = basename(folderPath)

  db.prepare(`
    INSERT INTO projects (id, path, name, added_at)
    VALUES (?, ?, ?, ?)
    ON CONFLICT(path) DO UPDATE SET
      name = excluded.name
  `).run(randomUUID(), folderPath, name, now)
}


export function removeRecentFolder(folderPath: string): void {
  const db = getDb()
  const projectId = getProjectId(folderPath)
  db.prepare('DELETE FROM projects WHERE path = ?').run(folderPath)
  if (projectId) dropMiniAppOrderBucket(projectId)
}

/** Get project ID by path, or null if not found */
export function getProjectId(folderPath: string): string | null {
  const db = getDb()
  const row = db.prepare('SELECT id FROM projects WHERE path = ?').get(folderPath) as { id: string } | undefined
  return row?.id ?? null
}

/** Get project path by ID, or null if not found */
export function getProjectPathById(projectId: string): string | null {
  const db = getDb()
  const row = db.prepare('SELECT path FROM projects WHERE id = ?').get(projectId) as { path: string } | undefined
  return row?.path ?? null
}
