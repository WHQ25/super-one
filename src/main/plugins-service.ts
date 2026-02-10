import { join, resolve } from 'path'
import { homedir } from 'os'
import { cpSync, existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from 'fs'
import { execFile, execFileSync } from 'child_process'
import type { ResourceScope, PluginInfo, PluginDetail, PluginManifest, MarketplacePlugin, SkillFileEntry } from '../shared/agent-types'

const PLUGINS_DIR = join(homedir(), '.claude', 'plugins')
const INSTALLED_FILE = join(PLUGINS_DIR, 'installed_plugins.json')
const MARKETPLACES_FILE = join(PLUGINS_DIR, 'known_marketplaces.json')
const INSTALL_COUNTS_FILE = join(PLUGINS_DIR, 'install-counts-cache.json')

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
          plugins.push({
            name: entry.name,
            marketplace: mpName,
            key,
            description: manifest.description ?? '',
            author: manifest.author?.name,
            installCount: countMap.get(key),
            installed: installedMap.has(key),
            installedScope: installedMap.get(key),
            marketplaceLastUpdated: mpInfo.lastUpdated,
            marketplaceSource: mpInfo.source?.source === 'github' && mpInfo.source.repo
              ? mpInfo.source.repo
              : mpInfo.source?.source === 'directory' && mpInfo.source.path
                ? mpInfo.source.path
                : undefined,
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

/** Update a marketplace by running git pull, then update lastUpdated in known_marketplaces.json */
export function updateMarketplace(marketplaceName: string): Promise<void> {
  const marketplaces = readJson<Record<string, MarketplaceEntry>>(MARKETPLACES_FILE)
  if (!marketplaces?.[marketplaceName]) {
    return Promise.reject(new Error(`Marketplace "${marketplaceName}" not found`))
  }

  const mpDir = marketplaces[marketplaceName].installLocation
  if (!mpDir || !existsSync(mpDir)) {
    return Promise.reject(new Error(`Marketplace directory not found`))
  }

  // Only git repos can be updated
  if (!existsSync(join(mpDir, '.git'))) {
    return Promise.reject(new Error(`Marketplace is not a git repository`))
  }

  return new Promise((resolve, reject) => {
    execFile('git', ['pull', '--ff-only'], { cwd: mpDir, timeout: 30000 }, (error) => {
      if (error) {
        reject(new Error(`Failed to update marketplace: ${error.message}`))
        return
      }

      // Update lastUpdated timestamp
      marketplaces[marketplaceName].lastUpdated = new Date().toISOString()
      writeFileSync(MARKETPLACES_FILE, JSON.stringify(marketplaces, null, 2), 'utf-8')
      resolve()
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
