import { basename, resolve } from 'node:path'
import { existsSync, realpathSync, statSync } from 'node:fs'
import type { ProjectSnapshot } from '@superone/shared/environment'
import type { SqliteDatabase } from '../sqlite'
import { createHash } from 'node:crypto'
import { execFileSync } from 'node:child_process'

export class ProjectRegistry {
  constructor(private readonly db: SqliteDatabase) {}

  list(): ProjectSnapshot[] {
    const rows = this.db
      .prepare(
        `SELECT project_id, path, name, repo_identity, opened_at, last_active_at FROM projects ORDER BY last_active_at DESC`,
      )
      .all() as Array<{
      project_id: string
      path: string
      name: string
      repo_identity: string | null
      opened_at: number | null
      last_active_at: number | null
    }>
    return rows.map((r) => this.toSnapshot(r))
  }

  get(projectId: string): ProjectSnapshot | null {
    const r = this.db
      .prepare(
        `SELECT project_id, path, name, repo_identity, opened_at, last_active_at FROM projects WHERE project_id = ?`,
      )
      .get(projectId) as
      | {
          project_id: string
          path: string
          name: string
          repo_identity: string | null
          opened_at: number | null
          last_active_at: number | null
        }
      | undefined
    if (!r) return null
    return this.toSnapshot(r)
  }

  getByPath(path: string): ProjectSnapshot | null {
    const abs = resolve(path)
    const r = this.db
      .prepare(
        `SELECT project_id, path, name, repo_identity, opened_at, last_active_at FROM projects WHERE path = ?`,
      )
      .get(abs) as
      | {
          project_id: string
          path: string
          name: string
          repo_identity: string | null
          opened_at: number | null
          last_active_at: number | null
        }
      | undefined
    if (!r) return null
    return this.toSnapshot(r)
  }

  open(path: string, name?: string): ProjectSnapshot {
    let abs = resolve(path)
    if (!existsSync(abs) || !statSync(abs).isDirectory()) {
      throw Object.assign(new Error(`project path is not a directory: ${abs}`), {
        code: 'invalid_argument',
      })
    }
    try {
      abs = realpathSync(abs)
    } catch {
      /* keep resolved */
    }
    const existing = this.getByPath(abs)
    const now = Date.now()
    if (existing) {
      this.db
        .prepare(`UPDATE projects SET last_active_at = ?, name = COALESCE(?, name) WHERE project_id = ?`)
        .run(now, name ?? null, existing.projectId)
      return this.get(existing.projectId)!
    }
    const projectId = createHash('sha256').update(abs).digest('hex').slice(0, 32)
    const repoIdentity = detectRepoIdentity(abs)
    this.db
      .prepare(
        `INSERT INTO projects (project_id, path, name, repo_identity, opened_at, last_active_at)
         VALUES (?, ?, ?, ?, ?, ?)`,
      )
      .run(projectId, abs, name || basename(abs), repoIdentity, now, now)
    return this.get(projectId)!
  }

  touch(projectId: string): void {
    this.db.prepare(`UPDATE projects SET last_active_at = ? WHERE project_id = ?`).run(Date.now(), projectId)
  }

  /**
   * Unregister a project from this node's registry (does not delete disk files).
   * Accepts projectId and/or absolute path; prefers projectId when both are set.
   */
  remove(input: { projectId?: string; path?: string }): ProjectSnapshot | null {
    let snap: ProjectSnapshot | null = null
    if (input.projectId) {
      snap = this.get(input.projectId)
    } else if (input.path) {
      snap = this.getByPath(input.path)
    }
    if (!snap) return null
    this.db.prepare(`DELETE FROM projects WHERE project_id = ?`).run(snap.projectId)
    return snap
  }

  private toSnapshot(r: {
    project_id: string
    path: string
    name: string
    repo_identity: string | null
    opened_at: number | null
    last_active_at: number | null
  }): ProjectSnapshot {
    let missing = false
    try {
      missing = !statSync(r.path).isDirectory()
    } catch {
      missing = true
    }
    return {
      projectId: r.project_id,
      path: r.path,
      name: r.name,
      ...(missing ? { missing: true } : {}),
      repoIdentity: r.repo_identity,
      openedAt: r.opened_at ?? undefined,
      lastActiveAt: r.last_active_at ?? undefined,
    }
  }
}

function detectRepoIdentity(abs: string): string | null {
  try {
    const out = execFileSync('git', ['-C', abs, 'rev-parse', '--git-dir'], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim()
    if (!out) return null
    // Prefer remote origin URL when present; else use resolved git dir path.
    try {
      const remote = execFileSync('git', ['-C', abs, 'config', '--get', 'remote.origin.url'], {
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'ignore'],
      }).trim()
      if (remote) return `git:${remote}`
    } catch {
      /* no remote */
    }
    return `gitdir:${resolve(abs, out)}`
  } catch {
    return null
  }
}
