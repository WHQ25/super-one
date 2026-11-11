import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'
import { app } from 'electron'
import { parse as parseToml } from 'smol-toml'
import type { McpServerConfig } from '@superone/shared/agent-types'
import { mcpServerConfigFingerprint } from '@superone/runtime/mcp-apps/identity'
import {
  mcpAppEntrypointKinds,
  normalizeMcpAppEntrypointKinds,
  parseMcpAppEntrypointKey,
  sortMcpAppEntrypoints,
  toMcpAppEntrypointDescriptor,
  type McpAppEntrypointDescriptor,
  type McpAppEntrypointHarness,
  type McpAppGlobalEntrypointsQuery,
  type McpAppGlobalEntrypointsResult,
} from '@superone/shared/mcp-app-entrypoints'
import type { McpToolDescriptor } from '@superone/shared/mcp-apps'
import { parseRemoteProjectKey } from '@superone/shared/remote-resource-key'
import { listCodexMcpConfigs } from '../codex-config-service'
import { listMcpConfigs } from '../mcp-config-service'
import { readClaudeMcpToken } from './claude-mcp-token'
import { connectHostClient, HOST_CLIENT_DISCOVERY_TIMEOUT_MS, hostClientConfig, type HostClientConfig, type HostClientTokenSource } from './host-client'

interface CachedServerEntrypoints {
  configFingerprint: string
  entrypoints: McpAppEntrypointDescriptor[]
  updatedAt: number
}

interface EntrypointCacheData {
  servers: Record<string, CachedServerEntrypoints>
}

export interface EntrypointDiscoveryDeps {
  cachePath?: () => string
  claudeConfigs?: (projectPath: string) => McpServerConfig[]
  codexConfigs?: (projectPath: string) => McpServerConfig[]
  isTrustedProjectStdio?: (projectPath: string, harness: McpAppEntrypointHarness, serverName: string) => boolean
  discoverServerTools?: (
    harness: McpAppEntrypointHarness,
    serverName: string,
    config: HostClientConfig,
    projectPath: string,
  ) => Promise<Map<string, McpToolDescriptor>>
}

const CACHE_FILENAME = 'mcp-app-entrypoints.json'
const inFlight = new Map<string, Promise<Map<string, McpToolDescriptor>>>()

function defaultCachePath(): string {
  return join(app.getPath('userData'), CACHE_FILENAME)
}

function serverCacheKey(projectPath: string, harness: McpAppEntrypointHarness, serverName: string): string {
  return JSON.stringify([projectPath, harness, serverName])
}

function isObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value))
}

function readStore(cachePath: string): EntrypointCacheData {
  if (!existsSync(cachePath)) return { servers: {} }
  try {
    const raw = JSON.parse(readFileSync(cachePath, 'utf8'))
    if (!isObject(raw)) return { servers: {} }
    const servers: Record<string, CachedServerEntrypoints> = {}
    if (isObject(raw.servers)) {
      for (const [key, entry] of Object.entries(raw.servers)) {
        if (!isObject(entry) || typeof entry.configFingerprint !== 'string' || !Array.isArray(entry.entrypoints)) continue
        const descriptors: McpAppEntrypointDescriptor[] = []
        for (const item of entry.entrypoints) {
          if (
            !isObject(item)
            || typeof item.key !== 'string'
            || typeof item.server !== 'string'
            || typeof item.tool !== 'string'
            || typeof item.title !== 'string'
            || typeof item.resourceUri !== 'string'
          ) {
            continue
          }
          const parsedKey = parseMcpAppEntrypointKey(item.key)
          descriptors.push({
            ...(item as unknown as McpAppEntrypointDescriptor),
            harness: item.harness === 'claude' || item.harness === 'codex' ? item.harness : parsedKey?.harness,
            kinds: normalizeMcpAppEntrypointKinds(Array.isArray(item.kinds) ? item.kinds : undefined),
          })
        }
        servers[key] = {
          configFingerprint: entry.configFingerprint,
          entrypoints: descriptors,
          updatedAt: typeof entry.updatedAt === 'number' ? entry.updatedAt : 0,
        }
      }
    }
    return { servers }
  } catch {
    return { servers: {} }
  }
}

function writeStore(cachePath: string, data: EntrypointCacheData): void {
  mkdirSync(dirname(cachePath), { recursive: true })
  writeFileSync(cachePath, JSON.stringify(data, null, 2))
}

export function isTrustedProjectStdioServer(projectPath: string, harness: McpAppEntrypointHarness, serverName: string): boolean {
  if (harness === 'claude') {
    const claudePath = join(homedir(), '.claude.json')
    if (!existsSync(claudePath)) return false
    try {
      const parsed = JSON.parse(readFileSync(claudePath, 'utf8'))
      const projects = isObject(parsed) && isObject(parsed.projects) ? parsed.projects : undefined
      const project = projects && isObject(projects[projectPath]) ? projects[projectPath] : undefined
      if (!project) return false
      if (project.enableAllProjectMcpServers === true) return true
      return Array.isArray(project.enabledMcpjsonServers) && project.enabledMcpjsonServers.includes(serverName)
    } catch {
      return false
    }
  }
  const codexHome = process.env.CODEX_HOME || join(homedir(), '.codex')
  const codexPath = join(codexHome, 'config.toml')
  if (!existsSync(codexPath)) return false
  try {
    const parsed = parseToml(readFileSync(codexPath, 'utf8'))
    const projects = isObject(parsed) && isObject(parsed.projects) ? parsed.projects : undefined
    const project = projects && isObject(projects[projectPath]) ? projects[projectPath] : undefined
    return project?.trust_level === 'trusted'
  } catch {
    return false
  }
}

async function defaultDiscoverServerTools(
  harness: McpAppEntrypointHarness,
  serverName: string,
  config: HostClientConfig,
  projectPath: string,
): Promise<Map<string, McpToolDescriptor>> {
  const tokenSource: HostClientTokenSource | undefined = harness === 'claude' && config.type !== 'stdio'
    ? {
        read: httpConfig => readClaudeMcpToken(null, serverName, httpConfig),
        renew: async () => {},
      }
    : undefined
  const { client, tools } = await connectHostClient('superone-entrypoints', config, projectPath, HOST_CLIENT_DISCOVERY_TIMEOUT_MS, tokenSource)
  await client.close().catch(() => undefined)
  return tools
}

function extractEntrypointDescriptors(
  harness: McpAppEntrypointHarness,
  serverName: string,
  tools: Iterable<McpToolDescriptor>,
): McpAppEntrypointDescriptor[] {
  const descriptors: McpAppEntrypointDescriptor[] = []
  for (const tool of tools) {
    if (mcpAppEntrypointKinds(tool).length === 0) continue
    const descriptor = toMcpAppEntrypointDescriptor({ harness, server: serverName, tool })
    if (descriptor) descriptors.push(descriptor)
  }
  return descriptors
}

export function createMcpAppEntrypointsStore(deps: EntrypointDiscoveryDeps = {}) {
  const resolveCachePath = deps.cachePath ?? defaultCachePath
  const listClaude = deps.claudeConfigs ?? ((cwd: string) => listMcpConfigs(cwd))
  const listCodex = deps.codexConfigs ?? ((cwd: string) => listCodexMcpConfigs(cwd))
  const isTrustedStdio = deps.isTrustedProjectStdio ?? isTrustedProjectStdioServer
  const discoverTools = deps.discoverServerTools ?? defaultDiscoverServerTools
  const userBucket = '__user__'

  return {
    recordSessionTools(
      projectPath: string,
      harness: McpAppEntrypointHarness,
      serverName: string,
      configFingerprint: string,
      tools: Iterable<McpToolDescriptor>,
    ): void {
      if (projectPath && parseRemoteProjectKey(projectPath)) return
      const normalizedProject = projectPath || ''
      const configs = harness === 'claude' ? listClaude(normalizedProject) : listCodex(normalizedProject)
      const matched = configs.find(cfg => cfg.name === serverName && mcpServerConfigFingerprint(cfg) === configFingerprint)
      const bucket = matched?.scope === 'user' || !normalizedProject ? userBucket : normalizedProject
      const cachePath = resolveCachePath()
      const store = readStore(cachePath)
      const key = serverCacheKey(bucket, harness, serverName)
      const entrypoints = extractEntrypointDescriptors(harness, serverName, tools)
      const current = store.servers[key]
      if (
        current?.configFingerprint === configFingerprint
        && JSON.stringify(current.entrypoints) === JSON.stringify(entrypoints)
      ) {
        return
      }
      store.servers[key] = { configFingerprint, entrypoints, updatedAt: Date.now() }
      writeStore(cachePath, store)
    },

    async readGlobal(
      projectPath: string,
      options: McpAppGlobalEntrypointsQuery = {},
    ): Promise<McpAppGlobalEntrypointsResult> {
      const cachePath = resolveCachePath()
      const initial = readStore(cachePath)
      const normalizedProject = projectPath || ''
      if (normalizedProject && parseRemoteProjectKey(normalizedProject)) return { entrypoints: [], unavailable: 'remote' }

      const allTargets: Array<{ harness: McpAppEntrypointHarness; config: McpServerConfig; fingerprint: string; key: string; fallbackKey?: string }> = []
      for (const [harness, configs] of [
        ['claude', listClaude(normalizedProject)],
        ['codex', listCodex(normalizedProject)],
      ] as const) {
        for (const config of configs) {
          if (config.disabled || (harness === 'codex' && config.name === 'codex_apps')) continue
          if (!normalizedProject && config.scope === 'project') continue
          const fingerprint = mcpServerConfigFingerprint(config)
          const bucket = config.scope === 'user' ? userBucket : normalizedProject
          const key = serverCacheKey(bucket, harness, config.name)
          const fallbackKey = config.scope === 'user' && normalizedProject
            ? serverCacheKey(normalizedProject, harness, config.name)
            : undefined
          allTargets.push({ harness, config, fingerprint, key, ...(fallbackKey ? { fallbackKey } : {}) })
        }
      }

      const activeTargets = options.harness
        ? allTargets.filter(target => target.harness === options.harness)
        : allTargets

      let incomplete = false
      const discovered = new Map<string, CachedServerEntrypoints>()
      const discoveryCwd = normalizedProject || homedir()

      if (options.discover) {
        await Promise.all(activeTargets.map(async ({ harness, config, fingerprint, key, fallbackKey }) => {
          const cached = initial.servers[key] ?? (fallbackKey ? initial.servers[fallbackKey] : undefined)
          if (!options.forceRefresh && cached?.configFingerprint === fingerprint) return
          const hcConfig = hostClientConfig(config)
          if (!hcConfig) {
            incomplete = true
            return
          }
          if (config.scope === 'project' && hcConfig.type === 'stdio' && !isTrustedStdio(normalizedProject, harness, config.name)) {
            incomplete = true
            return
          }
          const flightKey = JSON.stringify([key, fingerprint])
          let pending = inFlight.get(flightKey)
          if (!pending) {
            pending = discoverTools(harness, config.name, hcConfig, discoveryCwd).finally(() => {
              if (inFlight.get(flightKey) === pending) inFlight.delete(flightKey)
            })
            inFlight.set(flightKey, pending)
          }
          try {
            const tools = await pending
            discovered.set(key, {
              configFingerprint: fingerprint,
              entrypoints: extractEntrypointDescriptors(harness, config.name, tools.values()),
              updatedAt: Date.now(),
            })
          } catch {
            incomplete = true
          }
        }))
      }

      const latest = discovered.size > 0 ? readStore(cachePath) : initial
      if (discovered.size > 0) {
        for (const [key, value] of discovered) latest.servers[key] = value
        writeStore(cachePath, latest)
      }

      const activeKeys = new Set(activeTargets.map(target => target.key))
      const collected: McpAppEntrypointDescriptor[] = []
      const seenKey = new Set<string>()
      for (const { fingerprint, key, fallbackKey } of allTargets) {
        const entry = latest.servers[key] ?? (fallbackKey ? latest.servers[fallbackKey] : undefined)
        if (!entry || entry.configFingerprint !== fingerprint) {
          if (activeKeys.has(key)) incomplete = true
          continue
        }
        for (const descriptor of entry.entrypoints) {
          if (seenKey.has(descriptor.key)) continue
          seenKey.add(descriptor.key)
          collected.push(descriptor)
        }
      }

      return {
        entrypoints: sortMcpAppEntrypoints(collected),
        ...(incomplete ? { incomplete: true as const } : {}),
      }
    },
  }
}

let singleton: ReturnType<typeof createMcpAppEntrypointsStore> | undefined

export function getMcpAppEntrypointsStore(): ReturnType<typeof createMcpAppEntrypointsStore> {
  singleton ??= createMcpAppEntrypointsStore()
  return singleton
}
