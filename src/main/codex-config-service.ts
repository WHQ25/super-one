import { join } from 'path'
import { homedir } from 'os'
import { existsSync, readFileSync } from 'fs'
import { parse } from 'smol-toml'
import type { McpServerConfig, ResourceScope } from '../shared/agent-types'

interface TomlMcpServer {
  command?: string
  args?: string[]
  env?: Record<string, string>
  url?: string
  http_headers?: Record<string, string>
  enabled?: boolean
}

function parseConfigFile(filePath: string, scope: ResourceScope): McpServerConfig[] {
  if (!existsSync(filePath)) return []

  let content: string
  try {
    content = readFileSync(filePath, 'utf-8')
  } catch {
    return []
  }

  let parsed: Record<string, unknown>
  try {
    parsed = parse(content) as Record<string, unknown>
  } catch {
    return []
  }

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
