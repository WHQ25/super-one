/**
 * File-tree listing + mutations for remote projects (`remote:<connectionId>:<hostPath>`).
 *
 * Sidebar Files uses `app.listDir` / move / rename / delete IPC. Local paths use
 * disk APIs; remote keys go through EnvironmentHost workspace + git RPC.
 *
 * Cross-host drag:
 * - local (or Finder) → remote: copy/move via workspace.writeFile/mkdir
 * - remote → local (or Finder): materialize to temp then Electron startDrag
 * - within remote tree: workspace.move (paths may be remote: keys from TreeRow)
 */

import { randomUUID } from 'node:crypto'
import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs'
import { basename, dirname, extname, join } from 'node:path'
import type {
  GitFileContent,
  GitFileDiff,
  GitInfo,
  WorktreeEntry,
  WorktreeInfo,
} from '@superone/shared/agent-types'
import { tmpdir } from 'node:os'
import type { FileOpResult, FileTreeEntry } from '@superone/shared/agent-types'
import type { WorkspaceEntry } from '@superone/shared/environment'
import { parseRemoteProjectKey } from '@superone/shared/remote-resource-key'
import {
  EMPTY_PAIR,
  parseGitStatusOutput,
  resolveEntryStatusPair,
  type ParsedGitStatus,
} from '../git-status-utils'
import { AsyncCoalescer } from '../async-cache'
import type { EnvironmentHost } from './environment-host'
import { RemoteEnvironmentGateway } from './remote-environment-gateway'

/** Coalesce status-bar + file-tree git.status RPCs (same as local 1.5s window). */
const REMOTE_GIT_STATUS_TTL_MS = 1_500
const remoteGitStatusCoalescer = new AsyncCoalescer<{
  isRepo?: boolean
  branch?: string | null
  dirty?: boolean
  porcelain?: string
  insertions?: number
  deletions?: number
}>(REMOTE_GIT_STATUS_TTL_MS)

/** Drop cached remote git.status (after checkout / worktree switch, or tests). */
export function invalidateRemoteGitStatusCache(key?: string): void {
  if (key) remoteGitStatusCoalescer.invalidate(key)
  else remoteGitStatusCoalescer.clear()
}

const SKIP_NAMES = new Set(['.git', '.DS_Store'])
/** Match node workspace.writeFile / readFile payload cap. */
const MAX_TRANSFER_BYTES = 10 * 1024 * 1024

const REMOTE_IMAGE_EXTS = new Set(['.png', '.jpg', '.jpeg', '.gif', '.webp', '.bmp', '.ico'])
const REMOTE_PDF_EXTS = new Set(['.pdf'])
const REMOTE_VIDEO_EXTS = new Set(['.mp4', '.webm', '.ogg', '.mov'])
const REMOTE_AUDIO_EXTS = new Set(['.mp3', '.wav', '.flac', '.aac', '.m4a', '.ogg'])
const REMOTE_MIME: Record<string, string> = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.bmp': 'image/bmp',
  '.ico': 'image/x-icon',
  '.pdf': 'application/pdf',
  '.mp4': 'video/mp4',
  '.webm': 'video/webm',
  '.ogg': 'video/ogg',
  '.mov': 'video/quicktime',
  '.mp3': 'audio/mpeg',
  '.wav': 'audio/wav',
  '.flac': 'audio/flac',
  '.aac': 'audio/aac',
  '.m4a': 'audio/mp4',
}
const REMOTE_EXT_LANG: Record<string, string> = {
  '.ts': 'typescript',
  '.tsx': 'tsx',
  '.js': 'javascript',
  '.jsx': 'jsx',
  '.py': 'python',
  '.rb': 'ruby',
  '.rs': 'rust',
  '.go': 'go',
  '.java': 'java',
  '.json': 'json',
  '.yaml': 'yaml',
  '.yml': 'yaml',
  '.toml': 'toml',
  '.html': 'html',
  '.css': 'css',
  '.scss': 'scss',
  '.md': 'markdown',
  '.sh': 'bash',
  '.sql': 'sql',
  '.swift': 'swift',
  '.kt': 'kotlin',
  '.c': 'c',
  '.cpp': 'cpp',
  '.cs': 'csharp',
  '.php': 'php',
}

function bufferFromWorkspaceContent(content: string | Uint8Array): Buffer {
  if (typeof content === 'string') return Buffer.from(content, 'utf8')
  return Buffer.from(content)
}

export function normalizeHostPath(path: string): string {
  return path.replace(/\\/g, '/').replace(/\/+$/, '') || '/'
}

export function hostPathsEqual(a: string, b: string): boolean {
  return normalizeHostPath(a) === normalizeHostPath(b)
}

export interface RemoteProjectContext {
  connectionId: string
  environmentId: string
  projectId: string
  hostPath: string
}

/** Map node workspace.listDir entries into the renderer FileTreeEntry shape. */
export function mapWorkspaceEntriesToFileTree(
  entries: WorkspaceEntry[],
  parsed?: ParsedGitStatus | null,
): FileTreeEntry[] {
  const mapped: FileTreeEntry[] = []
  for (const entry of entries) {
    if (SKIP_NAMES.has(entry.name)) continue
    // Workspace paths are project-root-relative; keep them as the tree keys.
    const path = entry.path === '.' ? entry.name : entry.path.replace(/\\/g, '/')
    const isDirectory = entry.type === 'directory'
    const pair = parsed ? resolveEntryStatusPair(path, isDirectory, parsed) : EMPTY_PAIR
    mapped.push({
      name: entry.name,
      path,
      isDirectory,
      children: undefined,
      gitIndex: pair.index,
      gitWorktree: pair.worktree,
    })
  }
  mapped.sort((a, b) => {
    if (a.isDirectory !== b.isDirectory) return a.isDirectory ? -1 : 1
    return a.name.localeCompare(b.name)
  })
  return mapped
}

export async function resolveRemoteProjectContext(
  host: EnvironmentHost,
  folderPath: string,
  opts?: {
    /**
     * When true (default for file-tree open), register the path on the node if
     * missing. Git status / worktree probes must pass false so worktree host
     * paths are not permanently added to project.list as ghost projects.
     */
    registerIfMissing?: boolean
  },
): Promise<RemoteProjectContext | null> {
  const remote = parseRemoteProjectKey(folderPath)
  if (!remote) return null

  const known = host.connections.listKnown().find((k) => k.connectionId === remote.connectionId)
  if (!known) {
    throw new Error(`unknown remote connection ${remote.connectionId}`)
  }

  const projects = await host.listProjects(remote.connectionId)
  let project = projects.find((p) => hostPathsEqual(p.path, remote.path))
  if (!project) {
    if (opts?.registerIfMissing === false) return null
    project = await host.openProject(remote.connectionId, remote.path)
  }

  return {
    connectionId: remote.connectionId,
    environmentId: known.environmentId,
    projectId: project.projectId,
    hostPath: remote.path,
  }
}

async function fetchRemoteGitStatusRaw(
  host: EnvironmentHost,
  ctx: RemoteProjectContext,
  statusCwd?: string,
): Promise<{
  isRepo?: boolean
  branch?: string | null
  dirty?: boolean
  porcelain?: string
  insertions?: number
  deletions?: number
} | null> {
  const gw = asRemoteGitGateway(host.getGateway(ctx.environmentId))
  if (!gw) return null
  const cacheKey = `${ctx.connectionId}:${ctx.projectId}:${statusCwd ?? ''}`
  return remoteGitStatusCoalescer.get(cacheKey, async () => {
    return (await gw.gitStatus(
      ctx.projectId,
      statusCwd ? { cwd: statusCwd } : undefined,
    )) as {
      isRepo?: boolean
      branch?: string | null
      dirty?: boolean
      porcelain?: string
      insertions?: number
      deletions?: number
    }
  })
}

async function fetchRemoteGitParsed(
  host: EnvironmentHost,
  ctx: RemoteProjectContext,
): Promise<ParsedGitStatus | null> {
  try {
    const status = await fetchRemoteGitStatusRaw(host, ctx)
    if (!status?.isRepo || typeof status.porcelain !== 'string') return null
    return parseGitStatusOutput(status.porcelain)
  } catch {
    return null
  }
}

/**
 * List one directory of a remote project for the file tree.
 * Returns `null` when `folderPath` is not a remote project key (caller uses local FS).
 */
export async function listRemoteFileTreeDir(
  host: EnvironmentHost,
  folderPath: string,
  dirRelPath: string,
): Promise<FileTreeEntry[] | null> {
  const ctx = await resolveRemoteProjectContext(host, folderPath)
  if (!ctx) return null

  const relativePath = dirRelPath.trim() === '' ? '.' : dirRelPath.replace(/\\/g, '/')
  const [entries, parsed] = await Promise.all([
    host.workspace().listDir({
      project: {
        environmentId: ctx.environmentId,
        projectId: ctx.projectId,
      },
      relativePath,
    }),
    fetchRemoteGitParsed(host, ctx),
  ])
  return mapWorkspaceEntriesToFileTree(entries, parsed)
}

function projectRef(ctx: RemoteProjectContext) {
  return { environmentId: ctx.environmentId, projectId: ctx.projectId }
}

export async function renameRemoteFile(
  host: EnvironmentHost,
  folderPath: string,
  relPath: string,
  newName: string,
): Promise<FileOpResult | null> {
  const ctx = await resolveRemoteProjectContext(host, folderPath)
  if (!ctx) return null
  try {
    if (newName.includes('/') || newName.includes('\\')) {
      return { ok: false, error: 'Name cannot contain path separators' }
    }
    await host.workspace().rename({
      project: projectRef(ctx),
      relativePath: relPath,
      newName,
    })
    return { ok: true }
  } catch (err) {
    return { ok: false, error: (err as Error).message }
  }
}

export async function moveRemoteFile(
  host: EnvironmentHost,
  folderPath: string,
  srcRelPath: string,
  destDirRelPath: string,
): Promise<FileOpResult | null> {
  const ctx = await resolveRemoteProjectContext(host, folderPath)
  if (!ctx) return null
  try {
    await host.workspace().move({
      project: projectRef(ctx),
      fromPath: srcRelPath,
      destDirPath: destDirRelPath.trim() === '' ? '.' : destDirRelPath,
    })
    return { ok: true }
  } catch (err) {
    return { ok: false, error: (err as Error).message }
  }
}

export async function deleteRemoteFile(
  host: EnvironmentHost,
  folderPath: string,
  relPath: string,
): Promise<FileOpResult | null> {
  const ctx = await resolveRemoteProjectContext(host, folderPath)
  if (!ctx) return null
  try {
    await host.workspace().delete({
      project: projectRef(ctx),
      relativePath: relPath,
    })
    return { ok: true }
  } catch (err) {
    return { ok: false, error: (err as Error).message }
  }
}

function joinProjectRel(destDir: string, name: string): string {
  const dir = destDir.replace(/\\/g, '/').replace(/^\/+|\/+$/g, '')
  if (!dir || dir === '.') return name
  return `${dir}/${name}`
}

/**
 * Convert a drag path into a project-relative path when it belongs to this remote
 * project. Accepts either `remote:<conn>:<hostAbs>` keys or `folderPath/rel` joins.
 */
export function relativePathUnderRemoteProject(
  folderPath: string,
  dragPath: string,
): string | null {
  const project = parseRemoteProjectKey(folderPath)
  if (!project) return null

  const asRemote = parseRemoteProjectKey(dragPath)
  if (asRemote) {
    if (asRemote.connectionId !== project.connectionId) return null
    const root = normalizeHostPath(project.path)
    const full = normalizeHostPath(asRemote.path)
    if (full === root) return null
    if (!full.startsWith(`${root}/`)) return null
    return full.slice(root.length + 1)
  }

  const prefix = folderPath.endsWith('/') ? folderPath : `${folderPath}/`
  if (dragPath.startsWith(prefix)) {
    const rel = dragPath.slice(prefix.length).replace(/\\/g, '/')
    return rel || null
  }
  return null
}

async function copyLocalPathIntoRemote(
  host: EnvironmentHost,
  ctx: RemoteProjectContext,
  localAbs: string,
  destRel: string,
): Promise<void> {
  const st = statSync(localAbs)
  const ref = projectRef(ctx)
  if (st.isDirectory()) {
    await host.workspace().mkdir({ project: ref, relativePath: destRel })
    const entries = readdirSync(localAbs, { withFileTypes: true })
    for (const ent of entries) {
      if (SKIP_NAMES.has(ent.name)) continue
      await copyLocalPathIntoRemote(
        host,
        ctx,
        join(localAbs, ent.name),
        joinProjectRel(destRel, ent.name),
      )
    }
    return
  }
  if (!st.isFile()) return
  if (st.size > MAX_TRANSFER_BYTES) {
    throw new Error(
      `file too large for remote transfer (${basename(localAbs)}, max ${MAX_TRANSFER_BYTES} bytes)`,
    )
  }
  const content = readFileSync(localAbs)
  await host.workspace().writeFile({
    project: ref,
    relativePath: destRel,
    content,
  })
}

/**
 * Copy local filesystem paths into a remote project (FILE_COPY_IN).
 * Returns null when folderPath is not remote.
 */
export async function copyLocalPathsIntoRemote(
  host: EnvironmentHost,
  folderPath: string,
  destDirRelPath: string,
  absolutePaths: string[],
): Promise<FileOpResult | null> {
  const ctx = await resolveRemoteProjectContext(host, folderPath)
  if (!ctx) return null
  try {
    const destDir = destDirRelPath.replace(/\\/g, '/').replace(/^\/+|\/+$/g, '')
    for (const abs of absolutePaths) {
      if (!existsSync(abs)) {
        return { ok: false, error: `source not found: ${abs}` }
      }
      // Paths that already belong to this remote project should use move, not copy-in.
      if (relativePathUnderRemoteProject(folderPath, abs) != null) {
        return {
          ok: false,
          error: 'use move for paths already inside this remote project',
        }
      }
      const name = basename(abs)
      const destRel = joinProjectRel(destDir, name)
      await copyLocalPathIntoRemote(host, ctx, abs, destRel)
    }
    return { ok: true }
  } catch (err) {
    return { ok: false, error: (err as Error).message }
  }
}

/**
 * Move into remote project:
 * - local host paths → copy then delete local
 * - same-project remote paths → workspace.move
 */
export async function movePathsIntoRemote(
  host: EnvironmentHost,
  folderPath: string,
  destDirRelPath: string,
  paths: string[],
): Promise<FileOpResult | null> {
  const ctx = await resolveRemoteProjectContext(host, folderPath)
  if (!ctx) return null
  try {
    const destDir = destDirRelPath.replace(/\\/g, '/').replace(/^\/+|\/+$/g, '') || '.'
    for (const p of paths) {
      const rel = relativePathUnderRemoteProject(folderPath, p)
      if (rel != null) {
        await host.workspace().move({
          project: projectRef(ctx),
          fromPath: rel,
          destDirPath: destDir,
        })
        continue
      }
      if (!existsSync(p)) {
        return { ok: false, error: `source not found: ${p}` }
      }
      const name = basename(p)
      const destRel = joinProjectRel(destDir === '.' ? '' : destDir, name)
      await copyLocalPathIntoRemote(host, ctx, p, destRel)
      rmSync(p, { recursive: true, force: true })
    }
    return { ok: true }
  } catch (err) {
    return { ok: false, error: (err as Error).message }
  }
}

async function exportRemoteEntryToLocal(
  host: EnvironmentHost,
  ctx: RemoteProjectContext,
  relPath: string,
  localAbs: string,
): Promise<void> {
  const ref = projectRef(ctx)
  const parentRel = relPath.includes('/') ? relPath.slice(0, relPath.lastIndexOf('/')) : '.'
  const entries = await host.workspace().listDir({
    project: ref,
    relativePath: parentRel === '' ? '.' : parentRel,
  })
  const name = basename(relPath.replace(/\\/g, '/'))
  const self = entries.find((e) => e.name === name)
  if (!self) {
    // list parent may not include if path is wrong; try listDir on the path itself for dirs
    try {
      const childEntries = await host.workspace().listDir({ project: ref, relativePath: relPath })
      mkdirSync(localAbs, { recursive: true })
      for (const ent of childEntries) {
        if (SKIP_NAMES.has(ent.name)) continue
        await exportRemoteEntryToLocal(
          host,
          ctx,
          ent.path === '.' ? ent.name : ent.path,
          join(localAbs, ent.name),
        )
      }
      return
    } catch {
      throw new Error(`path not found on remote: ${relPath}`)
    }
  }

  if (self.type === 'directory') {
    mkdirSync(localAbs, { recursive: true })
    const childEntries = await host.workspace().listDir({ project: ref, relativePath: relPath })
    for (const ent of childEntries) {
      if (SKIP_NAMES.has(ent.name)) continue
      const childRel = ent.path === '.' ? ent.name : ent.path
      await exportRemoteEntryToLocal(host, ctx, childRel, join(localAbs, ent.name))
    }
    return
  }

  const raw = await host.workspace().readFile({ project: ref, relativePath: relPath })
  const buf =
    typeof raw.content === 'string'
      ? Buffer.from(raw.content, 'utf8')
      : Buffer.from(raw.content)
  if (buf.length > MAX_TRANSFER_BYTES) {
    throw new Error(`file too large for drag export (${name})`)
  }
  mkdirSync(dirname(localAbs), { recursive: true })
  writeFileSync(localAbs, buf)
}

/**
 * Materialize remote project paths onto the local disk for Electron startDrag /
 * drop into local trees. `dragPaths` are absolute-style keys from TreeRow
 * (`remote:<conn>:<hostAbsFile>` or folderPath-joined).
 *
 * Returns local temp paths (one per top-level selection).
 */
export async function materializeRemotePathsForDrag(
  host: EnvironmentHost,
  folderPath: string,
  dragPaths: string[],
): Promise<string[]> {
  const ctx = await resolveRemoteProjectContext(host, folderPath)
  if (!ctx) return []

  const sessionDir = join(tmpdir(), 'superone-remote-drag', randomUUID())
  mkdirSync(sessionDir, { recursive: true })
  const out: string[] = []

  for (const dragPath of dragPaths) {
    const rel = relativePathUnderRemoteProject(folderPath, dragPath)
    if (!rel) continue
    // Preserve relative path under sessionDir so same-basename files do not clobber.
    const localAbs = join(sessionDir, rel)
    mkdirSync(dirname(localAbs), { recursive: true })
    await exportRemoteEntryToLocal(host, ctx, rel, localAbs)
    if (existsSync(localAbs)) out.push(localAbs)
  }
  return out
}

/**
 * Resolve startDrag inputs: keep real local files; materialize remote: keys.
 * `paths` may mix local abs paths and remote project keys from different trees —
 * only paths under a single remote folderPath that we can resolve are exported
 * when `folderPath` is provided; otherwise each path is parsed independently.
 */
/**
 * Read a project-relative file for FilePreview / source control.
 * Media types return a `data:` URI in `content` so the renderer can preview
 * without a local file:// path.
 */
export async function readRemoteProjectFile(
  host: EnvironmentHost,
  folderPath: string,
  filePath: string,
): Promise<GitFileContent | null> {
  const ctx = await resolveRemoteProjectContext(host, folderPath)
  if (!ctx) return null
  const rel = filePath.replace(/\\/g, '/').replace(/^\//, '')
  const ext = extname(rel).toLowerCase()
  try {
    const raw = await host.workspace().readFile({
      project: projectRef(ctx),
      relativePath: rel,
    })
    const buf = bufferFromWorkspaceContent(raw.content)
    if (buf.length > MAX_TRANSFER_BYTES) {
      return { path: filePath, content: '', language: 'too-large' }
    }

    if (REMOTE_IMAGE_EXTS.has(ext)) {
      const mime = REMOTE_MIME[ext] ?? 'application/octet-stream'
      return {
        path: filePath,
        content: `data:${mime};base64,${buf.toString('base64')}`,
        language: 'image',
      }
    }
    if (REMOTE_PDF_EXTS.has(ext)) {
      return {
        path: filePath,
        content: `data:application/pdf;base64,${buf.toString('base64')}`,
        language: 'pdf',
      }
    }
    if (REMOTE_VIDEO_EXTS.has(ext)) {
      const mime = REMOTE_MIME[ext] ?? 'video/mp4'
      return {
        path: filePath,
        content: `data:${mime};base64,${buf.toString('base64')}`,
        language: 'video',
      }
    }
    if (REMOTE_AUDIO_EXTS.has(ext)) {
      const mime = REMOTE_MIME[ext] ?? 'audio/mpeg'
      return {
        path: filePath,
        content: `data:${mime};base64,${buf.toString('base64')}`,
        language: 'audio',
      }
    }

    // Sniff binary vs text (nul byte in first 8 KiB).
    const sniff = buf.subarray(0, Math.min(8192, buf.length))
    if (sniff.includes(0)) {
      return { path: filePath, content: '', language: 'binary' }
    }
    const text = buf.toString('utf8')
    if (ext === '.svg') return { path: filePath, content: text, language: 'svg' }
    return { path: filePath, content: text, language: REMOTE_EXT_LANG[ext] ?? 'text' }
  } catch (err) {
    return {
      path: filePath,
      content: '',
      language: 'text',
    }
  }
}

export async function saveRemoteProjectFile(
  host: EnvironmentHost,
  folderPath: string,
  filePath: string,
  content: string,
): Promise<FileOpResult | null> {
  const ctx = await resolveRemoteProjectContext(host, folderPath)
  if (!ctx) return null
  try {
    const rel = filePath.replace(/\\/g, '/').replace(/^\//, '')
    const bytes = Buffer.byteLength(content, 'utf8')
    if (bytes > MAX_TRANSFER_BYTES) {
      return { ok: false, error: `file too large to save (max ${MAX_TRANSFER_BYTES} bytes)` }
    }
    await host.workspace().writeFile({
      project: projectRef(ctx),
      relativePath: rel,
      content,
    })
    return { ok: true }
  } catch (err) {
    return { ok: false, error: (err as Error).message }
  }
}

/**
 * Status-bar GitInfo for a remote project key (branch + dirty file count).
 * Insertions/deletions are not computed remotely (no shortstat RPC yet) — 0 when dirty.
 */
type RemoteGitGateway = {
  gitStatus: (projectId: string, opts?: { cwd?: string }) => Promise<unknown>
  gitBranches?: (projectId: string) => Promise<unknown>
  gitWorktrees?: (projectId: string) => Promise<unknown>
}

function asRemoteGitGateway(gw: unknown): RemoteGitGateway | null {
  if (gw instanceof RemoteEnvironmentGateway) return gw
  if (
    gw &&
    typeof gw === 'object' &&
    typeof (gw as RemoteGitGateway).gitStatus === 'function'
  ) {
    return gw as RemoteGitGateway
  }
  return null
}

function mapStatusToGitInfo(status: {
  isRepo?: boolean
  branch?: string | null
  dirty?: boolean
  porcelain?: string
  insertions?: number
  deletions?: number
} | null): GitInfo | null {
  if (!status?.isRepo) return null
  const branch =
    (typeof status.branch === 'string' && status.branch.trim()) || 'HEAD'
  const porcelain = typeof status.porcelain === 'string' ? status.porcelain : ''
  const files = porcelain
    ? porcelain.split('\n').filter((line) => line.trim().length > 0).length
    : status.dirty
      ? 1
      : 0
  const insertions =
    typeof status.insertions === 'number' && Number.isFinite(status.insertions)
      ? Math.max(0, status.insertions)
      : 0
  const deletions =
    typeof status.deletions === 'number' && Number.isFinite(status.deletions)
      ? Math.max(0, status.deletions)
      : 0
  return {
    branch,
    ...(files > 0 ? { dirty: { files, insertions, deletions } } : {}),
  }
}

export async function getRemoteGitInfo(
  host: EnvironmentHost,
  folderPath: string,
): Promise<GitInfo | null> {
  if (!parseRemoteProjectKey(folderPath)) return null
  try {
    // Never registerIfMissing — git probes must not pollute project.list with worktree paths.
    const ctx = await resolveRemoteProjectContext(host, folderPath, { registerIfMissing: false })
    if (ctx) {
      return mapStatusToGitInfo(await fetchRemoteGitStatusRaw(host, ctx))
    }
    // Worktree host path under a registered project: status with cwd, no openProject.
    const remote = parseRemoteProjectKey(folderPath)!
    const known = host.connections.listKnown().find((k) => k.connectionId === remote.connectionId)
    if (!known) return null
    const gw = asRemoteGitGateway(host.getGateway(known.environmentId))
    if (!gw) return null
    const projects = await host.listProjects(remote.connectionId)
    for (const p of projects) {
      try {
        const status = (await gw.gitStatus(p.projectId, { cwd: remote.path })) as {
          isRepo?: boolean
          branch?: string | null
          dirty?: boolean
          porcelain?: string
          insertions?: number
          deletions?: number
        }
        if (status?.isRepo) return mapStatusToGitInfo(status)
      } catch {
        /* not a worktree of this project */
      }
    }
    return null
  } catch {
    return null
  }
}

export async function getRemoteGitIsRepo(
  host: EnvironmentHost,
  folderPath: string,
): Promise<boolean | null> {
  const info = await getRemoteGitInfo(host, folderPath)
  if (info) return true
  if (!parseRemoteProjectKey(folderPath)) return null
  return false
}

export async function getRemoteGitBranches(
  host: EnvironmentHost,
  folderPath: string,
): Promise<string[] | null> {
  const ctx = await resolveRemoteProjectContext(host, folderPath, { registerIfMissing: false })
  if (!ctx) return null
  try {
    const gw = asRemoteGitGateway(host.getGateway(ctx.environmentId))
    if (!gw?.gitBranches) return null
    const result = (await gw.gitBranches(ctx.projectId)) as {
      branches?: string[]
      current?: string | null
    }
    return Array.isArray(result?.branches) ? result.branches : []
  } catch {
    return []
  }
}

/**
 * Status-bar workdir / worktree chip for remote projects.
 * Maps node `git.worktrees` + `git.status` into the same WorktreeInfo shape
 * local `getWorktreeInfo` returns so WorkDirIndicator can show Monitor/"Local"
 * (or a worktree label when the project path is a linked worktree).
 */
export async function getRemoteWorktreeInfo(
  host: EnvironmentHost,
  folderPath: string,
): Promise<WorktreeInfo | null> {
  // Only for already-registered projects — never openProject here.
  const ctx = await resolveRemoteProjectContext(host, folderPath, { registerIfMissing: false })
  if (!ctx) return null
  try {
    const gw = asRemoteGitGateway(host.getGateway(ctx.environmentId))
    if (!gw) return null
    // Parallel: status (coalesced with status-bar) + worktree list.
    const [status, rawWts] = await Promise.all([
      fetchRemoteGitStatusRaw(host, ctx),
      typeof gw.gitWorktrees === 'function'
        ? gw.gitWorktrees(ctx.projectId).catch(() => [])
        : Promise.resolve([]),
    ])
    if (!status?.isRepo) return null

    const hostPath = normalizeHostPath(ctx.hostPath)
    const remoteWts = Array.isArray(rawWts)
      ? (rawWts as Array<{ path?: string; branch?: string | null; bare?: boolean }>)
      : []

    const entries: WorktreeEntry[] = []
    for (let i = 0; i < remoteWts.length; i++) {
      const wt = remoteWts[i]!
      if (!wt.path) continue
      const path = normalizeHostPath(wt.path)
      entries.push({
        path: wt.path,
        branch: typeof wt.branch === 'string' ? wt.branch : '',
        head: '',
        isMain: i === 0,
        isCurrent: hostPathsEqual(path, hostPath),
      })
    }

    if (entries.length === 0) {
      entries.push({
        path: ctx.hostPath,
        branch: typeof status.branch === 'string' ? status.branch : '',
        head: '',
        isMain: true,
        isCurrent: true,
      })
    } else if (!entries.some((e) => e.isCurrent)) {
      // Project path not listed as a worktree row — treat as main checkout.
      entries[0] = { ...entries[0]!, isCurrent: true }
    }

    const mainEntry = entries.find((e) => e.isMain) ?? entries[0]!
    const current = entries.find((e) => e.isCurrent) ?? mainEntry
    const isWorktree = !hostPathsEqual(normalizeHostPath(mainEntry.path), hostPath)
    return {
      isWorktree,
      currentBranch:
        current.branch ||
        (typeof status.branch === 'string' ? status.branch : '') ||
        '',
      entries,
    }
  } catch {
    return null
  }
}

export async function getRemoteGitDiffFile(
  host: EnvironmentHost,
  folderPath: string,
  filePath: string,
  staged: boolean,
): Promise<GitFileDiff | null> {
  const ctx = await resolveRemoteProjectContext(host, folderPath)
  if (!ctx) return null
  try {
    const gw = host.getGateway(ctx.environmentId)
    if (!(gw instanceof RemoteEnvironmentGateway)) {
      return { path: filePath, diff: '' }
    }
    const result = (await gw.gitDiff(ctx.projectId, {
      staged,
      path: filePath.replace(/\\/g, '/').replace(/^\//, ''),
    })) as { diff?: string }
    return { path: filePath, diff: result.diff ?? '' }
  } catch {
    return { path: filePath, diff: '' }
  }
}

export async function resolvePathsForNativeDrag(
  host: EnvironmentHost,
  paths: string[],
): Promise<string[]> {
  const local: string[] = []
  const byFolder = new Map<string, string[]>()

  for (const p of paths) {
    if (typeof p !== 'string') continue
    if (existsSync(p)) {
      local.push(p)
      continue
    }
    const remote = parseRemoteProjectKey(p)
    if (!remote) continue
    // Local lab / same-machine node: host path is already on this disk — drag
    // the real path without a temp export (still a remote project key in the UI).
    if (existsSync(remote.path)) {
      local.push(remote.path)
      continue
    }
    // True remote: materialize via workspace RPC. Infer project root from
    // registered projects for this connection (TreeRow builds
    // remote:<conn>:<projectRoot>/<rel>).
    const candidates = await host.listProjects(remote.connectionId).catch(() => [])
    let folderKey: string | null = null
    let matched: string | null = null
    for (const proj of candidates) {
      const root = normalizeHostPath(proj.path)
      const full = normalizeHostPath(remote.path)
      if (full === root || full.startsWith(`${root}/`)) {
        folderKey = `remote:${remote.connectionId}:${proj.path}`
        matched = p
        break
      }
    }
    if (!folderKey || !matched) continue
    const list = byFolder.get(folderKey) ?? []
    list.push(matched)
    byFolder.set(folderKey, list)
  }

  const materialized: string[] = []
  for (const [folderKey, group] of byFolder) {
    const files = await materializeRemotePathsForDrag(host, folderKey, group)
    materialized.push(...files)
  }
  return [...local, ...materialized]
}
