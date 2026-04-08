import { readdir, readFile, writeFile, stat, mkdir, glob, watch } from 'fs/promises'
import { watch as watchSync } from 'fs'
import type { FSWatcher } from 'fs'
import { join, resolve, sep, relative, dirname } from 'path'
import { app } from 'electron'
import { is } from '@electron-toolkit/utils'
import log from '../logger'
import { gitRun } from '../git-run'
import { sanitizeGitRef } from '../path-security'
import { parseGitStatusFiles } from '../git-status-utils'
import { parseManifest } from './miniapp-schema'
import type { MiniAppEntry, MiniAppManifest, MiniAppFsOp, MiniAppFsWatchEvent, MiniAppGitOp, MiniAppFsAccess } from '../../shared/miniapp-types'
import { generateVanillaFiles, generateReactFiles, slugify, type GeneratedFile } from './miniapp-templates'

const userAppsDir = () => join(app.getPath('home'), '.superone', 'apps')
const devAppsDir = () => join(process.cwd(), 'examples', 'miniapp')

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

function resolveSafePathMulti(dirs: AllowedDir[], relativePath: string): { resolved: string; access: MiniAppFsAccess } {
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

export function setAllowedDirectories(appId: string, dirs: AllowedDir[]): void {
  allowedDirs.set(appId, dirs)
}

export function clearAllowedDirectories(appId: string): void {
  clearWatchersForApp(appId)
  stopGitHeadWatch(appId)
  allowedDirs.delete(appId)
}

async function scanDir(base: string): Promise<MiniAppEntry[]> {
  let dirs: string[]
  try {
    dirs = await readdir(base)
  } catch {
    return []
  }
  const results = await Promise.all(
    dirs.map(async (name) => {
      const basePath = join(base, name)
      const manifest = await readManifest(basePath)
      return manifest ? { id: manifest.appId, manifest, basePath } : null
    }),
  )
  return results.filter((e): e is MiniAppEntry => e !== null)
}

export async function discoverApps(): Promise<MiniAppEntry[]> {
  const entries = await scanDir(userAppsDir())
  if (is.dev) {
    const devEntries = await scanDir(devAppsDir())
    const existingIds = new Set(entries.map((e) => e.id))
    for (const entry of devEntries) {
      if (!existingIds.has(entry.id)) {
        entries.push(entry)
      }
    }
  }
  return entries
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

export type CreateMiniAppMode = 'project' | 'standalone'
export type CreateMiniAppTemplate = 'vanilla' | 'react'

export interface CreateMiniAppOptions {
  name: string
  projectDir: string
  mode?: CreateMiniAppMode
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
  return scanDir(getProjectAppsDir(projectDir))
}

export async function detectStandaloneApp(projectDir: string): Promise<MiniAppEntry | null> {
  const rootManifest = await readManifest(projectDir)
  if (rootManifest) return { id: rootManifest.appId, manifest: rootManifest, basePath: projectDir }

  const distDir = join(projectDir, 'dist')
  const distManifest = await readManifest(distDir)
  if (distManifest) return { id: distManifest.appId, manifest: distManifest, basePath: distDir }

  return null
}

async function writeGeneratedFiles(baseDir: string, files: GeneratedFile[]): Promise<void> {
  for (const file of files) {
    const filePath = join(baseDir, file.path)
    await mkdir(dirname(filePath), { recursive: true })
    await writeFile(filePath, file.content, 'utf-8')
  }
}

export async function createMiniApp(opts: CreateMiniAppOptions): Promise<CreateMiniAppResult> {
  const mode = opts.mode ?? 'project'
  const template = opts.template ?? 'vanilla'
  const appId = slugify(opts.name)

  const manifest: MiniAppManifest = {
    appId,
    name: opts.name,
    isDev: true,
    ...(opts.type && { type: opts.type }),
    ...(opts.description && { description: opts.description }),
  }

  const templateOpts = { name: opts.name, manifest }
  const appPath = mode === 'project'
    ? join(getProjectAppsDir(opts.projectDir), appId)
    : opts.projectDir
  const files = template === 'react'
    ? generateReactFiles(templateOpts)
    : generateVanillaFiles(templateOpts)
  const buildRequired = template === 'react'

  await writeGeneratedFiles(appPath, files)

  const basePath = template === 'react'
    ? join(appPath, 'dist')
    : appPath

  return {
    entry: { id: appId, manifest, basePath },
    appPath,
    buildRequired,
  }
}

const appBasePathCache = new Map<string, string>()

export function getAppBasePath(appId: string): string {
  const cached = appBasePathCache.get(appId)
  if (cached) return cached
  return join(userAppsDir(), appId)
}

export function cacheAppBasePath(appId: string, basePath: string): void {
  appBasePathCache.set(appId, basePath)
}

export function generateCSP(manifest: MiniAppManifest): string {
  const networkEntries = manifest.permissions?.network ?? []
  const domains = networkEntries.map((e) => e.domain.includes('://') ? e.domain : `https://${e.domain}`)
  const connectSrc = ["'self'", 'superone-app:', ...domains].join(' ')
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

export async function handleFsRequest(
  appId: string,
  op: MiniAppFsOp,
  args: Record<string, unknown>,
): Promise<unknown> {
  const dirs = allowedDirs.get(appId)
  if (!dirs?.length) throw new Error(`No allowed directories for app: ${appId}`)

  const WRITE_OPS: Set<MiniAppFsOp> = new Set(['writeFile'])

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
    case 'readDir': {
      const p = safe((args.path as string) || '.')
      const entries = await readdir(p, { withFileTypes: true })
      return entries.map((e) => ({ name: e.name, isDir: e.isDirectory() }))
    }
    case 'writeFile': {
      const p = safe(args.path as string)
      await mkdir(join(p, '..'), { recursive: true })
      await writeFile(p, args.content as string, 'utf-8')
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
      const raw = await gitRun(workingDir, [
        'log', '--format=%H%x00%P%x00%s%x00%an%x00%ai', `-${limit}`,
      ])
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
    default:
      throw new Error(`Unknown git operation: ${op}`)
  }
}
