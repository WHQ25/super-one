import { join } from 'path'
import { homedir } from 'os'
import { readFileSync, writeFileSync, existsSync } from 'fs'
import type { McpServerConfig, ResourceScope } from '../shared/agent-types'

// --- Config file locations ---
// Claude Code stores MCP configs in multiple places:
//   User-level:   ~/.claude.json → mcpServers
//   Project-level: {cwd}/.claude/settings.json → mcpServers
//                  {cwd}/.mcp.json → mcpServers

function getUserConfigPath(): string {
  return join(homedir(), '.claude.json')
}

function getProjectSettingsPath(cwd: string): string {
  return join(cwd, '.claude', 'settings.json')
}

function getProjectMcpJsonPath(cwd: string): string {
  return join(cwd, '.mcp.json')
}

// --- JSON helpers ---

function readJsonFile(filePath: string): Record<string, unknown> {
  if (!existsSync(filePath)) return {}
  try {
    return JSON.parse(readFileSync(filePath, 'utf-8'))
  } catch {
    return {}
  }
}

function writeJsonFile(filePath: string, data: Record<string, unknown>): void {
  writeFileSync(filePath, JSON.stringify(data, null, 2))
}

interface RawMcpEntry {
  type?: string
  disabled?: boolean
  command?: string
  args?: string[]
  env?: Record<string, string>
  url?: string
  headers?: Record<string, string>
}

function extractServers(
  config: Record<string, unknown>,
  scope: ResourceScope
): McpServerConfig[] {
  const servers = config.mcpServers as Record<string, RawMcpEntry> | undefined
  if (!servers || typeof servers !== 'object') return []

  return Object.entries(servers).map(([name, raw]) => {
    const serverType = (raw.type === 'http' || raw.type === 'sse' ? raw.type : 'stdio') as McpServerConfig['type']
    return {
      name,
      type: serverType,
      scope,
      disabled: raw.disabled ?? false,
      // stdio
      command: raw.command,
      args: raw.args,
      env: raw.env,
      // http
      url: raw.url,
      headers: raw.headers,
    }
  })
}

// --- Public API ---

export function listMcpConfigs(cwd: string): McpServerConfig[] {
  const seen = new Set<string>()
  const results: McpServerConfig[] = []

  const addFrom = (filePath: string, scope: ResourceScope): void => {
    for (const cfg of extractServers(readJsonFile(filePath), scope)) {
      if (!seen.has(cfg.name)) {
        seen.add(cfg.name)
        results.push(cfg)
      }
    }
  }

  // User-level: ~/.claude.json
  addFrom(getUserConfigPath(), 'user')

  // Project-level: {cwd}/.claude/settings.json
  addFrom(getProjectSettingsPath(cwd), 'project')

  // Project-level: {cwd}/.mcp.json
  addFrom(getProjectMcpJsonPath(cwd), 'project')

  return results
}

export function saveMcpConfig(
  name: string,
  config: Partial<Pick<McpServerConfig, 'type' | 'command' | 'args' | 'env' | 'url' | 'headers'>>,
  scope: ResourceScope,
  cwd: string
): void {
  const filePath = scope === 'user' ? getUserConfigPath() : getProjectMcpJsonPath(cwd)
  const data = readJsonFile(filePath)

  if (!data.mcpServers || typeof data.mcpServers !== 'object') {
    data.mcpServers = {}
  }
  const servers = data.mcpServers as Record<string, unknown>

  const entry: Record<string, unknown> = { type: config.type ?? 'stdio' }
  if (config.type === 'http' || config.type === 'sse') {
    entry.url = config.url ?? ''
    if (config.headers && Object.keys(config.headers).length > 0) {
      entry.headers = config.headers
    }
  } else {
    entry.command = config.command ?? ''
    entry.args = config.args ?? []
    if (config.env && Object.keys(config.env).length > 0) {
      entry.env = config.env
    }
  }
  servers[name] = entry

  writeJsonFile(filePath, data)
}

export function toggleMcpConfig(name: string, disabled: boolean, scope: ResourceScope, cwd: string): void {
  const filePaths = scope === 'user'
    ? [getUserConfigPath()]
    : [getProjectSettingsPath(cwd), getProjectMcpJsonPath(cwd)]

  for (const filePath of filePaths) {
    const data = readJsonFile(filePath)
    if (data.mcpServers && typeof data.mcpServers === 'object') {
      const servers = data.mcpServers as Record<string, RawMcpEntry>
      if (name in servers) {
        if (disabled) {
          servers[name].disabled = true
        } else {
          delete servers[name].disabled
        }
        writeJsonFile(filePath, data)
        return
      }
    }
  }
}

export function deleteMcpConfig(name: string, scope: ResourceScope, cwd: string): void {
  const filePaths = scope === 'user'
    ? [getUserConfigPath()]
    : [getProjectSettingsPath(cwd), getProjectMcpJsonPath(cwd)]

  for (const filePath of filePaths) {
    const data = readJsonFile(filePath)
    if (data.mcpServers && typeof data.mcpServers === 'object') {
      const servers = data.mcpServers as Record<string, unknown>
      if (name in servers) {
        delete servers[name]
        writeJsonFile(filePath, data)
        return
      }
    }
  }
}
