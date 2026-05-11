import { join, resolve, dirname } from 'path'
import { homedir } from 'os'
import { cpSync, existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from 'fs'
import { execFile, execFileSync } from 'child_process'
import type {
  ResourceScope,
  MarketplaceScope,
  PluginInfo,
  PluginDetail,
  PluginManifest,
  MarketplacePlugin,
  MarketplacePluginDetail,
  SkillFileEntry,
} from '@superone/shared/agent-types'

const PLUGINS_DIR = join(homedir(), '.claude', 'plugins')
const INSTALLED_FILE = join(PLUGINS_DIR, 'installed_plugins.json')
const MARKETPLACES_FILE = join(PLUGINS_DIR, 'known_marketplaces.json')
const INSTALL_COUNTS_FILE = join(PLUGINS_DIR, 'install-counts-cache.json')

function getUserSettingsPath(): string {
  return join(homedir(), '.claude', 'settings.json')
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

/**
 * Build a map of marketplace name → scope based on settings.json declarations.
 * Precedence: local > project > user (more specific scope wins).
 * Marketplaces present in known_marketplaces.json but not in any settings.json
 * are treated as built-in (e.g. claude-plugins-official).
 */
function getMarketplaceScopeMap(cwd: string): Map<string, MarketplaceScope> {
  const map = new Map<string, MarketplaceScope>()
  for (const name of Object.keys(readExtraKnownMarketplaces(getUserSettingsPath()))) {
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

interface MarketplaceManifest {
  plugins?: Array<{ name: string; version?: string }>
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
      .filter(e => !e.name.startsWith('.'))
      .sort((a, b) => {
        const aDir = a.isDirectory() || a.isSymbolicLink() && statSync(join(dirPath, a.name)).isDirectory()
        const bDir = b.isDirectory() || b.isSymbolicLink() && statSync(join(dirPath, b.name)).isDirectory()
        if (aDir !== bDir) return aDir ? -1 : 1
        return a.name.localeCompare(b.name)
      })
      .map(e => {
        const isDir = e.isDirectory() || (e.isSymbolicLink() && statSync(join(dirPath, e.name)).isDirectory())
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
  const manifestPath = join(installPath, '.claude-plugin', 'plugin.json')
  return readJson<PluginManifest>(manifestPath)
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

/**
 * Parse a plugin's hooks file and return the event → handlers map.
 * Looks at `<plugin>/hooks/hooks.json` first, then root `hooks.json`.
 * Returns a record keyed by event name (PreToolUse, Stop, SessionStart, …).
 */
function readHookEvents(installPath: string): Record<string, unknown> {
  const candidates = [
    join(installPath, 'hooks', 'hooks.json'),
    join(installPath, 'hooks.json'),
  ]
  for (const p of candidates) {
    if (!existsSync(p)) continue
    try {
      const raw = JSON.parse(readFileSync(p, 'utf-8'))
      if (!raw || typeof raw !== 'object' || Array.isArray(raw)) continue
      const events = (raw as { hooks?: unknown }).hooks
      if (!events || typeof events !== 'object' || Array.isArray(events)) continue
      return events as Record<string, unknown>
    } catch {
      // continue to next candidate
    }
  }
  return {}
}

/**
 * Parse a plugin's `.mcp.json` and return the configured server map.
 * Supports both formats seen in practice:
 *   1. `{ "mcpServers": { "name": { command, args } } }` (wrapper form)
 *   2. `{ "name": { command, args } }`                   (flat form — most plugins)
 */
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

/** Build a map of marketplace name → installLocation for git repos */
function getMarketplaceLocations(): Map<string, string> {
  const locations = new Map<string, string>()
  const marketplaces = readJson<Record<string, { installLocation?: string }>>(MARKETPLACES_FILE)
  if (!marketplaces) return locations

  for (const [name, info] of Object.entries(marketplaces)) {
    if (!info.installLocation || !existsSync(join(info.installLocation, '.git'))) continue
    locations.set(name, info.installLocation)
  }
  return locations
}

/** Get the latest commit (full SHA) that touched a specific plugin directory */
function getPluginLatestCommitSha(marketplaceDir: string, pluginName: string): string | null {
  const paths = [`plugins/${pluginName}`, `external_plugins/${pluginName}`]
  try {
    const hash = execFileSync(
      'git', ['log', '--format=%H', '-1', '--', ...paths],
      { cwd: marketplaceDir, timeout: 5000, encoding: 'utf-8' },
    ).trim()
    return hash || null
  } catch {
    return null
  }
}

/**
 * Determine what version string a fresh install would produce.
 * Priority: marketplace.json version → plugin.json version → git commit hash
 */
function getPluginNewVersion(mpDir: string, pluginName: string): string | null {
  // 1. marketplace.json version (marketplace-level override)
  const mpManifest = readJson<MarketplaceManifest>(join(mpDir, '.claude-plugin', 'marketplace.json'))
  const mpEntry = mpManifest?.plugins?.find(p => p.name === pluginName)
  if (mpEntry?.version) return mpEntry.version

  // 2. plugin's own plugin.json version
  const sourceDir = findPluginSourceDir(mpDir, pluginName)
  if (sourceDir) {
    const pluginManifest = readJson<{ version?: string }>(join(sourceDir, '.claude-plugin', 'plugin.json'))
    if (pluginManifest?.version) return pluginManifest.version
  }

  // 3. git commit hash fallback
  const sha = getPluginLatestCommitSha(mpDir, pluginName)
  return sha ? sha.slice(0, 12) : null
}

/** Find the source directory for a plugin inside a marketplace */
function findPluginSourceDir(mpDir: string, pluginName: string): string | null {
  for (const subDir of ['plugins', 'external_plugins']) {
    const candidate = join(mpDir, subDir, pluginName)
    if (existsSync(candidate)) return candidate
  }
  return null
}

export function listPlugins(cwd: string): PluginInfo[] {
  const data = readJson<InstalledPluginsData>(INSTALLED_FILE)
  if (!data?.plugins) return []

  const mpLocations = getMarketplaceLocations()
  const plugins: PluginInfo[] = []

  for (const [pluginKey, entries] of Object.entries(data.plugins)) {
    const [name, marketplace] = pluginKey.split('@')
    if (!name || !marketplace) continue

    for (const entry of entries) {
      if (!entry.installPath) continue
      const isProject = (entry.scope === 'project' || entry.scope === 'local') && entry.projectPath === cwd
      const isUser = entry.scope === 'user'
      if (!isUser && !isProject) continue

      const manifest = readPluginManifest(entry.installPath)
      const contents = detectPluginContents(entry.installPath)
      const mpDir = mpLocations.get(marketplace)
      const latestVersion = mpDir ? getPluginNewVersion(mpDir, name) ?? undefined : undefined
      const hasUpdate = !!(latestVersion && entry.version && latestVersion !== entry.version)

      plugins.push({
        name,
        marketplace,
        key: pluginKey,
        scope: isUser ? 'user' : 'project',
        description: manifest?.description ?? '',
        author: manifest?.author?.name,
        version: entry.version,
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

export function readPluginContent(cwd: string, key: string): PluginDetail | null {
  const data = readJson<InstalledPluginsData>(INSTALLED_FILE)
  if (!data?.plugins?.[key]) return null

  const [name, marketplace] = key.split('@')
  if (!name || !marketplace) return null

  for (const entry of data.plugins[key]) {
    if (!entry.installPath) continue
    const isProject = (entry.scope === 'project' || entry.scope === 'local') && entry.projectPath === cwd
    const isUser = entry.scope === 'user'
    if (!isUser && !isProject) continue

    const manifest = readPluginManifest(entry.installPath)
    const contents = detectPluginContents(entry.installPath)
    const mpLocations = getMarketplaceLocations()
    const mpDir = mpLocations.get(marketplace)
    const latestVersion = mpDir ? getPluginNewVersion(mpDir, name) ?? undefined : undefined
    const hasUpdate = !!(latestVersion && entry.version && latestVersion !== entry.version)
    const mcpServerConfigs = readMcpServersMap(entry.installPath)
    const hookEvents = readHookEvents(entry.installPath)

    return {
      name,
      marketplace,
      key,
      scope: isUser ? 'user' : 'project',
      description: manifest?.description ?? '',
      author: manifest?.author?.name,
      version: entry.version,
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

export function readPluginFile(cwd: string, pluginKey: string, relativePath: string): string | null {
  const data = readJson<InstalledPluginsData>(INSTALLED_FILE)
  if (!data?.plugins?.[pluginKey]) return null

  for (const entry of data.plugins[pluginKey]) {
    if (!entry.installPath) continue
    const isProject = (entry.scope === 'project' || entry.scope === 'local') && entry.projectPath === cwd
    const isUser = entry.scope === 'user'
    if (!isUser && !isProject) continue

    const resolved = resolve(entry.installPath, relativePath)
    // Prevent path traversal
    if (!resolved.startsWith(entry.installPath)) return null
    if (!existsSync(resolved) || statSync(resolved).isDirectory()) return null
    try {
      return readFileSync(resolved, 'utf-8')
    } catch {
      return null
    }
  }

  return null
}

export function deletePlugin(key: string, scope: ResourceScope, cwd: string): void {
  const data = readJson<InstalledPluginsData>(INSTALLED_FILE)
  if (!data?.plugins?.[key]) return

  data.plugins[key] = data.plugins[key].filter(entry => {
    if (scope === 'user') return entry.scope !== 'user'
    return !((entry.scope === 'project' || entry.scope === 'local') && entry.projectPath === cwd)
  })

  if (data.plugins[key].length === 0) {
    delete data.plugins[key]
  }

  writeFileSync(INSTALLED_FILE, JSON.stringify(data, null, 2), 'utf-8')
}

interface MarketplaceEntry {
  source?: { source: string; repo?: string; path?: string }
  installLocation?: string
  lastUpdated?: string
}

export function listMarketplacePlugins(cwd: string): MarketplacePlugin[] {
  // Format: { "marketplace-name": { installLocation, source, lastUpdated } }
  const marketplaces = readJson<Record<string, MarketplaceEntry>>(MARKETPLACES_FILE)
  if (!marketplaces || typeof marketplaces !== 'object') return []

  const scopeMap = getMarketplaceScopeMap(cwd)

  // Load install counts
  const countsData = readJson<{ counts?: Array<{ plugin: string; unique_installs: number }> }>(INSTALL_COUNTS_FILE)
  const countMap = new Map<string, number>()
  if (countsData?.counts) {
    for (const c of countsData.counts) {
      countMap.set(c.plugin, c.unique_installs)
    }
  }

  // Load installed plugins to mark installed status
  const installed = readJson<InstalledPluginsData>(INSTALLED_FILE)
  const installedMap = new Map<string, ResourceScope>()
  if (installed?.plugins) {
    for (const [key, entries] of Object.entries(installed.plugins)) {
      for (const entry of entries) {
        const isProject = (entry.scope === 'project' || entry.scope === 'local') && entry.projectPath === cwd
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

    // Scan both plugins/ and external_plugins/ directories
    for (const subDir of ['plugins', 'external_plugins']) {
      const pluginsDir = join(mpDir, subDir)
      if (!existsSync(pluginsDir)) continue

      try {
        for (const entry of readdirSync(pluginsDir, { withFileTypes: true })) {
          if (!entry.isDirectory() && !entry.isSymbolicLink()) continue
          const pluginDir = join(pluginsDir, entry.name)
          const manifest = readPluginManifest(pluginDir)
          if (!manifest) continue

          const key = `${entry.name}@${mpName}`
          const contents = detectPluginContents(pluginDir)
          plugins.push({
            name: entry.name,
            marketplace: mpName,
            key,
            description: manifest.description ?? '',
            author: manifest.author?.name,
            version: manifest.version,
            installCount: countMap.get(key),
            installed: installedMap.has(key),
            installedScope: installedMap.get(key),
            marketplaceLastUpdated: mpInfo.lastUpdated,
            marketplaceSource: mpInfo.source?.source === 'github' && mpInfo.source.repo
              ? mpInfo.source.repo
              : mpInfo.source?.source === 'directory' && mpInfo.source.path
                ? mpInfo.source.path
                : undefined,
            marketplaceScope: scopeMap.get(mpName) ?? 'official',
            ...contents,
          })
        }
      } catch {
        // ignore unreadable directories
      }
    }
  }

  // Sort by install count descending
  plugins.sort((a, b) => (b.installCount ?? 0) - (a.installCount ?? 0))

  return plugins
}

/** Update a marketplace using the Claude CLI, which handles github / git / url / directory sources. */
export function updateMarketplace(marketplaceName: string): Promise<void> {
  return new Promise((resolve, reject) => {
    execFile('claude', ['plugin', 'marketplace', 'update', marketplaceName], { timeout: 60000 }, (error, _stdout, stderr) => {
      if (error) {
        reject(new Error(stderr?.trim() || `Failed to update marketplace: ${error.message}`))
      } else {
        resolve()
      }
    })
  })
}

export function installPlugin(pluginKey: string, scope: ResourceScope, cwd: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const args = ['plugin', 'install', pluginKey, '--scope', scope]
    if (scope === 'project') {
      args.push('--project-path', cwd)
    }

    execFile('claude', args, { timeout: 30000 }, (error) => {
      if (error) {
        reject(new Error(`Failed to install plugin: ${error.message}`))
      } else {
        resolve()
      }
    })
  })
}

/**
 * Update an installed plugin by copying files from marketplace source to cache
 * and updating installed_plugins.json.
 */
export function updatePlugin(key: string, scope: ResourceScope, cwd: string): void {
  const data = readJson<InstalledPluginsData>(INSTALLED_FILE)
  if (!data?.plugins?.[key]) return

  const [name, marketplace] = key.split('@')
  if (!name || !marketplace) return

  const mpLocations = getMarketplaceLocations()
  const mpDir = mpLocations.get(marketplace)
  if (!mpDir) return

  const sourceDir = findPluginSourceDir(mpDir, name)
  if (!sourceDir) return

  const newVersion = getPluginNewVersion(mpDir, name)
  if (!newVersion) return

  // Copy source to cache
  const cacheDir = join(PLUGINS_DIR, 'cache', marketplace, name, newVersion)
  if (!existsSync(cacheDir)) {
    mkdirSync(cacheDir, { recursive: true })
    cpSync(sourceDir, cacheDir, { recursive: true })
  }

  // Update matching entry in installed_plugins.json
  const latestSha = getPluginLatestCommitSha(mpDir, name)

  for (const entry of data.plugins[key]) {
    const isMatch = scope === 'user'
      ? entry.scope === 'user'
      : (entry.scope === 'project' || entry.scope === 'local') && entry.projectPath === cwd
    if (!isMatch) continue

    entry.installPath = cacheDir
    entry.version = newVersion
    entry.lastUpdated = new Date().toISOString()
    if (latestSha) entry.gitCommitSha = latestSha
  }

  writeFileSync(INSTALLED_FILE, JSON.stringify(data, null, 2), 'utf-8')
}

/**
 * Add a marketplace via the Claude CLI.
 * Source can be a GitHub repo (owner/repo), URL, or absolute/relative local path.
 */
export function addMarketplace(source: string, scope: ResourceScope, cwd: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const args = ['plugin', 'marketplace', 'add', source, '--scope', scope]
    execFile('claude', args, { timeout: 60000, cwd }, (error, _stdout, stderr) => {
      if (error) {
        reject(new Error(stderr?.trim() || `Failed to add marketplace: ${error.message}`))
      } else {
        resolve()
      }
    })
  })
}

export function removeMarketplace(name: string, scope: MarketplaceScope, cwd: string): Promise<void> {
  if (scope === 'official') {
    return Promise.reject(new Error('Cannot remove the built-in official marketplace'))
  }

  const settingsPath = scope === 'user'
    ? getUserSettingsPath()
    : scope === 'project'
      ? getProjectSettingsPath(cwd)
      : getLocalSettingsPath(cwd)

  removeMarketplaceFromSettings(settingsPath, name)

  // If no other scope still declares it, ask CLI to clean cache + remove install dir.
  const stillDeclared = getMarketplaceScopeMap(cwd).has(name)
  if (stillDeclared) {
    return Promise.resolve()
  }

  return new Promise((resolve, reject) => {
    execFile('claude', ['plugin', 'marketplace', 'remove', name], { timeout: 30000 }, (error, _stdout, stderr) => {
      if (error) {
        const msg = stderr?.trim() || error.message
        // Settings.json already updated; cache cleanup failure is non-fatal but surface it.
        reject(new Error(`Marketplace removed from settings, but cache cleanup failed: ${msg}`))
      } else {
        resolve()
      }
    })
  })
}

export function readMarketplacePluginContent(marketplace: string, name: string): MarketplacePluginDetail | null {
  const marketplaces = readJson<Record<string, MarketplaceEntry>>(MARKETPLACES_FILE)
  const mpInfo = marketplaces?.[marketplace]
  if (!mpInfo?.installLocation || !existsSync(mpInfo.installLocation)) return null

  const sourceDir = findPluginSourceDir(mpInfo.installLocation, name)
  if (!sourceDir) return null

  const manifest = readPluginManifest(sourceDir)
  if (!manifest) return null

  const contents = detectPluginContents(sourceDir)

  // Check installed state from installed_plugins.json
  const installed = readJson<InstalledPluginsData>(INSTALLED_FILE)
  const key = `${name}@${marketplace}`
  let installedFlag = false
  let installedScope: ResourceScope | undefined
  if (installed?.plugins?.[key]) {
    for (const entry of installed.plugins[key]) {
      if (entry.scope === 'user') { installedFlag = true; installedScope = 'user'; break }
      if (entry.scope === 'project' || entry.scope === 'local') { installedFlag = true; installedScope = 'project' }
    }
  }

  const countsData = readJson<{ counts?: Array<{ plugin: string; unique_installs: number }> }>(INSTALL_COUNTS_FILE)
  const installCount = countsData?.counts?.find(c => c.plugin === key)?.unique_installs
  const mcpServerConfigs = readMcpServersMap(sourceDir)
  const hookEvents = readHookEvents(sourceDir)

  return {
    name,
    marketplace,
    key,
    description: manifest.description ?? '',
    author: manifest.author?.name,
    version: manifest.version,
    installCount,
    installed: installedFlag,
    installedScope,
    marketplaceLastUpdated: mpInfo.lastUpdated,
    marketplaceSource: mpInfo.source?.source === 'github' && mpInfo.source.repo
      ? mpInfo.source.repo
      : mpInfo.source?.source === 'directory' && mpInfo.source.path
        ? mpInfo.source.path
        : undefined,
    marketplaceScope: getMarketplaceScopeMap('').get(marketplace) ?? 'official',
    ...contents,
    sourcePath: sourceDir,
    files: scanDir(sourceDir),
    mcpServers: Object.keys(mcpServerConfigs),
    mcpServerConfigs,
    hookEvents,
  }
}

export function readMarketplacePluginFile(marketplace: string, name: string, relativePath: string): string | null {
  const marketplaces = readJson<Record<string, MarketplaceEntry>>(MARKETPLACES_FILE)
  const mpInfo = marketplaces?.[marketplace]
  if (!mpInfo?.installLocation || !existsSync(mpInfo.installLocation)) return null

  const sourceDir = findPluginSourceDir(mpInfo.installLocation, name)
  if (!sourceDir) return null

  const resolved = resolve(sourceDir, relativePath)
  if (!resolved.startsWith(sourceDir)) return null
  if (!existsSync(resolved) || statSync(resolved).isDirectory()) return null
  try {
    return readFileSync(resolved, 'utf-8')
  } catch {
    return null
  }
}
