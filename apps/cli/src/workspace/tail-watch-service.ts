import { existsSync, fstatSync, openSync, closeSync, statSync } from 'node:fs'
import {
  isToolOutputRelativePath,
  normalizeProjectRelativePath,
  resolveProjectPath,
} from '@superone/runtime/fs'
import type { ProjectRegistry } from './project-registry'
import type { WorkspaceFsService } from './fs-service'

export type TailWatchPollResult = {
  content: string
  encoding: 'base64'
  /** Next byte offset for subsequent polls. */
  offset: number
  /** Current file size in bytes (0 if missing). */
  size: number
  /** True when the file is currently missing. */
  missing?: boolean
}

type TailWatchEntry = {
  projectId: string
  relativePath: string
  offset: number
  owner: string
}

const MAX_POLL_BYTES = 10 * 1024 * 1024

/**
 * Byte-offset tail watches for tool output files under project `temp/`.
 * Poll returns only the appended window (base64), reusing WorkspaceFsService.readFile offset.
 */
export class WorkspaceTailWatchService {
  private readonly entries = new Map<string, TailWatchEntry>()

  constructor(
    private readonly projects: ProjectRegistry,
    private readonly fs: WorkspaceFsService,
  ) {}

  start(
    projectId: string,
    relativePath: string,
    opts?: { offset?: number; ownerClientId?: string },
  ): { watchId: string; offset: number; relativePath: string } {
    const project = this.projects.get(projectId)
    if (!project) throw Object.assign(new Error('project not found'), { code: 'not_found' })

    const rel = normalizeProjectRelativePath(relativePath || '')
    if (!isToolOutputRelativePath(rel)) {
      throw Object.assign(
        new Error('tail watch is limited to project-relative paths under temp/'),
        { code: 'invalid_argument' },
      )
    }

    const resolved = resolveProjectPath(project.path, rel)
    if (!resolved.ok) {
      throw Object.assign(new Error(resolved.reason), { code: 'invalid_argument' })
    }

    let offset = opts?.offset ?? 0
    if (!Number.isSafeInteger(offset) || offset < 0) {
      throw Object.assign(new Error('offset must be a non-negative integer'), {
        code: 'invalid_argument',
      })
    }

    // Clamp start offset to current size when the file already exists.
    if (existsSync(resolved.absolutePath)) {
      try {
        const st = statSync(resolved.absolutePath)
        if (!st.isFile()) {
          throw Object.assign(new Error('not a file'), { code: 'invalid_argument' })
        }
        if (offset > st.size) offset = st.size
      } catch (err) {
        const e = err as { code?: string }
        if (e.code === 'invalid_argument') throw err
        /* race: treat as missing */
      }
    }

    const watchId = crypto.randomUUID()
    this.entries.set(watchId, {
      projectId,
      relativePath: rel,
      offset,
      owner: opts?.ownerClientId ?? '',
    })
    this.projects.touch(projectId)
    return { watchId, offset, relativePath: rel }
  }

  poll(watchId: string, ownerClientId?: string): TailWatchPollResult {
    const entry = this.entries.get(watchId)
    if (!entry || (entry.owner && ownerClientId && entry.owner !== ownerClientId)) {
      throw Object.assign(new Error('tail watch not found or not owned'), { code: 'not_found' })
    }

    const project = this.projects.get(entry.projectId)
    if (!project) {
      throw Object.assign(new Error('project not found'), { code: 'not_found' })
    }

    const resolved = resolveProjectPath(project.path, entry.relativePath)
    if (!resolved.ok) {
      throw Object.assign(new Error(resolved.reason), { code: 'invalid_argument' })
    }

    if (!existsSync(resolved.absolutePath)) {
      return {
        content: '',
        encoding: 'base64',
        offset: entry.offset,
        size: 0,
        missing: true,
      }
    }

    let size = 0
    try {
      const fd = openSync(resolved.absolutePath, 'r')
      try {
        size = fstatSync(fd).size
      } finally {
        closeSync(fd)
      }
    } catch {
      return {
        content: '',
        encoding: 'base64',
        offset: entry.offset,
        size: 0,
        missing: true,
      }
    }

    // Truncation / rewrite: restart from the beginning.
    if (size < entry.offset) {
      entry.offset = 0
    }

    if (size === entry.offset) {
      return { content: '', encoding: 'base64', offset: entry.offset, size }
    }

    const toRead = Math.min(MAX_POLL_BYTES, size - entry.offset)
    const slice = this.fs.readFile(entry.projectId, entry.relativePath, {
      offset: entry.offset,
      limit: toRead,
    })
    entry.offset = entry.offset + toRead
    this.projects.touch(entry.projectId)
    return {
      content: slice.content,
      encoding: 'base64',
      offset: entry.offset,
      size,
    }
  }

  stop(watchId: string, ownerClientId?: string): { ok: boolean } {
    const entry = this.entries.get(watchId)
    if (!entry) return { ok: true }
    if (entry.owner && ownerClientId && entry.owner !== ownerClientId) {
      throw Object.assign(new Error('tail watch not found or not owned'), { code: 'not_found' })
    }
    this.entries.delete(watchId)
    return { ok: true }
  }

  assertOwner(watchId: string, clientSessionId: string): void {
    const entry = this.entries.get(watchId)
    if (!entry || (entry.owner && entry.owner !== clientSessionId)) {
      throw Object.assign(new Error('tail watch not found or not owned'), { code: 'not_found' })
    }
  }

  isLive(watchId: string, ownerClientId?: string): boolean {
    const entry = this.entries.get(watchId)
    if (!entry) return false
    if (ownerClientId && entry.owner && entry.owner !== ownerClientId) return false
    return true
  }

  cancelForClient(clientSessionId: string): void {
    for (const [id, entry] of [...this.entries]) {
      if (entry.owner === clientSessionId) this.entries.delete(id)
    }
  }

  closeAll(): void {
    this.entries.clear()
  }
}
