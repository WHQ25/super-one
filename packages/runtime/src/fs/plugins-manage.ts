/**
 * Claude plugins + marketplace management — electron-free.
 * Behavioral parity with desktop `plugins-service` (provider=claude).
 */

import { execFile, execFileSync } from 'node:child_process'
import {
  cpSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  statSync,
  writeFileSync,
} from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { homedir as osHomedir } from 'node:os'
import type {
  MarketplacePlugin,
  MarketplacePluginDetail,
  MarketplaceScope,
  PluginDetail,
  PluginInfo,
  PluginManifest,
  ResourceScope,
  SkillFileEntry,
} from '@superone/shared/agent-types'
import { isPathAtOrWithinAllowed } from './path-security'

export interface PluginsManageOptions {
  /** Override home (tests / node isolation). Default: os.homedir(). */
  homeDir?: string
}

function homeOf(opts?: PluginsManageOptions): string {
  return opts?.homeDir ?? osHomedir()
}

function pluginsDir(opts?: PluginsManageOptions): string {
  return join(homeOf(opts), '.claude', 'plugins')
}

function installedFile(opts?: PluginsManageOptions): string {
  return join(pluginsDir(opts), 'installed_plugins.json')
}

function marketplacesFile(opts?: PluginsManageOptions): string {
  return join(pluginsDir(opts), 'known_marketplaces.json')
}

function installCountsFile(opts?: PluginsManageOptions): string {
  return join(pluginsDir(opts), 'install-counts-cache.json')
}

function getUserSettingsPath(opts?: PluginsManageOptions): string {
  return join(homeOf(opts), '.claude', 'settings.json')
}
function getProjectSettingsPath(cwd: string): string {
  return join(cwd, '.claude', 'settings.json')
}
function getLocalSettingsPath(cwd: string): string {
  return join(cwd, '.claude', 'settings.local.json')
}

function readJsonObject(filePath: string): Record<string, unknown> {
  if (!existsSync(filePath)) return {}
  try {
    const data = JSON.parse(readFileSync(filePath, 'utf-8'))
    return data && typeof data === 'object' && !Array.isArray(data) ? data : {}
  } catch {
    return {}
  }
}

function readExtraKnownMarketplaces(filePath: string): Record<string, unknown> {
  const data = readJsonObject(filePath)
  const ek = data.extraKnownMarketplaces
  if (!ek || typeof ek !== 'object' || Array.isArray(ek)) return {}
  return ek as Record<string, unknown>
}

function getMarketplaceScopeMap(cwd: string, opts?: PluginsManageOptions): Map<string, MarketplaceScope> {
  const map = new Map<string, MarketplaceScope>()
  for (const name of Object.keys(readExtraKnownMarketplaces(getUserSettingsPath(opts)))) {
    map.set(name, 'user')
  }
  if (cwd) {
    for (const name of Object.keys(readExtraKnownMarketplaces(getProjectSettingsPath(cwd)))) {
      map.set(name, 'project')
    }
    for (const name of Object.keys(readExtraKnownMarketplaces(getLocalSettingsPath(cwd)))) {
      map.set(name, 'local')
    }
  }
  return map
}

function writeSettingsJson(filePath: string, data: Record<string, unknown>): void {
  mkdirSync(dirname(filePath), { recursive: true })
  writeFileSync(filePath, JSON.stringify(data, null, 2) + '\n')
}

function removeMarketplaceFromSettings(filePath: string, name: string): boolean {
  if (!existsSync(filePath)) return false
  const data = readJsonObject(filePath)
  const ek = data.extraKnownMarketplaces
  if (!ek || typeof ek !== 'object' || Array.isArray(ek)) return false
  const map = ek as Record<string, unknown>
  if (!(name in map)) return false
  delete map[name]
  if (Object.keys(map).length === 0) {
    delete data.extraKnownMarketplaces
  }
  writeSettingsJson(filePath, data)
  return true
}

interface InstalledEntry {
  scope?: string
  installPath?: string
  version?: string
  projectPath?: string
  installedAt?: string
  lastUpdated?: string
  gitCommitSha?: string
}

interface MarketplaceManifestPlugin {
  name: string
  source?: string
  description?: string
  version?: string
  author?: { name?: string } | string
  skills?: string[]
}

interface MarketplaceManifest {
  plugins?: MarketplaceManifestPlugin[]
}

function readMarketplaceManifestPlugins(mpDir: string): MarketplaceManifestPlugin[] {
  const manifest = readJson<MarketplaceManifest>(join(mpDir, '.claude-plugin', 'marketplace.json'))
  return Array.isArray(manifest?.plugins)
    ? manifest!.plugins.filter((p) => p && typeof p.name === 'string')
    : []
}

function resolvePluginSourceDir(mpDir: string, name: string, source?: string): string {
  if (typeof source === 'string' && source.trim()) {
    const rel = source.replace(/^\.\/?/, '')
    const resolved = rel ? join(mpDir, rel) : mpDir
    if (existsSync(resolved)) return resolved
  }
  for (const subDir of ['plugins', 'external_plugins']) {
    const candidate = join(mpDir, subDir, name)
    if (existsSync(candidate)) return candidate
  }
  return mpDir
}

function manifestAuthorName(author: MarketplaceManifestPlugin['author']): string | undefined {
  if (!author) return undefined
  return typeof author === 'string' ? author : author.name
}

function marketplaceSourceLabel(mpInfo: {
  source?: { source: string; repo?: string; path?: string }
}): string | undefined {
  const s = mpInfo.source
  if (s?.source === 'github' && s.repo) return s.repo
  if (s?.source === 'directory' && s.path) return s.path
  return undefined
}

function resolveMarketplaceScope(
  mpName: string,
  mpInfo: { source?: { source: string } },
  scopeMap: Map<string, MarketplaceScope>,
): MarketplaceScope {
  const declared = scopeMap.get(mpName)
  if (declared) return declared
  if (mpInfo.source?.source === 'directory') return 'local'
  return 'official'
}

interface InstalledPluginsData {
  version?: number
  plugins: Record<string, InstalledEntry[]>
}

function readJson<T>(filePath: string): T | null {
  try {
    if (!existsSync(filePath)) return null
    return JSON.parse(readFileSync(filePath, 'utf-8')) as T
  } catch {
    return null
  }
}

function scanDir(dirPath: string): SkillFileEntry[] {
  try {
    return readdirSync(dirPath, { withFileTypes: true })
      .filter((e) => !e.name.startsWith('.'))
      .sort((a, b) => {
        const aDir =
          a.isDirectory() || (a.isSymbolicLink() && statSync(join(dirPath, a.name)).isDirectory())
        const bDir =
          b.isDirectory() || (b.isSymbolicLink() && statSync(join(dirPath, b.name)).isDirectory())
        if (aDir !== bDir) return aDir ? -1 : 1
        return a.name.localeCompare(b.name)
      })
      .map((e) => {
        const isDir =
          e.isDirectory() || (e.isSymbolicLink() && statSync(join(dirPath, e.name)).isDirectory())
        return {
          name: e.name,
          isDirectory: isDir,
          ...(isDir ? { children: scanDir(join(dirPath, e.name)) } : {}),
        }
      })
  } catch {
    return []
  }
}

function readPluginManifest(installPath: string): PluginManifest | null {
  return readJson<PluginManifest>(join(installPath, '.claude-plugin', 'plugin.json'))
}

function detectPluginContents(installPath: string): {
  hasCommands: boolean
  hasAgents: boolean
  hasSkills: boolean
  hasHooks: boolean
  hasMcpServers: boolean
} {
  return {
    hasCommands: existsSync(join(installPath, 'commands')),
    hasAgents: existsSync(join(installPath, 'agents')),
    hasSkills: existsSync(join(installPath, 'skills')),
    hasHooks: existsSync(join(installPath, 'hooks')),
    hasMcpServers: existsSync(join(installPath, '.mcp.json')),
  }
}

function readHookEvents(installPath: string): Record<string, unknown> {
  const candidates = [join(installPath, 'hooks', 'hooks.json'), join(installPath, 'hooks.json')]
  for (const p of candidates) {
    if (!existsSync(p)) continue
    try {
      const raw = JSON.parse(readFileSync(p, 'utf-8'))
      if (!raw || typeof raw !== 'object' || Array.isArray(raw)) continue
      const events = (raw as { hooks?: unknown }).hooks
      if (!events || typeof events !== 'object' || Array.isArray(events)) continue
      return events as Record<string, unknown>
    } catch {
      // continue
    }
  }
  return {}
}

function readMcpServersMap(installPath: string): Record<string, unknown> {
  const mcpPath = join(installPath, '.mcp.json')
  if (!existsSync(mcpPath)) return {}
  try {
    const raw = JSON.parse(readFileSync(mcpPath, 'utf-8'))
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {}
    const root = raw as Record<string, unknown>
    const wrapped = root.mcpServers
    if (wrapped && typeof wrapped === 'object' && !Array.isArray(wrapped)) {
      return wrapped as Record<string, unknown>
    }
    const out: Record<string, unknown> = {}
    for (const [k, v] of Object.entries(root)) {
      if (v && typeof v === 'object' && !Array.isArray(v)) out[k] = v
    }
    return out
  } catch {
    return {}
  }
}

function getMarketplaceLocations(opts?: PluginsManageOptions): Map<string, string> {
  const locations = new Map<string, string>()
  const marketplaces = readJson<Record<string, { installLocation?: string }>>(marketplacesFile(opts))
  if (!marketplaces) return locations
  for (const [name, info] of Object.entries(marketplaces)) {
    if (!info.installLocation || !existsSync(join(info.installLocation, '.git'))) continue
    locations.set(name, info.installLocation)
  }
  return locations
}

function getPluginLatestCommitSha(marketplaceDir: string, pluginName: string): string | null {
  const paths = [`plugins/${pluginName}`, `external_plugins/${pluginName}`]
  try {
    const hash = execFileSync('git', ['log', '--format=%H', '-1', '--', ...paths], {
      cwd: marketplaceDir,
      timeout: 5000,
      encoding: 'utf-8',
    }).trim()
    return hash || null
  } catch {
    return null
  }
}

function getPluginNewVersion(mpDir: string, pluginName: string): string | null {
  const mpManifest = readJson<MarketplaceManifest>(join(mpDir, '.claude-plugin', 'marketplace.json'))
  const mpEntry = mpManifest?.plugins?.find((p) => p.name === pluginName)
  if (mpEntry?.version) return mpEntry.version

  const sourceDir = findPluginSourceDir(mpDir, pluginName)
  if (sourceDir) {
    const pluginManifest = readJson<{ version?: string }>(
      join(sourceDir, '.claude-plugin', 'plugin.json'),
    )
    if (pluginManifest?.version) return pluginManifest.version
  }

  const sha = getPluginLatestCommitSha(mpDir, pluginName)
  return sha ? sha.slice(0, 12) : null
}

function normalizePluginVersion(version?: string): string | undefined {
  return version && version.toLowerCase() !== 'unknown' ? version : undefined
}

function findPluginSourceDir(mpDir: string, pluginName: string): string | null {
  const entry = readMarketplaceManifestPlugins(mpDir).find((p) => p.name === pluginName)
  if (entry && typeof entry.source === 'string' && entry.source.trim()) {
    const rel = entry.source.replace(/^\.\/?/, '')
    const resolved = rel ? join(mpDir, rel) : mpDir
    if (existsSync(resolved)) return resolved
  }
  for (const subDir of ['plugins', 'external_plugins']) {
    const candidate = join(mpDir, subDir, pluginName)
    if (existsSync(candidate)) return candidate
  }
  return null
}

export function listPlugins(cwd: string, opts?: PluginsManageOptions): PluginInfo[] {
  const data = readJson<InstalledPluginsData>(installedFile(opts))
  if (!data?.plugins) return []

  const mpLocations = getMarketplaceLocations(opts)
  const plugins: PluginInfo[] = []

  for (const [pluginKey, entries] of Object.entries(data.plugins)) {
    const [name, marketplace] = pluginKey.split('@')
    if (!name || !marketplace) continue

    for (const entry of entries) {
      if (!entry.installPath) continue
      const isProject =
        (entry.scope === 'project' || entry.scope === 'local') && entry.projectPath === cwd
      const isUser = entry.scope === 'user'
      if (!isUser && !isProject) continue

      const manifest = readPluginManifest(entry.installPath)
      const contents = detectPluginContents(entry.installPath)
      const mpDir = mpLocations.get(marketplace)
      const latestVersion = mpDir ? (getPluginNewVersion(mpDir, name) ?? undefined) : undefined
      const version = normalizePluginVersion(entry.version)
      const hasUpdate = !!(latestVersion && version && latestVersion !== version)

      plugins.push({
        name,
        marketplace,
        key: pluginKey,
        scope: isUser ? 'user' : 'project',
        description: manifest?.description ?? '',
        author: manifest?.author?.name,
        version,
        installPath: entry.installPath,
        installedAt: entry.installedAt,
        ...contents,
        latestVersion,
        hasUpdate,
      })
    }
  }

  return plugins
}

export function readPluginContent(
  cwd: string,
  key: string,
  opts?: PluginsManageOptions,
): PluginDetail | null {
  const data = readJson<InstalledPluginsData>(installedFile(opts))
  if (!data?.plugins?.[key]) return null

  const [name, marketplace] = key.split('@')
  if (!name || !marketplace) return null

  for (const entry of data.plugins[key]!) {
    if (!entry.installPath) continue
    const isProject =
      (entry.scope === 'project' || entry.scope === 'local') && entry.projectPath === cwd
    const isUser = entry.scope === 'user'
    if (!isUser && !isProject) continue

    const manifest = readPluginManifest(entry.installPath)
    const contents = detectPluginContents(entry.installPath)
    const mpLocations = getMarketplaceLocations(opts)
    const mpDir = mpLocations.get(marketplace)
    const latestVersion = mpDir ? (getPluginNewVersion(mpDir, name) ?? undefined) : undefined
    const version = normalizePluginVersion(entry.version)
    const hasUpdate = !!(latestVersion && version && latestVersion !== version)
    const mcpServerConfigs = readMcpServersMap(entry.installPath)
    const hookEvents = readHookEvents(entry.installPath)

    return {
      name,
      marketplace,
      key,
      scope: isUser ? 'user' : 'project',
      description: manifest?.description ?? '',
      author: manifest?.author?.name,
      version,
      installPath: entry.installPath,
      installedAt: entry.installedAt,
      ...contents,
      latestVersion,
      hasUpdate,
      mcpServers: Object.keys(mcpServerConfigs),
      mcpServerConfigs,
      hookEvents,
      files: scanDir(entry.installPath),
    }
  }

  return null
}

export function readPluginFile(
  cwd: string,
  pluginKey: string,
  relativePath: string,
  opts?: PluginsManageOptions,
): string | null {
  const data = readJson<InstalledPluginsData>(installedFile(opts))
  if (!data?.plugins?.[pluginKey]) return null

  for (const entry of data.plugins[pluginKey]!) {
    if (!entry.installPath) continue
    const isProject =
      (entry.scope === 'project' || entry.scope === 'local') && entry.projectPath === cwd
    const isUser = entry.scope === 'user'
    if (!isUser && !isProject) continue

    const resolved = resolve(entry.installPath, relativePath)
    if (!isPathAtOrWithinAllowed(resolved, [entry.installPath])) return null
    if (!existsSync(resolved) || statSync(resolved).isDirectory()) return null
    try {
      return readFileSync(resolved, 'utf-8')
    } catch {
      return null
    }
  }

  return null
}

export function deletePlugin(
  key: string,
  scope: ResourceScope,
  cwd: string,
  opts?: PluginsManageOptions,
): void {
  const data = readJson<InstalledPluginsData>(installedFile(opts))
  if (!data?.plugins?.[key]) return

  data.plugins[key] = data.plugins[key]!.filter((entry) => {
    if (scope === 'user') return entry.scope !== 'user'
    return !((entry.scope === 'project' || entry.scope === 'local') && entry.projectPath === cwd)
  })

  if (data.plugins[key]!.length === 0) {
    delete data.plugins[key]
  }

  writeFileSync(installedFile(opts), JSON.stringify(data, null, 2), 'utf-8')
}

interface MarketplaceEntry {
  source?: { source: string; repo?: string; path?: string }
  installLocation?: string
  lastUpdated?: string
}

export function listMarketplacePlugins(
  cwd: string,
  opts?: PluginsManageOptions,
): MarketplacePlugin[] {
  const marketplaces = readJson<Record<string, MarketplaceEntry>>(marketplacesFile(opts))
  if (!marketplaces || typeof marketplaces !== 'object') return []

  const scopeMap = getMarketplaceScopeMap(cwd, opts)

  const countsData = readJson<{ counts?: Array<{ plugin: string; unique_installs: number }> }>(
    installCountsFile(opts),
  )
  const countMap = new Map<string, number>()
  if (countsData?.counts) {
    for (const c of countsData.counts) {
      countMap.set(c.plugin, c.unique_installs)
    }
  }

  const installed = readJson<InstalledPluginsData>(installedFile(opts))
  const installedMap = new Map<string, ResourceScope>()
  if (installed?.plugins) {
    for (const [key, entries] of Object.entries(installed.plugins)) {
      for (const entry of entries) {
        const isProject =
          (entry.scope === 'project' || entry.scope === 'local') && entry.projectPath === cwd
        const isUser = entry.scope === 'user'
        if (isUser || isProject) {
          installedMap.set(key, isUser ? 'user' : 'project')
          break
        }
      }
    }
  }

  const plugins: MarketplacePlugin[] = []

  for (const [mpName, mpInfo] of Object.entries(marketplaces)) {
    const mpDir = mpInfo.installLocation
    if (!mpDir || !existsSync(mpDir)) continue

    const marketplaceSource = marketplaceSourceLabel(mpInfo)

    const pushPlugin = (
      name: string,
      sourceDir: string,
      manifestEntry?: MarketplaceManifestPlugin,
    ): void => {
      const ownManifest = readPluginManifest(sourceDir)
      const key = `${name}@${mpName}`
      const contents = detectPluginContents(sourceDir)
      if (manifestEntry?.skills?.length) contents.hasSkills = true
      plugins.push({
        name,
        marketplace: mpName,
        key,
        description: manifestEntry?.description ?? ownManifest?.description ?? '',
        author: ownManifest?.author?.name ?? manifestAuthorName(manifestEntry?.author),
        version: manifestEntry?.version ?? ownManifest?.version,
        installCount: countMap.get(key),
        installed: installedMap.has(key),
        installedScope: installedMap.get(key),
        marketplaceLastUpdated: mpInfo.lastUpdated,
        marketplaceSource,
        marketplaceScope: resolveMarketplaceScope(mpName, mpInfo, scopeMap),
        ...contents,
      })
    }

    const manifestPlugins = readMarketplaceManifestPlugins(mpDir)
    if (manifestPlugins.length > 0) {
      for (const mp of manifestPlugins) {
        pushPlugin(mp.name, resolvePluginSourceDir(mpDir, mp.name, mp.source), mp)
      }
      continue
    }

    for (const subDir of ['plugins', 'external_plugins']) {
      const pluginsDirPath = join(mpDir, subDir)
      if (!existsSync(pluginsDirPath)) continue
      try {
        for (const entry of readdirSync(pluginsDirPath, { withFileTypes: true })) {
          if (!entry.isDirectory() && !entry.isSymbolicLink()) continue
          const pluginDir = join(pluginsDirPath, entry.name)
          if (!readPluginManifest(pluginDir)) continue
          pushPlugin(entry.name, pluginDir)
        }
      } catch {
        // ignore
      }
    }
  }

  plugins.sort((a, b) => (b.installCount ?? 0) - (a.installCount ?? 0))
  return plugins
}

export function updateMarketplace(marketplaceName: string): Promise<void> {
  return new Promise((resolvePromise, reject) => {
    execFile(
      'claude',
      ['plugin', 'marketplace', 'update', marketplaceName],
      { timeout: 60000 },
      (error, _stdout, stderr) => {
        if (error) {
          reject(new Error(stderr?.trim() || `Failed to update marketplace: ${error.message}`))
        } else {
          resolvePromise()
        }
      },
    )
  })
}

export function installPlugin(
  pluginKey: string,
  scope: ResourceScope,
  cwd: string,
): Promise<void> {
  return new Promise((resolvePromise, reject) => {
    const args = ['plugin', 'install', pluginKey, '--scope', scope]
    if (scope === 'project') {
      args.push('--project-path', cwd)
    }
    execFile('claude', args, { timeout: 30000 }, (error) => {
      if (error) {
        reject(new Error(`Failed to install plugin: ${error.message}`))
      } else {
        resolvePromise()
      }
    })
  })
}

export function updatePlugin(
  key: string,
  scope: ResourceScope,
  cwd: string,
  opts?: PluginsManageOptions,
): void {
  const data = readJson<InstalledPluginsData>(installedFile(opts))
  if (!data?.plugins?.[key]) return

  const [name, marketplace] = key.split('@')
  if (!name || !marketplace) return

  const mpLocations = getMarketplaceLocations(opts)
  const mpDir = mpLocations.get(marketplace)
  if (!mpDir) return

  const sourceDir = findPluginSourceDir(mpDir, name)
  if (!sourceDir) return

  const newVersion = getPluginNewVersion(mpDir, name)
  if (!newVersion) return

  const cacheDir = join(pluginsDir(opts), 'cache', marketplace, name, newVersion)
  if (!existsSync(cacheDir)) {
    mkdirSync(cacheDir, { recursive: true })
    cpSync(sourceDir, cacheDir, { recursive: true })
  }

  const latestSha = getPluginLatestCommitSha(mpDir, name)

  for (const entry of data.plugins[key]!) {
    const isMatch =
      scope === 'user'
        ? entry.scope === 'user'
        : (entry.scope === 'project' || entry.scope === 'local') && entry.projectPath === cwd
    if (!isMatch) continue

    entry.installPath = cacheDir
    entry.version = newVersion
    entry.lastUpdated = new Date().toISOString()
    if (latestSha) entry.gitCommitSha = latestSha
  }

  writeFileSync(installedFile(opts), JSON.stringify(data, null, 2), 'utf-8')
}

export function addMarketplace(
  source: string,
  scope: ResourceScope,
  cwd: string,
): Promise<void> {
  return new Promise((resolvePromise, reject) => {
    const args = ['plugin', 'marketplace', 'add', source, '--scope', scope]
    execFile('claude', args, { timeout: 60000, cwd }, (error, _stdout, stderr) => {
      if (error) {
        reject(new Error(stderr?.trim() || `Failed to add marketplace: ${error.message}`))
      } else {
        resolvePromise()
      }
    })
  })
}

export function removeMarketplace(
  name: string,
  scope: MarketplaceScope,
  cwd: string,
  opts?: PluginsManageOptions,
): Promise<void> {
  if (scope === 'official') {
    return Promise.reject(new Error('Cannot remove the built-in official marketplace'))
  }

  const settingsPath =
    scope === 'user'
      ? getUserSettingsPath(opts)
      : scope === 'project'
        ? getProjectSettingsPath(cwd)
        : getLocalSettingsPath(cwd)

  removeMarketplaceFromSettings(settingsPath, name)

  const stillDeclared = getMarketplaceScopeMap(cwd, opts).has(name)
  if (stillDeclared) {
    return Promise.resolve()
  }

  return new Promise((resolvePromise, reject) => {
    execFile(
      'claude',
      ['plugin', 'marketplace', 'remove', name],
      { timeout: 30000 },
      (error, _stdout, stderr) => {
        if (error) {
          const msg = stderr?.trim() || error.message
          reject(new Error(`Marketplace removed from settings, but cache cleanup failed: ${msg}`))
        } else {
          resolvePromise()
        }
      },
    )
  })
}

export function readMarketplacePluginContent(
  marketplace: string,
  name: string,
  opts?: PluginsManageOptions,
): MarketplacePluginDetail | null {
  const marketplaces = readJson<Record<string, MarketplaceEntry>>(marketplacesFile(opts))
  const mpInfo = marketplaces?.[marketplace]
  if (!mpInfo?.installLocation || !existsSync(mpInfo.installLocation)) return null

  const sourceDir = findPluginSourceDir(mpInfo.installLocation, name)
  if (!sourceDir) return null

  const manifest = readPluginManifest(sourceDir)
  const manifestEntry = readMarketplaceManifestPlugins(mpInfo.installLocation).find(
    (p) => p.name === name,
  )
  if (!manifest && !manifestEntry) return null

  const contents = detectPluginContents(sourceDir)
  if (manifestEntry?.skills?.length) contents.hasSkills = true

  const installed = readJson<InstalledPluginsData>(installedFile(opts))
  const key = `${name}@${marketplace}`
  let installedFlag = false
  let installedScope: ResourceScope | undefined
  if (installed?.plugins?.[key]) {
    for (const entry of installed.plugins[key]!) {
      if (entry.scope === 'user') {
        installedFlag = true
        installedScope = 'user'
        break
      }
      if (entry.scope === 'project' || entry.scope === 'local') {
        installedFlag = true
        installedScope = 'project'
      }
    }
  }

  const countsData = readJson<{ counts?: Array<{ plugin: string; unique_installs: number }> }>(
    installCountsFile(opts),
  )
  const installCount = countsData?.counts?.find((c) => c.plugin === key)?.unique_installs
  const mcpServerConfigs = readMcpServersMap(sourceDir)
  const hookEvents = readHookEvents(sourceDir)

  return {
    name,
    marketplace,
    key,
    description: manifestEntry?.description ?? manifest?.description ?? '',
    author: manifest?.author?.name ?? manifestAuthorName(manifestEntry?.author),
    version: manifestEntry?.version ?? manifest?.version,
    installCount,
    installed: installedFlag,
    installedScope,
    marketplaceLastUpdated: mpInfo.lastUpdated,
    marketplaceSource: marketplaceSourceLabel(mpInfo),
    marketplaceScope: resolveMarketplaceScope(marketplace, mpInfo, getMarketplaceScopeMap('', opts)),
    ...contents,
    sourcePath: sourceDir,
    files: scanDir(sourceDir),
    mcpServers: Object.keys(mcpServerConfigs),
    mcpServerConfigs,
    hookEvents,
  }
}

export function readMarketplacePluginFile(
  marketplace: string,
  name: string,
  relativePath: string,
  opts?: PluginsManageOptions,
): string | null {
  const marketplaces = readJson<Record<string, MarketplaceEntry>>(marketplacesFile(opts))
  const mpInfo = marketplaces?.[marketplace]
  if (!mpInfo?.installLocation || !existsSync(mpInfo.installLocation)) return null

  const sourceDir = findPluginSourceDir(mpInfo.installLocation, name)
  if (!sourceDir) return null

  const resolved = resolve(sourceDir, relativePath)
  if (!isPathAtOrWithinAllowed(resolved, [sourceDir])) return null
  if (!existsSync(resolved) || statSync(resolved).isDirectory()) return null
  try {
    return readFileSync(resolved, 'utf-8')
  } catch {
    return null
  }
}
