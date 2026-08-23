import { basename } from 'path'
import { randomUUID } from 'crypto'
import { getDb } from './database'
import { dropMiniAppOrderBucket } from './app-settings-service'
import type { RecentFolder } from '@superone/shared/agent-types'
import { PATH_EXISTS_LIST_TIMEOUT_MS, pathExistsBounded } from './path-exists-bounded'
import { parseProjectExtraDirs } from '@superone/shared/project-extra-dirs'
import { normalizeProjectExtraDirs } from '@superone/shared/project-extra-dirs-node'

export function getRecentFolders(): RecentFolder[] {
  const db = getDb()
  const rows = db.prepare(`
    SELECT p.id, p.path, p.name, p.added_at, p.extra_dirs_json,
           COALESCE(MAX(COALESCE(s.last_user_message_at, s.created_at)), p.added_at) AS last_active
    FROM projects p
    LEFT JOIN sessions s ON s.project_id = p.id
    GROUP BY p.id, p.path, p.name, p.added_at, p.extra_dirs_json
    ORDER BY last_active DESC
  `).all() as Array<{ id: string; path: string; name: string; added_at: string; extra_dirs_json: string | null; last_active: string }>

  return rows.map((r) => ({
    id: r.id,
    path: r.path,
    name: r.name,
    addedAt: r.added_at,
    lastOpened: r.last_active,
    extraDirs: parseProjectExtraDirs(r.extra_dirs_json),
  }))
}

/** IPC-facing list: mark missing without a sync existsSync on every path. */
export async function getRecentFoldersWithPresence(
  timeoutMs: number = PATH_EXISTS_LIST_TIMEOUT_MS,
): Promise<RecentFolder[]> {
  const folders = getRecentFolders()
  return Promise.all(
    folders.map(async (folder) => {
      const exists = await pathExistsBounded(folder.path, timeoutMs)
      return exists ? folder : { ...folder, missing: true }
    }),
  )
}

/**
 * Register a folder, or bump an already-registered one.
 *
 * The conflict clause refreshes `name` from the folder's basename ONLY while
 * the user has not renamed the project. Without that guard this runs on every
 * `openFolder` and silently reverts any custom name, which is what made
 * renaming a project impossible before Edit Project existed.
 */
export function addRecentFolder(folderPath: string): void {
  const db = getDb()
  const now = new Date().toISOString()
  const name = basename(folderPath)

  db.prepare(`
    INSERT INTO projects (id, path, name, added_at)
    VALUES (?, ?, ?, ?)
    ON CONFLICT(path) DO UPDATE SET
      name = CASE WHEN projects.is_user_renamed = 1 THEN projects.name ELSE excluded.name END
  `).run(randomUUID(), folderPath, name, now)
}


export function removeRecentFolder(folderPath: string): void {
  const db = getDb()
  const projectId = getProjectId(folderPath)
  db.prepare('DELETE FROM projects WHERE path = ?').run(folderPath)
  if (projectId) dropMiniAppOrderBucket(projectId)
}

export interface UpdateProjectInput {
  projectId?: string
  path?: string
  /** Omit to leave unchanged. Setting it pins the name against basename refreshes. */
  name?: string
  /** Omit to leave unchanged. */
  extraDirs?: string[]
}

/**
 * Apply an Edit Project submission.
 *
 * Both fields are optional and independent so the dialog can send one PATCH for
 * whatever the user actually touched, rather than one write per folder added —
 * every write can cost a running Claude session a process rebuild.
 */
export function updateProject(input: UpdateProjectInput): RecentFolder {
  const db = getDb()
  const row = (input.projectId
    ? db.prepare('SELECT id, path FROM projects WHERE id = ?').get(input.projectId)
    : input.path
      ? db.prepare('SELECT id, path FROM projects WHERE path = ?').get(input.path)
      : undefined) as { id: string; path: string } | undefined

  if (!row) {
    throw Object.assign(new Error('project not found'), { code: 'not_found' })
  }

  let nextName: string | null = null
  if (input.name !== undefined) {
    const trimmed = input.name.trim()
    if (!trimmed) {
      throw Object.assign(new Error('project name cannot be empty'), { code: 'invalid_argument' })
    }
    nextName = trimmed.slice(0, 200)
  }

  const nextExtraDirs = input.extraDirs === undefined
    ? null
    : JSON.stringify(normalizeProjectExtraDirs(input.extraDirs, row.path))

  // Pin the name only when it actually diverges from the folder. The dialog
  // submits `name` on every save, so keying off "was a name supplied" would
  // stop a folder-only edit from ever tracking a disk rename again. Renaming
  // back to the basename unpins it.
  const renamedFlag = nextName === null ? null : nextName === basename(row.path) ? 0 : 1

  db.prepare(`
    UPDATE projects
    SET name = COALESCE(?, name),
        is_user_renamed = COALESCE(?, is_user_renamed),
        extra_dirs_json = COALESCE(?, extra_dirs_json)
    WHERE id = ?
  `).run(nextName, renamedFlag, nextExtraDirs, row.id)

  const updated = getRecentFolders().find((f) => f.id === row.id)
  if (!updated) {
    throw Object.assign(new Error('project not found after update'), { code: 'not_found' })
  }
  return updated
}

/**
 * Workspace folders for one project.
 *
 * Separate from `getRecentFolders()` because the path-security allowlists need
 * this for a single project on a hot path and must not pay for the sessions
 * LEFT JOIN that the sidebar list requires.
 */
export function getProjectExtraDirs(folderPath: string): string[] {
  const db = getDb()
  const row = db
    .prepare('SELECT extra_dirs_json FROM projects WHERE path = ?')
    .get(folderPath) as { extra_dirs_json: string | null } | undefined
  return parseProjectExtraDirs(row?.extra_dirs_json)
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
