import { readdir, readFile, writeFile, stat, mkdir, rm, rmdir } from 'fs/promises'
import { join, resolve, sep, relative, dirname, basename } from 'path'
import { app } from 'electron'
import log from '../logger'
import { parseManifest, parseDevLink } from './miniapp-schema'
import type { MiniAppEntry, MiniAppManifest, MiniAppMediaKind, DevAppInstallation, DevRegistryEntry } from '@superone/shared/miniapp-types'
import { generateVanillaFiles, generateReactFiles, type GeneratedFile } from './miniapp-templates'
import * as devRegistry from './dev-registry'

const DEV_LINK_FILE = '.s1-dev.json'

const userAppsDir = () => join(app.getPath('home'), '.superone', 'apps')

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
    main: 'node.js',
    isDev: true,
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
