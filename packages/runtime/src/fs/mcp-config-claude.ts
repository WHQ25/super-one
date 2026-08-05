/**
 * Claude MCP config read/write (desktop mcp-config-service parity).
 *
 * Sources:
 *   User:    ~/.claude.json → mcpServers
 *   Project: {cwd}/.claude/settings.json → mcpServers
 *            {cwd}/.mcp.json → mcpServers
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { homedir as osHomedir } from 'node:os'
import type { McpServerConfig, ResourceScope } from '@superone/shared/agent-types'

export interface ClaudeMcpOptions {
  homeDir?: string
}

function homeOf(opts?: ClaudeMcpOptions): string {
  return opts?.homeDir ?? osHomedir()
}

function getUserConfigPath(opts?: ClaudeMcpOptions): string {
  return join(homeOf(opts), '.claude.json')
}

function getProjectSettingsPath(cwd: string): string {
  return join(cwd, '.claude', 'settings.json')
}

function getProjectMcpJsonPath(cwd: string): string {
  return join(cwd, '.mcp.json')
}

function readJsonFile(filePath: string): Record<string, unknown> {
  if (!existsSync(filePath)) return {}
  try {
    return JSON.parse(readFileSync(filePath, 'utf8')) as Record<string, unknown>
  } catch {
    return {}
  }
}

function writeJsonFile(filePath: string, data: Record<string, unknown>): void {
  mkdirSync(dirname(filePath), { recursive: true })
  writeFileSync(filePath, JSON.stringify(data, null, 2) + '\n', 'utf8')
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
  scope: Extract<ResourceScope, 'user' | 'project'>,
): McpServerConfig[] {
  const servers = config.mcpServers as Record<string, RawMcpEntry> | undefined
  if (!servers || typeof servers !== 'object') return []

  return Object.entries(servers).map(([name, raw]) => {
    const serverType = (
      raw?.type === 'http' || raw?.type === 'sse' ? raw.type : 'stdio'
    ) as McpServerConfig['type']
    return {
      name,
      type: serverType,
      scope,
      disabled: raw?.disabled ?? false,
      command: raw?.command,
      args: raw?.args,
      env: raw?.env,
      url: raw?.url,
      headers: raw?.headers,
    }
  })
}

export function listClaudeMcpConfigs(cwd: string, opts?: ClaudeMcpOptions): McpServerConfig[] {
  const seen = new Set<string>()
  const results: McpServerConfig[] = []

  const addFrom = (filePath: string, scope: Extract<ResourceScope, 'user' | 'project'>): void => {
    for (const cfg of extractServers(readJsonFile(filePath), scope)) {
      if (!seen.has(cfg.name)) {
        seen.add(cfg.name)
        results.push(cfg)
      }
    }
  }

  addFrom(getUserConfigPath(opts), 'user')
  addFrom(getProjectSettingsPath(cwd), 'project')
  addFrom(getProjectMcpJsonPath(cwd), 'project')
  return results
}

function assertServerName(name: string): void {
  if (!name || name.length > 128 || !/^[a-zA-Z0-9][a-zA-Z0-9._-]*$/.test(name)) {
    throw Object.assign(new Error('invalid MCP server name'), { code: 'invalid_argument' })
  }
}

/**
 * Authorize project-scope .mcp.json servers in ~/.claude.json so the Agent SDK
 * treats them as user-approved (desktop parity).
 */
function authorizeProjectMcpServer(name: string, cwd: string, opts?: ClaudeMcpOptions): void {
  const filePath = getUserConfigPath(opts)
  const data = readJsonFile(filePath)

  if (!data.projects || typeof data.projects !== 'object') {
    data.projects = {}
  }
  const projects = data.projects as Record<string, Record<string, unknown>>
  if (!projects[cwd] || typeof projects[cwd] !== 'object') {
    projects[cwd] = {}
  }
  const project = projects[cwd]!

  const enabled = Array.isArray(project.enabledMcpjsonServers)
    ? [...(project.enabledMcpjsonServers as string[])]
    : []
  if (!enabled.includes(name)) enabled.push(name)
  project.enabledMcpjsonServers = enabled

  const disabled = Array.isArray(project.disabledMcpjsonServers)
    ? (project.disabledMcpjsonServers as unknown[]).filter((n) => n !== name)
    : []
  project.disabledMcpjsonServers = disabled

  writeJsonFile(filePath, data)
}

export function saveClaudeMcpConfig(
  name: string,
  config: Partial<Pick<McpServerConfig, 'type' | 'command' | 'args' | 'env' | 'url' | 'headers'>>,
  scope: Extract<ResourceScope, 'user' | 'project'>,
  cwd: string,
  opts?: ClaudeMcpOptions,
): void {
  assertServerName(name)
  const filePath = scope === 'user' ? getUserConfigPath(opts) : getProjectMcpJsonPath(cwd)
  const data = readJsonFile(filePath)

  if (!data.mcpServers || typeof data.mcpServers !== 'object') {
    data.mcpServers = {}
  }
  const servers = data.mcpServers as Record<string, unknown>

  const entry: Record<string, unknown> = { type: config.type ?? 'stdio' }
  if (config.type === 'http' || config.type === 'sse') {
    if (!config.url || typeof config.url !== 'string') {
      throw Object.assign(new Error('http/sse MCP requires url'), { code: 'invalid_argument' })
    }
    entry.url = config.url
    if (config.headers && Object.keys(config.headers).length > 0) {
      entry.headers = config.headers
    }
  } else {
    if (!config.command || typeof config.command !== 'string') {
      throw Object.assign(new Error('stdio MCP requires command'), { code: 'invalid_argument' })
    }
    entry.command = config.command
    entry.args = config.args ?? []
    if (config.env && Object.keys(config.env).length > 0) {
      entry.env = config.env
    }
  }
  servers[name] = entry
  writeJsonFile(filePath, data)

  if (scope === 'project') {
    authorizeProjectMcpServer(name, cwd, opts)
  }
}

export function toggleClaudeMcpConfig(
  name: string,
  disabled: boolean,
  scope: Extract<ResourceScope, 'user' | 'project'>,
  cwd: string,
  opts?: ClaudeMcpOptions,
): void {
  assertServerName(name)
  const filePaths =
    scope === 'user'
      ? [getUserConfigPath(opts)]
      : [getProjectSettingsPath(cwd), getProjectMcpJsonPath(cwd)]

  for (const filePath of filePaths) {
    const data = readJsonFile(filePath)
    if (data.mcpServers && typeof data.mcpServers === 'object') {
      const servers = data.mcpServers as Record<string, RawMcpEntry>
      if (name in servers) {
        if (disabled) {
          servers[name]!.disabled = true
        } else {
          delete servers[name]!.disabled
        }
        writeJsonFile(filePath, data)
        return
      }
    }
  }
  throw Object.assign(new Error(`MCP server not found: ${name}`), { code: 'not_found' })
}

export function deleteClaudeMcpConfig(
  name: string,
  scope: Extract<ResourceScope, 'user' | 'project'>,
  cwd: string,
  opts?: ClaudeMcpOptions,
): void {
  assertServerName(name)
  const filePaths =
    scope === 'user'
      ? [getUserConfigPath(opts)]
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
  throw Object.assign(new Error(`MCP server not found: ${name}`), { code: 'not_found' })
}
