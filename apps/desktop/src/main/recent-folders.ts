import { basename } from 'path'
import { randomUUID } from 'crypto'
import { getDb } from './database'
import { dropMiniAppOrderBucket } from './app-settings-service'
import type { RecentFolder } from '@superone/shared/agent-types'
import type { StorageArchivedProject } from '@superone/shared/desktop-storage'
import { PATH_EXISTS_LIST_TIMEOUT_MS, pathExistsBounded } from './path-exists-bounded'
import { parseProjectExtraDirs, resolveProjectExtraDirs, type ProjectExtraDirsPatch } from '@superone/shared/project-extra-dirs'
import { normalizeProjectExtraDirs } from '@superone/shared/project-extra-dirs-node'
import { notifyProjectList } from './session-list-watch'

const removingProjectIds = new Set<string>()
const removingPaths = new Set<string>()
const pendingPurges = new Map<string, Promise<void>>()

const PURGE_MESSAGES_BATCH_SIZE = 500
const PURGE_SESSIONS_BATCH_SIZE = 50

function yieldEventLoop(): Promise<void> {
  return new Promise((resolve) => setImmediate(resolve))
}

export function waitForPendingProjectPurge(folderPath: string): Promise<void> {
  return pendingPurges.get(folderPath) ?? Promise.resolve()
}

async function purgeProjectAsync(projectId: string, folderPath: string): Promise<void> {
  try {
    const db = getDb()
    while (true) {
      const { changes } = db.prepare(`
        DELETE FROM chat_messages
        WHERE id IN (
          SELECT cm.id FROM chat_messages cm
          INNER JOIN sessions s ON s.id = cm.session_id
          WHERE s.project_id = ?
          LIMIT ?
        )
      `).run(projectId, PURGE_MESSAGES_BATCH_SIZE)
      if (changes < PURGE_MESSAGES_BATCH_SIZE) break
      await yieldEventLoop()
    }
    await yieldEventLoop()
    while (true) {
      const { changes } = db.prepare(`
        DELETE FROM sessions
        WHERE id IN (
          SELECT id FROM sessions
          WHERE project_id = ?
          LIMIT ?
        )
      `).run(projectId, PURGE_SESSIONS_BATCH_SIZE)
      if (changes < PURGE_SESSIONS_BATCH_SIZE) break
      await yieldEventLoop()
    }
    await yieldEventLoop()
    db.prepare('DELETE FROM projects WHERE id = ?').run(projectId)
    void import('./mcp-apps/resource-store').then(module => module.scheduleMcpAppResourceGc()).catch(() => {})
  } catch {
  } finally {
    removingProjectIds.delete(projectId)
    removingPaths.delete(folderPath)
    pendingPurges.delete(folderPath)
  }
}

export function getRecentFolders(): RecentFolder[] {
  const db = getDb()
  const rows = db.prepare(`
    SELECT p.id, p.path, p.name, p.added_at, p.extra_dirs_json,
           COALESCE(MAX(COALESCE(s.last_user_message_at, s.created_at)), p.added_at) AS last_active
    FROM projects p
    LEFT JOIN sessions s ON s.project_id = p.id
    WHERE p.hidden_at IS NULL
    GROUP BY p.id, p.path, p.name, p.added_at, p.extra_dirs_json
    ORDER BY last_active DESC
  `).all() as Array<{ id: string; path: string; name: string; added_at: string; extra_dirs_json: string | null; last_active: string }>

  return rows
    .filter((r) => !removingProjectIds.has(r.id) && !removingPaths.has(r.path))
    .map((r) => ({
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
  const existing = db.prepare('SELECT id, hidden_at FROM projects WHERE path = ?').get(folderPath) as
    | { id: string; hidden_at?: string | null }
    | undefined
  const isNew = !existing || existing.hidden_at != null

  db.prepare(`
    INSERT INTO projects (id, path, name, added_at)
    VALUES (?, ?, ?, ?)
    ON CONFLICT(path) DO UPDATE SET
      name = CASE WHEN projects.is_user_renamed = 1 THEN projects.name ELSE excluded.name END,
      hidden_at = NULL
  `).run(randomUUID(), folderPath, name, now)
  if (isNew) notifyProjectList()
}


export function removeRecentFolder(folderPath: string, options?: { deleteData?: boolean }): void {
  const projectId = getProjectId(folderPath)
  if (!projectId) return
  if (removingProjectIds.has(projectId)) return
  if (options?.deleteData) {
    removingProjectIds.add(projectId)
    removingPaths.add(folderPath)
    dropMiniAppOrderBucket(projectId)
    notifyProjectList()
    const purge = yieldEventLoop().then(() => purgeProjectAsync(projectId, folderPath))
    pendingPurges.set(folderPath, purge)
    return
  }
  const db = getDb()
  db.prepare('UPDATE projects SET hidden_at = ? WHERE id = ?').run(new Date().toISOString(), projectId)
  dropMiniAppOrderBucket(projectId)
  notifyProjectList()
}

export function listHiddenProjects(): StorageArchivedProject[] {
  const db = getDb()
  const rows = db.prepare(`
    SELECT p.id, p.name, p.path, p.hidden_at,
           COUNT(DISTINCT s.id) AS session_count,
           COUNT(cm.id) AS message_count
    FROM projects p
    LEFT JOIN sessions s ON s.project_id = p.id
    LEFT JOIN chat_messages cm ON cm.session_id = s.id
    WHERE p.hidden_at IS NOT NULL
    GROUP BY p.id, p.name, p.path, p.hidden_at
    ORDER BY p.hidden_at DESC
  `).all() as Array<{
    id: string
    name: string
    path: string
    hidden_at: string
    session_count: number
    message_count: number
  }>
  return rows
    .filter((r) => !removingProjectIds.has(r.id) && !removingPaths.has(r.path))
    .map((r) => ({
      id: r.id,
      name: r.name,
      path: r.path,
      hiddenAt: r.hidden_at,
      sessionCount: Number(r.session_count ?? 0),
      messageCount: Number(r.message_count ?? 0),
    }))
}

export function purgeHiddenProjects(projectIds?: string[]): number {
  const hidden = listHiddenProjects()
  const targetSet = projectIds && projectIds.length > 0 ? new Set(projectIds) : null
  const targets = targetSet ? hidden.filter((p) => targetSet.has(p.id)) : hidden
  for (const project of targets) {
    if (removingProjectIds.has(project.id)) continue
    removingProjectIds.add(project.id)
    removingPaths.add(project.path)
    const purge = yieldEventLoop().then(() => purgeProjectAsync(project.id, project.path))
    pendingPurges.set(project.path, purge)
  }
  return targets.length
}

export interface UpdateProjectInput extends ProjectExtraDirsPatch {
  projectId?: string
  path?: string
  /** Omit to leave unchanged. Setting it pins the name against basename refreshes. */
  name?: string
}

/**
 * Apply an Edit Project submission or an `/add-dir` delta.
 *
 * Every field is optional and independent so the dialog can send one PATCH for
 * whatever the user actually touched, rather than one write per folder added —
 * every write can cost a running Claude session a process rebuild.
 */
export function updateProject(input: UpdateProjectInput): RecentFolder {
  const db = getDb()
  const row = (input.projectId
    ? db.prepare('SELECT id, path, extra_dirs_json FROM projects WHERE id = ?').get(input.projectId)
    : input.path
      ? db.prepare('SELECT id, path, extra_dirs_json FROM projects WHERE path = ?').get(input.path)
      : undefined) as { id: string; path: string; extra_dirs_json: string | null } | undefined

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

  // Read-modify-write for the delta form happens here, not in the renderer:
  // this runs inside the single main process, so two windows adding a folder
  // at the same time compose instead of replacing each other's list.
  const resolved = resolveProjectExtraDirs(parseProjectExtraDirs(row.extra_dirs_json), input)
  const nextExtraDirs = resolved === null
    ? null
    : JSON.stringify(normalizeProjectExtraDirs(resolved, row.path))

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
  if (nextName !== null) notifyProjectList()

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
  if (removingPaths.has(folderPath)) return null
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
