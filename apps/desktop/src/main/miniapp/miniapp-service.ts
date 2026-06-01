import { readdir, readFile, writeFile, stat, mkdir, glob, watch, rm, rename, rmdir } from 'fs/promises'
import { watch as watchSync } from 'fs'
import type { FSWatcher } from 'fs'
import { join, resolve, sep, relative, dirname, basename } from 'path'
import { app, shell } from 'electron'
import log from '../logger'
import { gitRun } from '../git-run'
import { sanitizeGitRef } from '../path-security'
import { parseGitStatusFiles } from '../git-status-utils'
import { parseManifest, parseDevLink } from './miniapp-schema'
import type { MiniAppEntry, MiniAppManifest, MiniAppFsOp, MiniAppFsWatchEvent, MiniAppGitOp, MiniAppFsAccess, MiniAppMediaKind, DevAppInstallation, DevRegistryEntry } from '@superone/shared/miniapp-types'
import { generateVanillaFiles, generateReactFiles, type GeneratedFile } from './miniapp-templates'
import { closeDbForApp } from './miniapp-db'
import * as devRegistry from './dev-registry'

const DEV_LINK_FILE = '.s1-dev.json'

const userAppsDir = () => join(app.getPath('home'), '.superone', 'apps')

export interface AllowedDir {
  path: string
  access: MiniAppFsAccess
  root?: string
}

function appKey(projectDir: string, appId: string): string {
  return `${projectDir}::${appId}`
}

const allowedDirs = new Map<string, AllowedDir[]>()

let watchIdCounter = 0
const activeWatchers = new Map<number, { projectDir: string; appId: string; controller: AbortController }>()

type WatchEventCallback = (event: MiniAppFsWatchEvent) => void
let watchEventCallback: WatchEventCallback | null = null

export function onFsWatchEvent(cb: WatchEventCallback): void {
  watchEventCallback = cb
}

export function startWatch(projectDir: string, appId: string, watchPath: string): number {
  const dirs = allowedDirs.get(appKey(projectDir, appId))
  if (!dirs?.length) throw new Error(`No allowed directories for app: ${appId}`)

  const { resolved } = resolveSafePathMulti(dirs, watchPath)

  const watchId = ++watchIdCounter
  const controller = new AbortController()
  activeWatchers.set(watchId, { projectDir, appId, controller })

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

function clearWatchersForApp(projectDir: string, appId: string): void {
  for (const [id, entry] of activeWatchers) {
    if (entry.projectDir === projectDir && entry.appId === appId) {
      entry.controller.abort()
      activeWatchers.delete(id)
    }
  }
}

const superoneSeg = `${sep}.superone${sep}`

function isWithin(base: string, target: string): boolean {
  const normalizedBase = base.endsWith(sep) ? base : base + sep
  return target === base || target.startsWith(normalizedBase)
}

function guardSuperone(resolved: string, dirPath: string): void {
  if (resolved.includes(superoneSeg) && !dirPath.includes(superoneSeg)) {
    throw new Error('Access denied: .superone is a protected directory')
  }
}

export function resolveSafePathMulti(
  dirs: AllowedDir[],
  relativePath: string,
  op: 'read' | 'write' = 'read',
): { resolved: string; access: MiniAppFsAccess } {
  // Single scope keeps acting as the base for relative paths (legacy shortcut):
  // a lone `asset` rw scope resolves `images/x` to `<asset>/images/x`.
  if (dirs.length === 1) {
    const dir = dirs[0]
    const resolved = resolve(dir.path, relativePath)
    if (!isWithin(dir.path, resolved)) {
      throw new Error(`Path not within allowed directories: ${relativePath}`)
    }
    guardSuperone(resolved, dir.path)
    if (op === 'write' && dir.access === 'read') {
      throw new Error(`Write access denied: ${relativePath} (read-only permission)`)
    }
    return { resolved, access: dir.access }
  }

  // Multi scope: resolve the path ONCE per declared root (project scopes share the
  // project root), then select among the scopes that contain that single absolute
  // path by specificity (longest dir.path); for writes prefer a readwrite scope.
  const roots = [...new Set(dirs.map((d) => d.root ?? d.path))]
  const matches: { resolved: string; dir: AllowedDir }[] = []
  for (const root of roots) {
    const resolved = resolve(root, relativePath)
    if (!isWithin(root, resolved)) continue
    for (const dir of dirs) {
      if (isWithin(dir.path, resolved)) matches.push({ resolved, dir })
    }
  }
  if (matches.length === 0) {
    throw new Error(`Path not within allowed directories: ${relativePath}`)
  }
  matches.sort((a, b) => b.dir.path.length - a.dir.path.length)
  const chosen = op === 'write'
    ? (matches.find((m) => m.dir.access === 'readwrite') ?? matches[0])
    : matches[0]
  guardSuperone(chosen.resolved, chosen.dir.path)
  if (op === 'write' && chosen.dir.access !== 'readwrite') {
    throw new Error(`Write access denied: ${relativePath} (read-only permission)`)
  }
  return { resolved: chosen.resolved, access: chosen.dir.access }
}

type GitHeadChangeCallback = (event: { projectDir: string; appId: string }) => void
let gitHeadChangeCallback: GitHeadChangeCallback | null = null
const gitHeadWatchers = new Map<string, FSWatcher>()

export function onGitHeadChangeEvent(cb: GitHeadChangeCallback): void {
  gitHeadChangeCallback = cb
}

function startGitHeadWatch(projectDir: string, appId: string, workingDir: string): void {
  const k = appKey(projectDir, appId)
  if (gitHeadWatchers.has(k)) return
  const headPath = join(workingDir, '.git', 'HEAD')
  let timer: ReturnType<typeof setTimeout> | null = null
  try {
    const watcher = watchSync(headPath, () => {
      if (timer) clearTimeout(timer)
      timer = setTimeout(() => gitHeadChangeCallback?.({ projectDir, appId }), 100)
    })
    watcher.on('error', () => {
      watcher.close()
      gitHeadWatchers.delete(k)
    })
    gitHeadWatchers.set(k, watcher)
  } catch { /* not a git repo */ }
}

function stopGitHeadWatch(projectDir: string, appId: string): void {
  const k = appKey(projectDir, appId)
  const watcher = gitHeadWatchers.get(k)
  if (watcher) {
    watcher.close()
    gitHeadWatchers.delete(k)
  }
}

export function getAllowedDirs(projectDir: string, appId: string): AllowedDir[] | undefined {
  return allowedDirs.get(appKey(projectDir, appId))
}

export function setAllowedDirectories(projectDir: string, appId: string, dirs: AllowedDir[]): void {
  allowedDirs.set(appKey(projectDir, appId), dirs)
}

export function clearAllowedDirectories(projectDir: string, appId: string): void {
  clearWatchersForApp(projectDir, appId)
  stopGitHeadWatch(projectDir, appId)
  allowedDirs.delete(appKey(projectDir, appId))
  let stillOpenSomewhere = false
  for (const otherKey of allowedDirs.keys()) {
    if (otherKey.endsWith(`::${appId}`)) {
      stillOpenSomewhere = true
      break
    }
  }
  if (!stillOpenSomewhere) closeDbForApp(appId)
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
    if (!u.hostname) return null
    const dot = u.hostname.indexOf('.')
    const appId = dot < 0 ? u.hostname : u.hostname.slice(0, dot)
    return appId.toLowerCase()
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

export async function resolveAppEntry(installDir: string, _opts: ResolveAppEntryOpts): Promise<MiniAppEntry | null> {
  const devLink = await readDevLink(installDir)
  if (devLink) {
    if (!devLink.enabled) {
      const prodManifest = await readManifest(installDir)
      if (!prodManifest) return null
      return { id: prodManifest.appId, manifest: prodManifest, installDir }
    }
    const appId = basename(installDir)
    const reg = await devRegistry.lookupByAppId(appId)
    if (!reg) {
      log.warn('[miniapp] dev pointer at %s has no matching dev-registry entry for appId=%s', installDir, appId)
      return { id: appId, manifest: { appId, name: appId, isDev: true } as MiniAppManifest, installDir, orphan: true }
    }
    const manifest = await readManifest(reg.distDir)
    if (!manifest) {
      log.warn('[miniapp] dev-registry %s points to %s but no manifest found', appId, reg.distDir)
      return { id: appId, manifest: { appId, name: reg.name, isDev: true } as MiniAppManifest, installDir, orphan: true }
    }
    return { id: appId, manifest, installDir, distDir: reg.distDir }
  }
  const manifest = await readManifest(installDir)
  if (!manifest) return null
  return { id: manifest.appId, manifest, installDir }
}

async function readDevLink(installDir: string): Promise<{ enabled: boolean } | null> {
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
  fullscreen?: boolean
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
    ...(opts.fullscreen && { fullscreen: true }),
    ...(opts.description && { description: opts.description }),
  }

  const templateOpts = { name: opts.name, manifest }
  const files = template === 'react'
    ? generateReactFiles(templateOpts)
    : generateVanillaFiles(templateOpts)
  const buildRequired = template === 'react'

  await writeGeneratedFiles(directory, files)

  const distAbs = template === 'react' ? join(directory, 'dist') : directory

  await devRegistry.upsertEntry({
    appId,
    sourceDir: directory,
    distDir: distAbs,
    name: opts.name,
  })

  const installDir = await writeDevPointer({
    appId,
    scope,
    projectDir: opts.projectDir,
  })

  return {
    entry: { id: appId, manifest, installDir, distDir: distAbs },
    appPath: directory,
    buildRequired,
  }
}

export interface WriteDevPointerOpts {
  appId: string
  scope: CreateMiniAppScope
  projectDir?: string
  enabled?: boolean
}

export function getDevPointerInstallDir(appId: string, scope: CreateMiniAppScope, projectDir?: string): string {
  const root = scope === 'project' ? getProjectAppsDir(requireProjectDir(scope, projectDir)) : userAppsDir()
  return join(root, appId)
}

function requireProjectDir(scope: CreateMiniAppScope, projectDir?: string): string {
  if (scope === 'project' && !projectDir) {
    throw new Error('scope="project" requires projectDir')
  }
  return projectDir!
}

export async function writeDevPointer(opts: WriteDevPointerOpts): Promise<string> {
  const installDir = getDevPointerInstallDir(opts.appId, opts.scope, opts.projectDir)
  await mkdir(installDir, { recursive: true })
  const devLink = { enabled: opts.enabled ?? true }
  await writeFile(join(installDir, DEV_LINK_FILE), JSON.stringify(devLink, null, 2), 'utf-8')
  return installDir
}

/**
 * Detect what kind of content (if any) lives in `installDir` so install can refuse to clobber
 * a real prod install. A dev pointer dir contains only `.s1-dev.json` (and possibly nothing
 * else); a prod install dir contains `manifest.json` and assets.
 */
export async function classifyInstallDir(installDir: string): Promise<'empty' | 'dev-pointer' | 'prod-install'> {
  let entries: string[]
  try {
    entries = await readdir(installDir)
  } catch {
    return 'empty'
  }
  const meaningful = entries.filter((e) => e !== '.DS_Store')
  if (meaningful.length === 0) return 'empty'
  if (meaningful.includes('manifest.json')) return 'prod-install'
  if (meaningful.length === 1 && meaningful[0] === DEV_LINK_FILE) return 'dev-pointer'
  // Anything else (e.g. dev-pointer + data/) is also treated as dev-pointer if .s1-dev.json present
  if (meaningful.includes(DEV_LINK_FILE)) return 'dev-pointer'
  return 'prod-install'
}

export interface InstallDevPointerOpts {
  appId: string
  scope: CreateMiniAppScope
  projectDir?: string
  force?: boolean
}

export async function installDevPointer(opts: InstallDevPointerOpts): Promise<string> {
  requireProjectDir(opts.scope, opts.projectDir)
  const reg = await devRegistry.lookupByAppId(opts.appId)
  if (!reg) throw new Error(`dev-registry has no entry for appId=${opts.appId}; register it first`)
  const installDir = getDevPointerInstallDir(opts.appId, opts.scope, opts.projectDir)
  const kind = await classifyInstallDir(installDir)
  if (kind === 'prod-install' && !opts.force) {
    throw new Error(`refusing to overwrite prod install at ${installDir}; uninstall it first or pass force=true`)
  }
  return writeDevPointer({ appId: opts.appId, scope: opts.scope, projectDir: opts.projectDir })
}

export interface RemoveDevPointerOpts {
  appId: string
  scope: CreateMiniAppScope
  projectDir?: string
}

export async function removeDevPointer(opts: RemoveDevPointerOpts): Promise<void> {
  const installDir = getDevPointerInstallDir(opts.appId, opts.scope, opts.projectDir)
  const kind = await classifyInstallDir(installDir)
  if (kind !== 'dev-pointer') return
  await rm(join(installDir, DEV_LINK_FILE), { force: true })
  try {
    await rmdir(installDir)
  } catch {
    // Directory not empty (e.g. data/ subdir) — leave it.
  }
}

export async function setDevPointerEnabled(opts: RemoveDevPointerOpts & { enabled: boolean }): Promise<void> {
  const installDir = getDevPointerInstallDir(opts.appId, opts.scope, opts.projectDir)
  const kind = await classifyInstallDir(installDir)
  if (kind !== 'dev-pointer') {
    throw new Error(`no dev pointer at ${installDir}`)
  }
  const devLink = { enabled: opts.enabled }
  await writeFile(join(installDir, DEV_LINK_FILE), JSON.stringify(devLink, null, 2), 'utf-8')
}

async function listInstallationsInScopeRoot(
  scopeRoot: string,
  scope: CreateMiniAppScope,
  projectDir: string | undefined,
): Promise<DevAppInstallation[]> {
  let names: string[]
  try {
    names = await readdir(scopeRoot)
  } catch {
    return []
  }
  const out: DevAppInstallation[] = []
  for (const appId of names) {
    const installDir = join(scopeRoot, appId)
    const devLink = await readDevLink(installDir)
    if (!devLink) continue
    out.push({
      scope,
      installDir,
      enabled: devLink.enabled,
      ...(scope === 'project' && projectDir ? { projectDir } : {}),
    })
  }
  return out
}

/**
 * Reverse-scan `~/.superone/apps` and every known project's `<proj>/.superone/apps` for
 * `.s1-dev.json` files. Returns installations grouped by appId.
 */
export async function listAllInstallations(knownProjects: string[]): Promise<Map<string, DevAppInstallation[]>> {
  const grouped = new Map<string, DevAppInstallation[]>()
  const add = (appId: string, inst: DevAppInstallation) => {
    const arr = grouped.get(appId) ?? []
    arr.push(inst)
    grouped.set(appId, arr)
  }
  const userInstalls = await listInstallationsInScopeRoot(userAppsDir(), 'user', undefined)
  for (const inst of userInstalls) {
    const appId = basename(inst.installDir)
    add(appId, inst)
  }
  for (const projectDir of knownProjects) {
    const projectInstalls = await listInstallationsInScopeRoot(getProjectAppsDir(projectDir), 'project', projectDir)
    for (const inst of projectInstalls) {
      const appId = basename(inst.installDir)
      add(appId, inst)
    }
  }
  return grouped
}

export interface DevRegistryViewWithStatus extends DevRegistryEntry {
  status: 'ok' | 'missing'
  installations: DevAppInstallation[]
}

export async function listDevRegistryView(knownProjects: string[]): Promise<DevRegistryViewWithStatus[]> {
  const entries = await devRegistry.listEntries()
  const installs = await listAllInstallations(knownProjects)
  const out: DevRegistryViewWithStatus[] = []
  for (const entry of entries) {
    const exists = await devRegistry.sourceDirExists(entry.sourceDir)
    out.push({
      ...entry,
      status: exists ? 'ok' : 'missing',
      installations: installs.get(entry.appId) ?? [],
    })
  }
  return out
}

export interface RegisterDevMiniAppInput {
  directory: string
  name?: string
}

/**
 * Register an existing mini-app source directory in the global dev-registry without
 * scaffolding anything. The directory must contain a manifest.json at the root or under dist/.
 * Returns the registry entry (idempotent — re-registering the same directory upserts).
 */
export async function registerDevMiniApp(input: RegisterDevMiniAppInput): Promise<DevRegistryEntry> {
  if (!input.directory.startsWith('/')) {
    throw new Error(`directory must be an absolute path, got: ${input.directory}`)
  }
  const detected = await detectStandaloneApp(input.directory)
  if (!detected) {
    throw new Error(`no manifest.json found at ${input.directory} or ${join(input.directory, 'dist')}`)
  }
  const distDir = detected.distDir ?? detected.installDir
  return devRegistry.upsertEntry({
    appId: detected.manifest.appId,
    sourceDir: input.directory,
    distDir,
    name: input.name ?? detected.manifest.name,
  })
}

export async function unregisterDevMiniApp(appId: string, cascade: boolean, knownProjects: string[]): Promise<void> {
  if (cascade) {
    const installs = await listAllInstallations(knownProjects)
    const arr = installs.get(appId) ?? []
    for (const inst of arr) {
      await removeDevPointer({ appId, scope: inst.scope, projectDir: inst.projectDir })
    }
  }
  await devRegistry.removeEntry(appId)
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

export function getUserAppDir(appId: string): string {
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
    `frame-src ${["'self'", ...domains].join(' ')}`,
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
  projectDir: string,
  appId: string,
  op: MiniAppFsOp,
  args: Record<string, unknown>,
): Promise<unknown> {
  const dirs = allowedDirs.get(appKey(projectDir, appId))
  if (!dirs?.length) throw new Error(`No allowed directories for app: ${appId}`)

  const safe = (p: string) =>
    resolveSafePathMulti(dirs, p, WRITE_OPS.has(op) ? 'write' : 'read').resolved

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
      const flag = args.append === true ? 'a' : 'w'
      if (content instanceof ArrayBuffer || content instanceof Uint8Array || Buffer.isBuffer(content)) {
        await writeFile(p, Buffer.from(content as ArrayBuffer), { flag })
      } else {
        await writeFile(p, content as string, { encoding: 'utf-8', flag })
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

export function getGitDirectory(projectDir: string, appId: string): string | undefined {
  const dirs = allowedDirs.get(appKey(projectDir, appId))
  return dirs?.[0]?.path
}

export async function handleGitRequest(
  projectDir: string,
  appId: string,
  op: MiniAppGitOp,
  args: Record<string, unknown>,
): Promise<unknown> {
  const workingDir = getGitDirectory(projectDir, appId)
  if (!workingDir) throw new Error(`No allowed directories for app: ${appId}`)

  startGitHeadWatch(projectDir, appId, workingDir)

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

