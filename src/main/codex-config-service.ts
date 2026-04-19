import { dirname, join } from 'path'
import { homedir } from 'os'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs'
import { parse, stringify } from 'smol-toml'
import type { McpServerConfig, ResourceScope } from '../shared/agent-types'

interface TomlMcpServer {
  command?: string
  args?: string[]
  env?: Record<string, string>
  url?: string
  http_headers?: Record<string, string>
  enabled?: boolean
}

function getCodexConfigPath(scope: ResourceScope, cwd: string): string {
  return scope === 'project'
    ? join(cwd, '.codex', 'config.toml')
    : join(homedir(), '.codex', 'config.toml')
}

function readConfigFile(filePath: string): Record<string, unknown> {
  if (!existsSync(filePath)) return {}

  try {
    return parse(readFileSync(filePath, 'utf-8')) as Record<string, unknown>
  } catch {
    return {}
  }
}

function writeConfigFile(filePath: string, data: Record<string, unknown>): void {
  mkdirSync(dirname(filePath), { recursive: true })
  writeFileSync(filePath, stringify(data), 'utf-8')
}

function parseConfigFile(filePath: string, scope: ResourceScope): McpServerConfig[] {
  const parsed = readConfigFile(filePath)

  const mcpServers = parsed.mcp_servers as Record<string, TomlMcpServer> | undefined
  if (!mcpServers || typeof mcpServers !== 'object') return []

  const configs: McpServerConfig[] = []

  for (const [name, server] of Object.entries(mcpServers)) {
    if (!server || typeof server !== 'object') continue

    const config: McpServerConfig = { name, scope } as McpServerConfig

    if (server.url) {
      config.type = 'http'
      config.url = server.url
      if (server.http_headers) {
        config.headers = server.http_headers
      }
    } else if (server.command) {
      config.type = 'stdio'
      config.command = server.command
      if (server.args) config.args = server.args
      if (server.env) config.env = server.env
    } else {
      continue
    }

    if (server.enabled === false) {
      config.disabled = true
    }

    configs.push(config)
  }

  return configs
}

export function listCodexMcpConfigs(cwd: string): McpServerConfig[] {
  const userConfigs = parseConfigFile(join(homedir(), '.codex', 'config.toml'), 'user')
  const projectConfigs = parseConfigFile(join(cwd, '.codex', 'config.toml'), 'project')

  // Project configs override user configs with the same name
  const merged = new Map<string, McpServerConfig>()
  for (const config of userConfigs) {
    merged.set(config.name, config)
  }
  for (const config of projectConfigs) {
    merged.set(config.name, config)
  }

  return Array.from(merged.values())
}

export function saveCodexMcpConfig(
  name: string,
  config: Partial<Pick<McpServerConfig, 'type' | 'command' | 'args' | 'env' | 'url' | 'headers'>>,
  scope: ResourceScope,
  cwd: string,
): void {
  const filePath = getCodexConfigPath(scope, cwd)
  const data = readConfigFile(filePath)
  const mcpServers = (
    data.mcp_servers && typeof data.mcp_servers === 'object'
      ? data.mcp_servers
      : {}
  ) as Record<string, TomlMcpServer>

  if (config.type === 'http' || config.type === 'sse') {
    mcpServers[name] = {
      url: config.url ?? '',
      ...(config.headers && Object.keys(config.headers).length > 0 ? { http_headers: config.headers } : {}),
    }
  } else {
    mcpServers[name] = {
      command: config.command ?? '',
      args: config.args ?? [],
      ...(config.env && Object.keys(config.env).length > 0 ? { env: config.env } : {}),
    }
  }

  data.mcp_servers = mcpServers
  writeConfigFile(filePath, data)
}

export function toggleCodexMcpConfig(name: string, disabled: boolean, scope: ResourceScope, cwd: string): void {
  const filePath = getCodexConfigPath(scope, cwd)
  const data = readConfigFile(filePath)
  const mcpServers = data.mcp_servers as Record<string, TomlMcpServer> | undefined
  if (!mcpServers?.[name]) return

  if (disabled) {
    mcpServers[name].enabled = false
  } else {
    mcpServers[name].enabled = true
  }

  writeConfigFile(filePath, data)
}

export function deleteCodexMcpConfig(name: string, scope: ResourceScope, cwd: string): void {
  const filePath = getCodexConfigPath(scope, cwd)
  const data = readConfigFile(filePath)
  const mcpServers = data.mcp_servers as Record<string, TomlMcpServer> | undefined
  if (!mcpServers?.[name]) return

  delete mcpServers[name]
  if (Object.keys(mcpServers).length === 0) {
    delete data.mcp_servers
  }

  writeConfigFile(filePath, data)
}
