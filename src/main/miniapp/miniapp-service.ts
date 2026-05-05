import { readdir, readFile, writeFile, stat, mkdir, glob, watch, rm, rename } from 'fs/promises'
import { watch as watchSync } from 'fs'
import type { FSWatcher } from 'fs'
import { join, resolve, sep, relative, dirname } from 'path'
import { app, shell } from 'electron'
import log from '../logger'
import { gitRun } from '../git-run'
import { sanitizeGitRef } from '../path-security'
import { parseGitStatusFiles } from '../git-status-utils'
import { parseManifest, parseDevLink } from './miniapp-schema'
import type { MiniAppEntry, MiniAppManifest, MiniAppFsOp, MiniAppFsWatchEvent, MiniAppGitOp, MiniAppFsAccess, MiniAppMediaKind } from '../../shared/miniapp-types'
import { generateVanillaFiles, generateReactFiles, type GeneratedFile } from './miniapp-templates'

const DEV_LINK_FILE = '.s1-dev.json'

const userAppsDir = () => join(app.getPath('home'), '.superone', 'apps')

export interface AllowedDir {
  path: string
  access: MiniAppFsAccess
}

const allowedDirs = new Map<string, AllowedDir[]>()

let watchIdCounter = 0
const activeWatchers = new Map<number, { appId: string; controller: AbortController }>()

type WatchEventCallback = (event: MiniAppFsWatchEvent) => void
let watchEventCallback: WatchEventCallback | null = null

export function onFsWatchEvent(cb: WatchEventCallback): void {
  watchEventCallback = cb
}

export function startWatch(appId: string, watchPath: string): number {
  const dirs = allowedDirs.get(appId)
  if (!dirs?.length) throw new Error(`No allowed directories for app: ${appId}`)

  const { resolved } = resolveSafePathMulti(dirs, watchPath)

  const watchId = ++watchIdCounter
  const controller = new AbortController()
  activeWatchers.set(watchId, { appId, controller })

  ;(async () => {
    try {
      const watcher = watch(resolved, { recursive: true, signal: controller.signal })
      let debounceTimer: ReturnType<typeof setTimeout> | null = null
      const pending = new Map<string, 'change' | 'rename'>()
      const flush = () => {
        for (const [path, type] of pending) {
          watchEventCallback?.({ watchId, appId, type, path })
        }
        pending.clear()
        debounceTimer = null
      }
      for await (const event of watcher) {
        const relPath = event.filename
          ? relative(resolved, resolve(resolved, event.filename))
          : '.'
        pending.set(relPath, event.eventType as 'change' | 'rename')
        if (!debounceTimer) {
          debounceTimer = setTimeout(flush, 100)
        }
      }
    } catch (err: unknown) {
      if (err instanceof Error && err.name === 'AbortError') return
      log.warn(`[miniapp] fs.watch error for ${watchPath}:`, err)
    } finally {
      activeWatchers.delete(watchId)
    }
  })()

  return watchId
}

export function stopWatch(watchId: number): void {
  const entry = activeWatchers.get(watchId)
  if (entry) {
    entry.controller.abort()
    activeWatchers.delete(watchId)
  }
}

function clearWatchersForApp(appId: string): void {
  for (const [id, entry] of activeWatchers) {
    if (entry.appId === appId) {
      entry.controller.abort()
      activeWatchers.delete(id)
    }
  }
}

export function resolveSafePathMulti(dirs: AllowedDir[], relativePath: string): { resolved: string; access: MiniAppFsAccess } {
  const superoneSeg = `${sep}.superone${sep}`
  for (const dir of dirs) {
    const resolved = resolve(dir.path, relativePath)
    const normalizedBase = dir.path.endsWith(sep) ? dir.path : dir.path + sep
    if (resolved.startsWith(normalizedBase) || resolved === dir.path) {
      if (resolved.includes(superoneSeg) && !dir.path.includes(superoneSeg)) {
        throw new Error('Access denied: .superone is a protected directory')
      }
      return { resolved, access: dir.access }
    }
  }
  throw new Error(`Path not within allowed directories: ${relativePath}`)
}

type GitHeadChangeCallback = (event: { appId: string }) => void
let gitHeadChangeCallback: GitHeadChangeCallback | null = null
const gitHeadWatchers = new Map<string, FSWatcher>()

export function onGitHeadChangeEvent(cb: GitHeadChangeCallback): void {
  gitHeadChangeCallback = cb
}

function startGitHeadWatch(appId: string, workingDir: string): void {
  if (gitHeadWatchers.has(appId)) return
  const headPath = join(workingDir, '.git', 'HEAD')
  let timer: ReturnType<typeof setTimeout> | null = null
  try {
    const watcher = watchSync(headPath, () => {
      if (timer) clearTimeout(timer)
      timer = setTimeout(() => gitHeadChangeCallback?.({ appId }), 100)
    })
    watcher.on('error', () => {
      watcher.close()
      gitHeadWatchers.delete(appId)
    })
    gitHeadWatchers.set(appId, watcher)
  } catch { /* not a git repo */ }
}

function stopGitHeadWatch(appId: string): void {
  const watcher = gitHeadWatchers.get(appId)
  if (watcher) {
    watcher.close()
    gitHeadWatchers.delete(appId)
  }
}

export function getAllowedDirs(appId: string): AllowedDir[] | undefined {
  return allowedDirs.get(appId)
}

export function setAllowedDirectories(appId: string, dirs: AllowedDir[]): void {
  allowedDirs.set(appId, dirs)
}

export function clearAllowedDirectories(appId: string): void {
  clearWatchersForApp(appId)
  stopGitHeadWatch(appId)
  allowedDirs.delete(appId)
}

const allowedMedia = new Map<string, Set<MiniAppMediaKind>>()

export function setAllowedMedia(appId: string, kinds: MiniAppMediaKind[]): void {
  if (kinds.length === 0) {
    allowedMedia.delete(appId)
    return
  }
  allowedMedia.set(appId, new Set(kinds))
}

export function getAllowedMedia(appId: string): Set<MiniAppMediaKind> | undefined {
  return allowedMedia.get(appId)
}

export function clearAllowedMedia(appId: string): void {
  allowedMedia.delete(appId)
}

export function isMediaAllowed(appId: string, kind: MiniAppMediaKind): boolean {
  return allowedMedia.get(appId)?.has(kind) ?? false
}

export function appIdFromUrl(url: string): string | null {
  try {
    const u = new URL(url)
    if (u.protocol !== 'superone-app:') return null
    return u.hostname ? u.hostname.toLowerCase() : null
  } catch {
    return null
  }
}

async function scanDir(base: string, opts: { projectDir?: string } = {}): Promise<MiniAppEntry[]> {
  let dirs: string[]
  try {
    dirs = await readdir(base)
  } catch {
    return []
  }
  const results = await Promise.all(
    dirs.map(async (name) => resolveAppEntry(join(base, name), opts)),
  )
  return results.filter((e): e is MiniAppEntry => e !== null)
}

interface ResolveAppEntryOpts {
  projectDir?: string
}

export async function resolveAppEntry(installDir: string, opts: ResolveAppEntryOpts): Promise<MiniAppEntry | null> {
  const devLink = await readDevLink(installDir)
  if (devLink && devLink.enabled) {
    const distDir = resolveDistDir(devLink.distDir, opts.projectDir)
    if (distDir) {
      const manifest = await readManifest(distDir)
      if (manifest) {
        return { id: manifest.appId, manifest, installDir, distDir }
      }
      log.warn('[miniapp] dev link distDir has no manifest: %s → %s', installDir, distDir)
    }
  }
  const manifest = await readManifest(installDir)
  if (!manifest) return null
  return { id: manifest.appId, manifest, installDir }
}

async function readDevLink(installDir: string): Promise<{ distDir: string; enabled: boolean } | null> {
  let raw: string
  try {
    raw = await readFile(join(installDir, DEV_LINK_FILE), 'utf-8')
  } catch {
    return null
  }
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    log.warn('[miniapp] %s is not valid JSON in %s', DEV_LINK_FILE, installDir)
    return null
  }
  const result = parseDevLink(parsed)
  if (!result.ok) {
    log.warn('[miniapp] invalid %s in %s: %s', DEV_LINK_FILE, installDir, result.errors.join('; '))
    return null
  }
  return result.devLink
}

function resolveDistDir(distDir: string, projectDir: string | undefined): string | null {
  if (distDir.startsWith('/')) return distDir
  if (!projectDir) {
    log.warn('[miniapp] relative distDir %s requires a projectDir base', distDir)
    return null
  }
  return resolve(projectDir, distDir)
}

export async function discoverApps(): Promise<MiniAppEntry[]> {
  return scanDir(userAppsDir())
}

export async function detectStandaloneApp(projectDir: string): Promise<MiniAppEntry | null> {
  const rootManifest = await readManifest(projectDir)
  if (rootManifest) return { id: rootManifest.appId, manifest: rootManifest, installDir: projectDir }

  const distDir = join(projectDir, 'dist')
  const distManifest = await readManifest(distDir)
  if (distManifest) return { id: distManifest.appId, manifest: distManifest, installDir: projectDir, distDir }

  return null
}

export async function readManifest(appDir: string): Promise<MiniAppManifest | null> {
  try {
    const raw = await readFile(join(appDir, 'manifest.json'), 'utf-8')
    const parsed = JSON.parse(raw)
    const result = parseManifest(parsed)
    if (!result.ok) {
      log.warn('[miniapp] invalid manifest in %s: %s', appDir, result.errors.join('; '))
      return null
    }
    return result.manifest as MiniAppManifest
  } catch {
    return null
  }
}

export type CreateMiniAppScope = 'project' | 'user'
export type CreateMiniAppTemplate = 'vanilla' | 'react'

export interface CreateMiniAppOptions {
  name: string
  slug: string
  directory: string
  scope?: CreateMiniAppScope
  projectDir?: string
  template?: CreateMiniAppTemplate
  type?: MiniAppManifest['type']
  description?: string
}

export interface CreateMiniAppResult {
  entry: MiniAppEntry
  appPath: string
  buildRequired: boolean
}

const PROJECT_APPS_DIR = '.superone/apps'

export function getProjectAppsDir(projectDir: string): string {
  return join(projectDir, PROJECT_APPS_DIR)
}

export async function discoverProjectApps(projectDir: string): Promise<MiniAppEntry[]> {
  return scanDir(getProjectAppsDir(projectDir), { projectDir })
}

async function writeGeneratedFiles(baseDir: string, files: GeneratedFile[]): Promise<void> {
  for (const file of files) {
    const filePath = join(baseDir, file.path)
    await mkdir(dirname(filePath), { recursive: true })
    await writeFile(filePath, file.content, 'utf-8')
  }
}

export async function createMiniApp(opts: CreateMiniAppOptions): Promise<CreateMiniAppResult> {
  const scope = opts.scope ?? 'project'
  const template = opts.template ?? 'vanilla'
  const directory = opts.directory

  if (!directory.startsWith('/')) {
    throw new Error(`directory must be an absolute path, got: ${directory}`)
  }
  if (scope === 'project') {
    if (!opts.projectDir) {
      throw new Error('scope="project" requires projectDir')
    }
    const projectBase = opts.projectDir.endsWith('/') ? opts.projectDir : opts.projectDir + '/'
    if (!directory.startsWith(projectBase) && directory !== opts.projectDir) {
      throw new Error(`scope="project" requires directory to be inside projectDir; ${directory} is outside ${opts.projectDir}`)
    }
  }

  const appId = `${opts.slug}-${Date.now().toString(36)}`

  const manifest: MiniAppManifest = {
    appId,
    name: opts.name,
    isDev: true,
    ...(opts.type && { type: opts.type }),
    ...(opts.description && { description: opts.description }),
  }

  const templateOpts = { name: opts.name, manifest }
  const files = template === 'react'
    ? generateReactFiles(templateOpts)
    : generateVanillaFiles(templateOpts)
  const buildRequired = template === 'react'

  await writeGeneratedFiles(directory, files)

  const distAbs = template === 'react' ? join(directory, 'dist') : directory
  const installRoot = scope === 'project'
    ? getProjectAppsDir(opts.projectDir!)
    : userAppsDir()
  const installDir = join(installRoot, appId)
  const distDirField = scope === 'project'
    ? relative(opts.projectDir!, distAbs)
    : distAbs

  const devLink = { distDir: distDirField, enabled: true }
  await mkdir(installDir, { recursive: true })
  await writeFile(join(installDir, DEV_LINK_FILE), JSON.stringify(devLink, null, 2), 'utf-8')

  return {
    entry: { id: appId, manifest, installDir, distDir: distAbs },
    appPath: directory,
    buildRequired,
  }
}

interface CachedAppPaths {
  installDir: string
  assetDir: string
}

const appPathCache = new Map<string, CachedAppPaths>()

export function cacheAppPaths(appId: string, paths: CachedAppPaths): void {
  appPathCache.set(appId, paths)
}

export function cacheAppEntry(entry: MiniAppEntry): void {
  appPathCache.set(entry.id, { installDir: entry.installDir, assetDir: entry.distDir ?? entry.installDir })
}

export function getAppBasePath(appId: string): string {
  const cached = appPathCache.get(appId)
  if (cached) return cached.assetDir
  return join(userAppsDir(), appId)
}

export function getAppInstallDir(appId: string): string {
  const cached = appPathCache.get(appId)
  if (cached) return cached.installDir
  return join(userAppsDir(), appId)
}

/** @deprecated use cacheAppEntry; kept for callers that only know the asset path. */
export function cacheAppBasePath(appId: string, basePath: string): void {
  appPathCache.set(appId, { installDir: basePath, assetDir: basePath })
}

export function generateCSP(manifest: MiniAppManifest): string {
  const networkEntries = manifest.permissions?.network ?? []
  const domains = networkEntries.map((e) => e.domain.includes('://') ? e.domain : `https://${e.domain}`)
  const connectSrc = ["'self'", 'superone-app:', 'superone-fs:', ...domains].join(' ')
  const scriptSrc = ["'self'", "'unsafe-inline'", ...domains].join(' ')
  const styleSrc = ["'self'", "'unsafe-inline'", ...domains].join(' ')
  return [
    "default-src 'none'",
    `script-src ${scriptSrc}`,
    `style-src ${styleSrc}`,
    `img-src 'self' superone-app: data: blob: ${domains.join(' ')}`.trim(),
    `connect-src ${connectSrc}`,
    `font-src 'self' ${domains.join(' ')}`.trim(),
    `media-src 'self' superone-app: blob:`,
  ].join('; ')
}

export function validatePath(basePath: string, requestedPath: string): string | null {
  const resolved = resolve(basePath, requestedPath.replace(/^\/+/, ''))
  const normalizedBase = basePath.endsWith(sep) ? basePath : basePath + sep
  if (!resolved.startsWith(normalizedBase) && resolved !== basePath) {
    return null
  }
  return resolved
}

const WRITE_OPS: Set<MiniAppFsOp> = new Set(['writeFile', 'deleteFile', 'rename', 'mkdir'])

export async function handleFsRequest(
  appId: string,
  op: MiniAppFsOp,
  args: Record<string, unknown>,
): Promise<unknown> {
  const dirs = allowedDirs.get(appId)
  if (!dirs?.length) throw new Error(`No allowed directories for app: ${appId}`)

  const safe = (p: string) => {
    const result = resolveSafePathMulti(dirs, p)
    if (WRITE_OPS.has(op) && result.access === 'read') {
      throw new Error(`Write access denied: ${p} (read-only permission)`)
    }
    return result.resolved
  }

  switch (op) {
    case 'readFile': {
      return await readFile(safe(args.path as string), 'utf-8')
    }
    case 'readFileBinary': {
      const buf = await readFile(safe(args.path as string))
      return buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength)
    }
    case 'readDir': {
      const p = safe((args.path as string) || '.')
      const entries = await readdir(p, { withFileTypes: true })
      return entries.map((e) => ({ name: e.name, isDir: e.isDirectory() }))
    }
    case 'writeFile': {
      const p = safe(args.path as string)
      await mkdir(dirname(p), { recursive: true })
      const content = args.content
      if (content instanceof ArrayBuffer || content instanceof Uint8Array || Buffer.isBuffer(content)) {
        await writeFile(p, Buffer.from(content as ArrayBuffer))
      } else {
        await writeFile(p, content as string, 'utf-8')
      }
      return undefined
    }
    case 'exists': {
      try {
        await stat(safe(args.path as string))
        return true
      } catch {
        return false
      }
    }
    case 'glob': {
      const pattern = args.pattern as string
      const allFiles: string[] = []
      for (const dir of dirs) {
        for await (const entry of glob(pattern, { cwd: dir.path })) {
          allFiles.push(entry)
        }
      }
      return allFiles
    }
    case 'deleteFile': {
      await rm(safe(args.path as string))
      return undefined
    }
    case 'rename': {
      const from = safe(args.from as string)
      const to = safe(args.to as string)
      await mkdir(dirname(to), { recursive: true })
      await rename(from, to)
      return undefined
    }
    case 'stat': {
      const s = await stat(safe(args.path as string))
      return { size: s.size, isDir: s.isDirectory(), isFile: s.isFile(), mtime: s.mtimeMs, ctime: s.ctimeMs }
    }
    case 'mkdir': {
      await mkdir(safe(args.path as string), { recursive: true })
      return undefined
    }
    case 'showInFolder': {
      shell.showItemInFolder(safe(args.path as string))
      return undefined
    }
    default:
      throw new Error(`Unknown fs operation: ${op}`)
  }
}

export function getGitDirectory(appId: string): string | undefined {
  const dirs = allowedDirs.get(appId)
  return dirs?.[0]?.path
}

export async function handleGitRequest(
  appId: string,
  op: MiniAppGitOp,
  args: Record<string, unknown>,
): Promise<unknown> {
  const workingDir = getGitDirectory(appId)
  if (!workingDir) throw new Error(`No allowed directories for app: ${appId}`)

  startGitHeadWatch(appId, workingDir)

  switch (op) {
    case 'info': {
      const branchP = gitRun(workingDir, ['rev-parse', '--abbrev-ref', 'HEAD'])
        .catch(() => gitRun(workingDir, ['symbolic-ref', 'HEAD']).then((ref) => ref.replace('refs/heads/', '')))
      const statusP = gitRun(workingDir, ['status', '--porcelain'])
      const [branch, porcelain] = await Promise.all([branchP, statusP])
      const files = porcelain ? porcelain.split('\n').filter(Boolean).length : 0
      if (files === 0) return { branch }
      let insertions = 0, deletions = 0
      try {
        const shortstat = await gitRun(workingDir, ['diff', 'HEAD', '--shortstat'])
        const insMatch = shortstat.match(/(\d+) insertion/)
        const delMatch = shortstat.match(/(\d+) deletion/)
        if (insMatch) insertions = parseInt(insMatch[1])
        if (delMatch) deletions = parseInt(delMatch[1])
      } catch { /* empty */ }
      return { branch, dirty: { files, insertions, deletions } }
    }
    case 'branches': {
      const raw = await gitRun(workingDir, ['branch', '--format=%(refname:short)'])
      return raw ? raw.split('\n').filter(Boolean) : []
    }
    case 'log': {
      const limit = (args.limit as number) || 50
      const gitArgs = ['log', '--format=%H%x00%P%x00%s%x00%an%x00%ai', `-${limit}`]
      if (args.all) gitArgs.push('--all')
      if (args.ref && typeof args.ref === 'string') gitArgs.push(args.ref)
      const raw = await gitRun(workingDir, gitArgs)
      if (!raw) return []
      return raw.split('\n').filter(Boolean).map((line) => {
        const [sha, parents, message, author, date] = line.split('\0')
        return { sha, parents: parents ? parents.split(' ') : [], message, author, date }
      })
    }
    case 'status': {
      const raw = await gitRun(workingDir, ['status', '--porcelain=v1'])
      if (!raw) return []
      return parseGitStatusFiles(raw)
    }
    case 'diff': {
      const filePath = args.path as string
      const staged = args.staged as boolean ?? false
      const gitArgs = staged
        ? ['diff', '--cached', '--', filePath]
        : ['diff', '--', filePath]
      const diff = await gitRun(workingDir, gitArgs)
      return { path: filePath, diff }
    }
    case 'show': {
      const ref = sanitizeGitRef(args.ref as string)
      const filePath = args.path as string
      if (filePath.includes('\0')) throw new Error('Invalid path')
      const content = await gitRun(workingDir, ['show', `${ref}:${filePath}`])
      return { ref, path: filePath, content }
    }
    case 'blame': {
      const filePath = args.path as string
      if (!filePath || filePath.includes('\0')) throw new Error('Invalid path')
      const raw = await gitRun(workingDir, ['blame', '--porcelain', '--', filePath])
      if (!raw) return []
      const lines: { sha: string; author: string; date: string; lineNo: number; content: string }[] = []
      let cur = { sha: '', author: '', date: '', lineNo: 0 }
      for (const line of raw.split('\n')) {
        if (/^[0-9a-f]{40}\s/.test(line)) {
          const parts = line.split(' ')
          cur = { sha: parts[0], author: '', date: '', lineNo: parseInt(parts[2]) }
        } else if (line.startsWith('author ')) {
          cur.author = line.slice(7)
        } else if (line.startsWith('author-time ')) {
          cur.date = new Date(parseInt(line.slice(12)) * 1000).toISOString()
        } else if (line.startsWith('\t')) {
          lines.push({ ...cur, content: line.slice(1) })
        }
      }
      return lines
    }
    case 'diffSummary': {
      const ref1 = sanitizeGitRef(args.ref1 as string || 'HEAD')
      const ref2 = sanitizeGitRef(args.ref2 as string || '')
      const gitArgs = ['diff', '--stat', '--numstat']
      if (ref2) gitArgs.push(ref1, ref2)
      else gitArgs.push(ref1)
      const raw = await gitRun(workingDir, gitArgs)
      if (!raw) return []
      return raw.split('\n').filter(Boolean).map((line) => {
        const [add, del, path] = line.split('\t')
        if (!path) return null
        return { path, insertions: add === '-' ? 0 : parseInt(add), deletions: del === '-' ? 0 : parseInt(del) }
      }).filter(Boolean)
    }
    case 'getCommit': {
      const ref = sanitizeGitRef(args.ref as string || 'HEAD')
      const raw = await gitRun(workingDir, [
        'show', '--format=%H%x00%P%x00%s%x00%b%x00%an%x00%ae%x00%ai', '--stat', '--stat-width=200', ref,
      ])
      if (!raw) throw new Error('Commit not found')
      const parts = raw.split('\0')
      const sha = parts[0]
      const parents = parts[1] ? parts[1].split(' ') : []
      const subject = parts[2]
      const body = (parts[3] || '').trim()
      const author = parts[4] || ''
      const email = parts[5] || ''
      const dateAndRest = parts[6] || ''
      const dateEnd = dateAndRest.indexOf('\n')
      const date = dateEnd !== -1 ? dateAndRest.substring(0, dateEnd) : dateAndRest
      const statRaw = dateEnd !== -1 ? dateAndRest.substring(dateEnd) : ''
      const files: { path: string; insertions: number; deletions: number }[] = []
      for (const sl of statRaw.split('\n')) {
        const m = sl.match(/^\s*(.+?)\s+\|\s+(\d+)\s+(\+*)(-*)/)
        if (m) files.push({ path: m[1].trim(), insertions: m[3].length, deletions: m[4].length })
      }
      return { sha, parents, subject, body, author, email, date, files }
    }
    case 'tags': {
      const raw = await gitRun(workingDir, ['tag', '--sort=-creatordate', '--format=%(refname:short)%00%(objectname:short)%00%(creatordate:iso)'])
      if (!raw) return []
      return raw.split('\n').filter(Boolean).map((line) => {
        const [name, sha, date] = line.split('\0')
        return { name, sha, date: date?.trim() }
      })
    }
    case 'remotes': {
      const raw = await gitRun(workingDir, ['remote', '-v'])
      if (!raw) return []
      const map = new Map<string, { name: string; fetchUrl: string; pushUrl: string }>()
      for (const line of raw.split('\n').filter(Boolean)) {
        const m = line.match(/^(\S+)\s+(\S+)\s+\((fetch|push)\)$/)
        if (!m) continue
        const entry = map.get(m[1]) || { name: m[1], fetchUrl: '', pushUrl: '' }
        if (m[3] === 'fetch') entry.fetchUrl = m[2]
        else entry.pushUrl = m[2]
        map.set(m[1], entry)
      }
      return [...map.values()]
    }
    case 'branchDetail': {
      const name = args.name as string
      if (!name) throw new Error('Branch name required')
      const fmt = '%(refname:short)%00%(upstream:short)%00%(upstream:track)'
      const raw = await gitRun(workingDir, ['for-each-ref', `--format=${fmt}`, `refs/heads/${name}`])
      if (!raw) throw new Error(`Branch not found: ${name}`)
      const [refName, upstream, track] = raw.trim().split('\0')
      let ahead = 0, behind = 0
      if (track) {
        const aM = track.match(/ahead (\d+)/)
        const bM = track.match(/behind (\d+)/)
        if (aM) ahead = parseInt(aM[1])
        if (bM) behind = parseInt(bM[1])
      }
      return { name: refName, upstream: upstream || null, ahead, behind }
    }
    case 'stashList': {
      const raw = await gitRun(workingDir, ['stash', 'list', '--format=%gd%x00%s%x00%ai'])
      if (!raw) return []
      return raw.split('\n').filter(Boolean).map((line) => {
        const [ref, message, date] = line.split('\0')
        return { ref, message, date }
      })
    }
    case 'logFile': {
      const filePath = args.path as string
      if (!filePath || filePath.includes('\0')) throw new Error('Invalid path')
      const limit = (args.limit as number) || 50
      const raw = await gitRun(workingDir, [
        'log', '--format=%H%x00%P%x00%s%x00%an%x00%ai', `-${limit}`, '--follow', '--', filePath,
      ])
      if (!raw) return []
      return raw.split('\n').filter(Boolean).map((line) => {
        const [sha, parents, message, author, date] = line.split('\0')
        return { sha, parents: parents ? parents.split(' ') : [], message, author, date }
      })
    }
    default:
      throw new Error(`Unknown git operation: ${op}`)
  }
}
