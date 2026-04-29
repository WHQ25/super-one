import { existsSync, readdirSync, readFileSync, statSync } from 'fs'
import { join, resolve } from 'path'
import type {
  MarketplacePlugin,
  PluginAppSummary,
  PluginAuthPolicy,
  PluginDetail,
  PluginInfo,
  PluginInstallPolicy,
  PluginManifest,
  PluginSkillSummary,
  SkillFileEntry,
} from '../../shared/agent-types'
import type { CodexExperimentService } from './codex-experiment-service'

interface PluginInventoryRecord {
  key: string
  name: string
  marketplace: string
  marketplaceDisplayName?: string
  marketplacePath: string
  sourcePath?: string
  installed: boolean
  enabled: boolean
  installPolicy?: PluginInstallPolicy
  authPolicy?: PluginAuthPolicy
  displayName?: string
  shortDescription?: string
  longDescription?: string
  developerName?: string
  category?: string
  capabilities?: string[]
  websiteUrl?: string
  privacyPolicyUrl?: string
  termsOfServiceUrl?: string
  defaultPrompts?: string[]
  brandColor?: string
  iconPath?: string
  logoPath?: string
  screenshots?: string[]
}

function isWindowsAbsolutePath(value: string): boolean {
  return /^[A-Za-z]:[\\/]/.test(value)
}

function isAbsoluteFileSystemPath(value: string): boolean {
  return value.startsWith('/') || isWindowsAbsolutePath(value)
}

function hasUrlScheme(value: string): boolean {
  return /^[A-Za-z][A-Za-z+\-.0-9]*:/.test(value) && !isWindowsAbsolutePath(value)
}

function resolvePluginAssetPath(value: unknown, sourcePath?: string): string | undefined {
  const assetPath = readString(value)
  if (!assetPath) return undefined
  if (hasUrlScheme(assetPath) || isAbsoluteFileSystemPath(assetPath)) return assetPath
  if (!sourcePath) return undefined
  return resolve(sourcePath, assetPath)
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' ? value as Record<string, unknown> : null
}

function readString(value: unknown): string | null {
  return typeof value === 'string' ? value : null
}

function readBoolean(value: unknown): boolean | null {
  return typeof value === 'boolean' ? value : null
}

function readStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return []
  return value
    .map((entry) => readString(entry))
    .filter((entry): entry is string => entry !== null)
}

function readPolicy<T extends string>(value: unknown, valid: readonly T[]): T | undefined {
  const policy = readString(value)
  return policy && valid.includes(policy as T) ? policy as T : undefined
}

function readResolvedAssetArray(value: unknown, sourcePath?: string): string[] {
  if (!Array.isArray(value)) return []
  return value
    .map((entry) => resolvePluginAssetPath(entry, sourcePath))
    .filter((entry): entry is string => !!entry)
}

function scanDir(dirPath: string): SkillFileEntry[] {
  try {
    return readdirSync(dirPath, { withFileTypes: true })
      .filter((entry) => !entry.name.startsWith('.'))
      .sort((a, b) => {
        const aDir = a.isDirectory() || (a.isSymbolicLink() && statSync(join(dirPath, a.name)).isDirectory())
        const bDir = b.isDirectory() || (b.isSymbolicLink() && statSync(join(dirPath, b.name)).isDirectory())
        if (aDir !== bDir) return aDir ? -1 : 1
        return a.name.localeCompare(b.name)
      })
      .map((entry) => {
        const isDirectory = entry.isDirectory() || (entry.isSymbolicLink() && statSync(join(dirPath, entry.name)).isDirectory())
        return {
          name: entry.name,
          isDirectory,
          ...(isDirectory ? { children: scanDir(join(dirPath, entry.name)) } : {}),
        }
      })
  } catch {
    return []
  }
}

function readPluginManifest(sourcePath: string): PluginManifest | null {
  try {
    return JSON.parse(readFileSync(join(sourcePath, '.codex-plugin', 'plugin.json'), 'utf-8')) as PluginManifest
  } catch {
    return null
  }
}

function detectPluginContents(sourcePath: string): Omit<PluginInfo, 'name' | 'marketplace' | 'key' | 'scope' | 'description' | 'author' | 'version' | 'installPath' | 'installedAt' | 'latestVersion' | 'hasUpdate'> {
  return {
    hasCommands: existsSync(join(sourcePath, 'commands')),
    hasAgents: existsSync(join(sourcePath, 'agents')),
    hasSkills: existsSync(join(sourcePath, 'skills')),
    hasHooks: existsSync(join(sourcePath, 'hooks')) || existsSync(join(sourcePath, 'hooks.json')),
    hasMcpServers: existsSync(join(sourcePath, '.mcp.json')),
  }
}

function compactRecord(input: Record<string, unknown>): Record<string, unknown> {
  const output: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(input)) {
    if (value !== undefined) output[key] = value
  }
  return output
}

function buildPluginMetadata(record: PluginInventoryRecord) {
  return compactRecord({
    displayName: record.displayName,
    longDescription: record.longDescription,
    author: record.developerName,
    category: record.category,
    capabilities: record.capabilities && record.capabilities.length > 0 ? record.capabilities : undefined,
    websiteUrl: record.websiteUrl,
    privacyPolicyUrl: record.privacyPolicyUrl,
    termsOfServiceUrl: record.termsOfServiceUrl,
    defaultPrompts: record.defaultPrompts && record.defaultPrompts.length > 0 ? record.defaultPrompts : undefined,
    brandColor: record.brandColor,
    iconPath: record.iconPath,
    logoPath: record.logoPath,
    screenshots: record.screenshots && record.screenshots.length > 0 ? record.screenshots : undefined,
    enabled: record.enabled,
    installPolicy: record.installPolicy,
    authPolicy: record.authPolicy,
  })
}

function mapMarketplacePlugin(record: PluginInventoryRecord): MarketplacePlugin {
  return {
    name: record.name,
    marketplace: record.marketplace,
    key: record.key,
    description: record.shortDescription ?? record.longDescription ?? '',
    ...buildPluginMetadata(record),
    installed: record.installed,
    installedScope: record.installed ? 'user' : undefined,
  }
}

function mapInstalledPlugin(
  record: PluginInventoryRecord & { sourcePath: string },
  description: string,
  author: string | undefined,
  version: string | undefined,
  contents: ReturnType<typeof detectPluginContents>,
): PluginInfo {
  return {
    name: record.name,
    marketplace: record.marketplace,
    key: record.key,
    scope: 'user',
    description,
    ...buildPluginMetadata({ ...record, developerName: author ?? record.developerName }),
    version,
    installPath: record.sourcePath,
    ...contents,
    hasUpdate: false,
  }
}

export class CodexPluginsService {
  constructor(private readonly codexService: CodexExperimentService) {}

  private async listInventory(projectPath: string): Promise<PluginInventoryRecord[]> {
    return this.codexService.withAppServerRequest(projectPath, async (request) => {
      const result = await request(
        'plugin/list',
        compactRecord({
          cwds: projectPath ? [projectPath] : undefined,
        }),
      )

      const marketplaces = Array.isArray(result.marketplaces) ? result.marketplaces : []
      const records: PluginInventoryRecord[] = []

      for (const rawMarketplace of marketplaces) {
        const marketplace = asRecord(rawMarketplace)
        if (!marketplace) continue

        const marketplaceName = readString(marketplace.name)
        const marketplacePath = readString(marketplace.path)
        if (!marketplaceName || !marketplacePath) continue
        const marketplaceInterface = asRecord(marketplace.interface)

        const plugins = Array.isArray(marketplace.plugins) ? marketplace.plugins : []
        for (const rawPlugin of plugins) {
          const plugin = asRecord(rawPlugin)
          if (!plugin) continue

          const key = readString(plugin.id)
          const name = readString(plugin.name)
          const source = asRecord(plugin.source)
          const sourcePath = readString(source?.path) ?? undefined
          if (!key || !name) continue

          const pluginInterface = asRecord(plugin.interface)
          records.push({
            key,
            name,
            marketplace: marketplaceName,
            marketplaceDisplayName: readString(marketplaceInterface?.displayName) ?? undefined,
            marketplacePath,
            sourcePath,
            installed: readBoolean(plugin.installed) ?? false,
            enabled: readBoolean(plugin.enabled) ?? false,
            installPolicy: readPolicy(plugin.installPolicy, ['NOT_AVAILABLE', 'AVAILABLE', 'INSTALLED_BY_DEFAULT'] as const),
            authPolicy: readPolicy(plugin.authPolicy, ['ON_INSTALL', 'ON_USE'] as const),
            displayName: readString(pluginInterface?.displayName) ?? undefined,
            shortDescription: readString(pluginInterface?.shortDescription) ?? undefined,
            longDescription: readString(pluginInterface?.longDescription) ?? undefined,
            developerName: readString(pluginInterface?.developerName) ?? undefined,
            category: readString(pluginInterface?.category) ?? undefined,
            capabilities: readStringArray(pluginInterface?.capabilities),
            websiteUrl: readString(pluginInterface?.websiteUrl) ?? readString(pluginInterface?.websiteURL) ?? undefined,
            privacyPolicyUrl: readString(pluginInterface?.privacyPolicyUrl) ?? readString(pluginInterface?.privacyPolicyURL) ?? undefined,
            termsOfServiceUrl: readString(pluginInterface?.termsOfServiceUrl) ?? readString(pluginInterface?.termsOfServiceURL) ?? undefined,
            defaultPrompts: readStringArray(pluginInterface?.defaultPrompt),
            brandColor: readString(pluginInterface?.brandColor) ?? undefined,
            iconPath: resolvePluginAssetPath(pluginInterface?.composerIcon, sourcePath),
            logoPath: resolvePluginAssetPath(pluginInterface?.logo, sourcePath),
            screenshots: readResolvedAssetArray(pluginInterface?.screenshots, sourcePath),
          })
        }
      }

      return records
    })
  }

  private async findPlugin(projectPath: string, key: string): Promise<PluginInventoryRecord | null> {
    const records = await this.listInventory(projectPath)
    return records.find((record) => record.key === key) ?? null
  }

  async listPlugins(projectPath: string): Promise<PluginInfo[]> {
    const records = await this.listInventory(projectPath)
    return records
      .filter((record): record is PluginInventoryRecord & { sourcePath: string } => record.installed && !!record.sourcePath)
      .map((record) => {
        const sourcePath = record.sourcePath
        const manifest = readPluginManifest(sourcePath)
        const contents = detectPluginContents(sourcePath)
        return mapInstalledPlugin(
          record,
          record.shortDescription ?? record.longDescription ?? manifest?.description ?? '',
          record.developerName ?? manifest?.author?.name,
          manifest?.version,
          contents,
        )
      })
  }

  async readPlugin(projectPath: string, key: string): Promise<PluginDetail | null> {
    const record = await this.findPlugin(projectPath, key)
    if (!record || !record.sourcePath) return null
    const sourcePath = record.sourcePath

    const detail = await this.codexService.withAppServerRequest(projectPath, async (request) => {
      return request('plugin/read', {
        marketplacePath: record.marketplacePath,
        pluginName: record.name,
      })
    })

    const detailContainer = asRecord(detail)
    const detailRecord = asRecord(detailContainer?.plugin) ?? detailContainer
    const manifest = readPluginManifest(sourcePath)
    const contents = detectPluginContents(sourcePath)
    const summaryRecord = asRecord(detailRecord?.summary)
    const description = readString(detailRecord?.description)
      ?? record.longDescription
      ?? record.shortDescription
      ?? manifest?.description
      ?? ''
    const author = readString(asRecord(summaryRecord?.interface)?.developerName)
      ?? record.developerName
      ?? manifest?.author?.name
    const mcpServers = readStringArray(detailRecord?.mcpServers)
    const plugin = mapInstalledPlugin(
      { ...record, sourcePath },
      description,
      author,
      manifest?.version,
      {
        ...contents,
        hasMcpServers: contents.hasMcpServers || mcpServers.length > 0,
      },
    )

    const apps = Array.isArray(detailRecord?.apps)
      ? detailRecord.apps
        .map((entry) => asRecord(entry))
        .filter((entry): entry is Record<string, unknown> => !!entry)
        .map((entry): PluginAppSummary => ({
          id: readString(entry.id) ?? '',
          name: readString(entry.name) ?? '',
          description: readString(entry.description) ?? undefined,
          installUrl: readString(entry.installUrl) ?? undefined,
          needsAuth: readBoolean(entry.needsAuth) ?? false,
        }))
        .filter((entry) => !!entry.id && !!entry.name)
      : []
    const skills = Array.isArray(detailRecord?.skills)
      ? detailRecord.skills
        .map((entry) => asRecord(entry))
        .filter((entry): entry is Record<string, unknown> => !!entry)
        .map((entry): PluginSkillSummary | null => {
          const skillInterface = asRecord(entry.interface)
          const name = readString(entry.name)
          const path = readString(entry.path)
          const description = readString(entry.description)
          if (!name || !path || !description) return null
          return {
            name,
            displayName: readString(skillInterface?.displayName) ?? undefined,
            description,
            shortDescription: readString(entry.shortDescription) ?? undefined,
            path,
            enabled: readBoolean(entry.enabled) ?? false,
          }
        })
        .filter((entry): entry is PluginSkillSummary => entry !== null)
      : []

    return {
      ...plugin,
      apps,
      skills,
      mcpServers,
      files: scanDir(sourcePath),
    }
  }

  async readPluginFile(projectPath: string, key: string, relativePath: string): Promise<string | null> {
    const record = await this.findPlugin(projectPath, key)
    if (!record || !record.installed || !record.sourcePath) return null

    const resolved = resolve(record.sourcePath, relativePath)
    if (!resolved.startsWith(record.sourcePath)) return null

    try {
      if (!existsSync(resolved) || statSync(resolved).isDirectory()) return null
      return readFileSync(resolved, 'utf-8')
    } catch {
      return null
    }
  }

  async listMarketplacePlugins(projectPath: string): Promise<MarketplacePlugin[]> {
    const records = await this.listInventory(projectPath)
    return records.map((record) => mapMarketplacePlugin(record))
  }

  async installPlugin(projectPath: string, key: string): Promise<void> {
    const record = await this.findPlugin(projectPath, key)
    if (!record) throw new Error(`Unknown Codex plugin: ${key}`)

    await this.codexService.withAppServerRequest(projectPath, async (request) => {
      await request('plugin/install', {
        marketplacePath: record.marketplacePath,
        pluginName: record.name,
      })
    })
  }

  async uninstallPlugin(projectPath: string, key: string): Promise<void> {
    await this.codexService.withAppServerRequest(projectPath, async (request) => {
      await request('plugin/uninstall', {
        pluginId: key,
      })
    })
  }
}
