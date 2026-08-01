import {
  closeSync,
  existsSync,
  fstatSync,
  mkdirSync,
  openSync,
  readSync,
  readdirSync,
  readFileSync,
  renameSync,
  rmSync,
  statSync,
  unlinkSync,
  writeFileSync,
  type Dirent,
} from 'node:fs'
import { dirname, join, relative } from 'node:path'
import { createHash } from 'node:crypto'
import type { WorkspaceEntry } from '@superone/shared/environment'
import {
  discoverClaudeSkillsAndCommands,
  listFilesUnderRoot,
  pathKind,
  resolveProjectPath,
  type WorkspaceFileEntry,
} from '@superone/runtime/fs'
import type { ProjectRegistry } from './project-registry'

export type { WorkspaceFileEntry }

function normalizeRel(path: string): string {
  return path.replace(/\\/g, '/').replace(/\/+$/, '') || '.'
}

function parentRel(rel: string): string {
  const n = normalizeRel(rel)
  if (n === '.' || n === '') return '.'
  const i = n.lastIndexOf('/')
  return i <= 0 ? '.' : n.slice(0, i)
}

function baseNameRel(rel: string): string {
  const n = normalizeRel(rel)
  if (n === '.' || n === '') return ''
  const i = n.lastIndexOf('/')
  return i < 0 ? n : n.slice(i + 1)
}

function joinRel(parent: string, name: string): string {
  const p = normalizeRel(parent)
  if (!p || p === '.') return name
  return `${p}/${name}`
}

function isStrictPrefix(parent: string, child: string): boolean {
  const p = normalizeRel(parent)
  const c = normalizeRel(child)
  if (p === '.' || p === '') return false
  return c === p || c.startsWith(`${p}/`)
}

const MAX_READ_BYTES = 10 * 1024 * 1024
const MAX_SEARCH_HITS = 100
const MAX_SEARCH_FILE_BYTES = 256 * 1024

export interface WorkspaceSkillInfo {
  name: string
  description: string
  argumentHint: string
  isSkill: boolean
  scope: 'user' | 'project'
}

export class WorkspaceFsService {
  constructor(private readonly projects: ProjectRegistry) {}

  private projectRoot(projectId: string): string {
    const p = this.projects.get(projectId)
    if (!p) throw Object.assign(new Error('project not found'), { code: 'not_found' })
    return p.path
  }

  listDir(projectId: string, relativePath: string): WorkspaceEntry[] {
    const root = this.projectRoot(projectId)
    const resolved = resolveProjectPath(root, relativePath || '.')
    if (!resolved.ok) {
      throw Object.assign(new Error(resolved.reason), { code: 'invalid_argument' })
    }
    if (!existsSync(resolved.absolutePath)) {
      throw Object.assign(new Error('path not found'), { code: 'not_found' })
    }
    const st = statSync(resolved.absolutePath)
    if (!st.isDirectory()) {
      throw Object.assign(new Error('not a directory'), { code: 'invalid_argument' })
    }
    this.projects.touch(projectId)
    const ents = readdirSync(resolved.absolutePath, { withFileTypes: true })
    return ents.map((ent: Dirent) => {
      const abs = join(resolved.absolutePath, ent.name)
      let size: number | undefined
      let mtimeMs: number | undefined
      try {
        const s = statSync(abs)
        size = s.size
        mtimeMs = s.mtimeMs
      } catch {
        /* ignore */
      }
      const kind = pathKind(abs)
      return {
        name: ent.name,
        path: relative(root, abs).split('\\').join('/') || '.',
        type: kind === 'symlink' ? 'symlink' : kind === 'directory' ? 'directory' : kind === 'file' ? 'file' : 'other',
        size,
        mtimeMs,
      } satisfies WorkspaceEntry
    })
  }

  readFile(
    projectId: string,
    relativePath: string,
    opts?: { offset?: number; limit?: number },
  ): { content: string; hash: string; encoding: 'base64' } {
    const root = this.projectRoot(projectId)
    const resolved = resolveProjectPath(root, relativePath)
    if (!resolved.ok) {
      throw Object.assign(new Error(resolved.reason), { code: 'invalid_argument' })
    }
    if (!existsSync(resolved.absolutePath)) {
      throw Object.assign(new Error('file not found'), { code: 'not_found' })
    }
    const st = statSync(resolved.absolutePath)
    if (!st.isFile()) {
      throw Object.assign(new Error('not a file'), { code: 'invalid_argument' })
    }
    if (st.size > MAX_READ_BYTES && opts?.limit === undefined) {
      throw Object.assign(new Error(`file too large (${st.size} bytes)`), { code: 'invalid_argument' })
    }
    const offset = opts?.offset ?? 0
    const limit = opts?.limit ?? MAX_READ_BYTES
    if (!Number.isSafeInteger(offset) || offset < 0) {
      throw Object.assign(new Error('offset must be a non-negative integer'), { code: 'invalid_argument' })
    }
    if (!Number.isSafeInteger(limit) || limit < 0) {
      throw Object.assign(new Error('limit must be a non-negative integer'), { code: 'invalid_argument' })
    }
    const cappedLimit = Math.min(limit, MAX_READ_BYTES)
    // Bounded read: only load the requested window (hash of that window).
    const fd = openSync(resolved.absolutePath, 'r')
    try {
      const size = fstatSync(fd).size
      const toRead = Math.min(cappedLimit, Math.max(0, size - offset))
      const slice = Buffer.alloc(toRead)
      if (toRead > 0) readSync(fd, slice, 0, toRead, offset)
      // Always return base64 so binary is not corrupted; clients may decode.
      const content = slice.toString('base64')
      const hash = createHash('sha256').update(slice).digest('hex')
      this.projects.touch(projectId)
      return { content, hash, encoding: 'base64' as const }
    } finally {
      closeSync(fd)
    }
  }

  writeFile(
    projectId: string,
    relativePath: string,
    content: string | Uint8Array,
    expectedHash?: string,
  ): { hash: string } {
    const root = this.projectRoot(projectId)
    const resolved = resolveProjectPath(root, relativePath)
    if (!resolved.ok) {
      throw Object.assign(new Error(resolved.reason), { code: 'invalid_argument' })
    }
    if (existsSync(resolved.absolutePath) && expectedHash) {
      const st = statSync(resolved.absolutePath)
      if (st.size > MAX_READ_BYTES) {
        throw Object.assign(
          new Error(`optimistic-write target too large (${st.size} bytes; max ${MAX_READ_BYTES})`),
          { code: 'invalid_argument' },
        )
      }
      const current = hashFileBounded(resolved.absolutePath, st.size)
      if (current !== expectedHash) {
        throw Object.assign(new Error('content hash mismatch'), { code: 'conflict' })
      }
    }
    mkdirSync(dirname(resolved.absolutePath), { recursive: true })
    const data = typeof content === 'string' ? Buffer.from(content, 'utf8') : Buffer.from(content)
    if (data.length > MAX_READ_BYTES) {
      throw Object.assign(new Error('write payload too large'), { code: 'invalid_argument' })
    }
    let mode = 0o600
    if (existsSync(resolved.absolutePath)) {
      try {
        mode = statSync(resolved.absolutePath).mode & 0o777
      } catch {
        /* keep secure default */
      }
    }
    // Atomic write: temp in same dir then rename; always clean temp on failure.
    const tmp = `${resolved.absolutePath}.tmp-${crypto.randomUUID()}`
    let renamed = false
    try {
      writeFileSync(tmp, data, { mode })
      const again = resolveProjectPath(root, relativePath)
      if (!again.ok || again.absolutePath !== resolved.absolutePath) {
        throw Object.assign(new Error('path changed during write'), { code: 'failed_precondition' })
      }
      renameSync(tmp, resolved.absolutePath)
      renamed = true
    } finally {
      if (!renamed) {
        try {
          unlinkSync(tmp)
        } catch {
          /* ignore */
        }
      }
    }
    const hash = createHash('sha256').update(data).digest('hex')
    this.projects.touch(projectId)
    return { hash }
  }

  /**
   * Inventory relative paths for @-mention / file search (not content grep).
   * Delegates pure walk to @superone/runtime/fs.
   */
  listFiles(
    projectId: string,
    opts?: { relativePath?: string; maxDepth?: number; maxFiles?: number },
  ): WorkspaceFileEntry[] {
    const root = this.projectRoot(projectId)
    const files = listFilesUnderRoot(root, opts)
    this.projects.touch(projectId)
    return files
  }

  /**
   * Discover Claude skills + slash commands on the node (user + project roots).
   * Used by desktop remote slash popup; agent still loads skills via SDK settingSources.
   */
  listSkillsAndCommands(projectId: string): {
    skills: WorkspaceSkillInfo[]
    commands: WorkspaceSkillInfo[]
  } {
    const root = this.projectRoot(projectId)
    const listed = discoverClaudeSkillsAndCommands(root)
    this.projects.touch(projectId)
    return listed
  }

  search(
    projectId: string,
    query: string,
    relativePath?: string,
  ): Array<{ path: string; line?: number; preview?: string }> {
    if (!query || query.length > 200) {
      throw Object.assign(new Error('invalid query'), { code: 'invalid_argument' })
    }
    const root = this.projectRoot(projectId)
    const startRel = relativePath || '.'
    const resolved = resolveProjectPath(root, startRel)
    if (!resolved.ok) {
      throw Object.assign(new Error(resolved.reason), { code: 'invalid_argument' })
    }
    const hits: Array<{ path: string; line?: number; preview?: string }> = []
    const walk = (dir: string) => {
      if (hits.length >= MAX_SEARCH_HITS) return
      let ents: Dirent[]
      try {
        ents = readdirSync(dir, { withFileTypes: true })
      } catch {
        return
      }
      for (const ent of ents) {
        if (hits.length >= MAX_SEARCH_HITS) return
        if (ent.name === '.git' || ent.name === 'node_modules') continue
        const abs = join(dir, ent.name)
        // Re-validate each path stays inside root (symlink defense).
        const rel = relative(root, abs).split('\\').join('/')
        const check = resolveProjectPath(root, rel)
        if (!check.ok) continue
        if (ent.isDirectory()) {
          walk(abs)
          continue
        }
        if (!ent.isFile()) continue
        try {
          const st = statSync(abs)
          if (st.size > MAX_SEARCH_FILE_BYTES) continue
          const text = readFileSync(abs, 'utf8')
          const lines = text.split(/\r?\n/)
          for (let i = 0; i < lines.length; i++) {
            if (lines[i]!.includes(query)) {
              hits.push({
                path: rel,
                line: i + 1,
                preview: lines[i]!.slice(0, 200),
              })
              if (hits.length >= MAX_SEARCH_HITS) return
            }
          }
        } catch {
          /* skip unreadable */
        }
      }
    }
    walk(resolved.absolutePath)
    this.projects.touch(projectId)
    return hits
  }

  /**
   * Rename within the same directory (newName must be a single path segment).
   */
  rename(
    projectId: string,
    relativePath: string,
    newName: string,
  ): { from: string; to: string } {
    const name = newName.trim()
    if (!name || name === '.' || name === '..' || name.includes('/') || name.includes('\\') || name.includes('\0')) {
      throw Object.assign(new Error('invalid new name'), { code: 'invalid_argument' })
    }
    const fromRel = normalizeRel(relativePath)
    if (!fromRel || fromRel === '.') {
      throw Object.assign(new Error('cannot rename project root'), { code: 'invalid_argument' })
    }
    const toRel = joinRel(parentRel(fromRel), name)
    return this.movePath(projectId, fromRel, toRel)
  }

  /**
   * Move a file/directory into destDir (keeps basename). destDir is project-relative.
   */
  move(
    projectId: string,
    srcRelativePath: string,
    destDirRelativePath: string,
  ): { from: string; to: string } {
    const fromRel = normalizeRel(srcRelativePath)
    if (!fromRel || fromRel === '.') {
      throw Object.assign(new Error('cannot move project root'), { code: 'invalid_argument' })
    }
    const name = baseNameRel(fromRel)
    if (!name) {
      throw Object.assign(new Error('invalid source path'), { code: 'invalid_argument' })
    }
    const destDir = normalizeRel(destDirRelativePath || '.')
    const toRel = joinRel(destDir, name)
    return this.movePath(projectId, fromRel, toRel)
  }

  /** Create a directory (and parents) inside the project. */
  mkdir(projectId: string, relativePath: string): { path: string } {
    const rel = normalizeRel(relativePath)
    if (!rel || rel === '.') {
      throw Object.assign(new Error('invalid directory path'), { code: 'invalid_argument' })
    }
    const root = this.projectRoot(projectId)
    const resolved = resolveProjectPath(root, rel)
    if (!resolved.ok) {
      throw Object.assign(new Error(resolved.reason), { code: 'invalid_argument' })
    }
    if (existsSync(resolved.absolutePath)) {
      const st = statSync(resolved.absolutePath)
      if (!st.isDirectory()) {
        throw Object.assign(new Error('path exists and is not a directory'), { code: 'conflict' })
      }
      this.projects.touch(projectId)
      return { path: rel }
    }
    mkdirSync(resolved.absolutePath, { recursive: true })
    this.projects.touch(projectId)
    return { path: rel }
  }

  /** Delete a file or directory tree (hard delete; no trash on headless node). */
  delete(projectId: string, relativePath: string): { path: string } {
    const rel = normalizeRel(relativePath)
    if (!rel || rel === '.') {
      throw Object.assign(new Error('cannot delete project root'), { code: 'invalid_argument' })
    }
    const root = this.projectRoot(projectId)
    const resolved = resolveProjectPath(root, rel)
    if (!resolved.ok) {
      throw Object.assign(new Error(resolved.reason), { code: 'invalid_argument' })
    }
    if (!existsSync(resolved.absolutePath)) {
      throw Object.assign(new Error('path not found'), { code: 'not_found' })
    }
    // Refuse to delete outside root even if resolution was loose.
    if (resolved.absolutePath === root) {
      throw Object.assign(new Error('cannot delete project root'), { code: 'invalid_argument' })
    }
    rmSync(resolved.absolutePath, { recursive: true, force: false })
    this.projects.touch(projectId)
    return { path: rel }
  }

  private movePath(
    projectId: string,
    fromRel: string,
    toRel: string,
  ): { from: string; to: string } {
    const fromN = normalizeRel(fromRel)
    const toN = normalizeRel(toRel)
    if (fromN === toN) {
      return { from: fromN, to: toN }
    }
    // Moving a directory into itself / a descendant is undefined on most FS.
    if (isStrictPrefix(fromN, toN)) {
      throw Object.assign(new Error('cannot move a path into itself'), { code: 'invalid_argument' })
    }
    const root = this.projectRoot(projectId)
    const from = resolveProjectPath(root, fromN)
    if (!from.ok) {
      throw Object.assign(new Error(from.reason), { code: 'invalid_argument' })
    }
    if (!existsSync(from.absolutePath)) {
      throw Object.assign(new Error('source not found'), { code: 'not_found' })
    }
    const to = resolveProjectPath(root, toN)
    if (!to.ok) {
      throw Object.assign(new Error(to.reason), { code: 'invalid_argument' })
    }
    if (existsSync(to.absolutePath)) {
      throw Object.assign(new Error(`target already exists: ${baseNameRel(toN)}`), {
        code: 'conflict',
      })
    }
    mkdirSync(dirname(to.absolutePath), { recursive: true })
    renameSync(from.absolutePath, to.absolutePath)
    this.projects.touch(projectId)
    return { from: fromN, to: toN }
  }
}

/** Incremental SHA-256 with a fixed buffer — never loads the whole file. */
function hashFileBounded(absolutePath: string, size: number): string {
  const fd = openSync(absolutePath, 'r')
  try {
    const hash = createHash('sha256')
    const buf = Buffer.alloc(Math.min(64 * 1024, Math.max(1, size)))
    let offset = 0
    while (offset < size) {
      const n = readSync(fd, buf, 0, buf.length, offset)
      if (n <= 0) break
      hash.update(buf.subarray(0, n))
      offset += n
    }
    return hash.digest('hex')
  } finally {
    closeSync(fd)
  }
}
