/**
 * Codex MCP config read/write (desktop codex-config-service parity).
 * Files: ~/.codex/config.toml and {cwd}/.codex/config.toml → mcp_servers.
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { homedir as osHomedir } from 'node:os'
import { parse, stringify } from 'smol-toml'
import type { McpServerConfig, ResourceScope } from '@superone/shared/agent-types'

export interface CodexMcpOptions {
  homeDir?: string
  codexHome?: string
}

interface TomlMcpServer {
  command?: string
  args?: string[]
  env?: Record<string, string>
  url?: string
  http_headers?: Record<string, string>
  enabled?: boolean
}

function homeOf(opts?: CodexMcpOptions): string {
  return opts?.homeDir ?? osHomedir()
}

function codexHomeOf(opts?: CodexMcpOptions): string {
  if (opts?.codexHome) return opts.codexHome
  const env = process.env.CODEX_HOME?.trim()
  return env || join(homeOf(opts), '.codex')
}

function getCodexConfigPath(
  scope: Extract<ResourceScope, 'user' | 'project'>,
  cwd: string,
  opts?: CodexMcpOptions,
): string {
  return scope === 'project'
    ? join(cwd, '.codex', 'config.toml')
    : join(codexHomeOf(opts), 'config.toml')
}

function readConfigFile(filePath: string): Record<string, unknown> {
  if (!existsSync(filePath)) return {}
  try {
    return parse(readFileSync(filePath, 'utf8')) as Record<string, unknown>
  } catch {
    return {}
  }
}

function writeConfigFile(filePath: string, data: Record<string, unknown>): void {
  mkdirSync(dirname(filePath), { recursive: true })
  writeFileSync(filePath, stringify(data), 'utf8')
}

function parseConfigFile(
  filePath: string,
  scope: Extract<ResourceScope, 'user' | 'project'>,
): McpServerConfig[] {
  const parsed = readConfigFile(filePath)
  const mcpServers = parsed.mcp_servers as Record<string, TomlMcpServer> | undefined
  if (!mcpServers || typeof mcpServers !== 'object') return []

  const configs: McpServerConfig[] = []
  for (const [name, server] of Object.entries(mcpServers)) {
    if (!server || typeof server !== 'object') continue
    const config = { name, scope } as McpServerConfig
    if (server.url) {
      config.type = 'http'
      config.url = server.url
      if (server.http_headers) config.headers = server.http_headers
    } else if (server.command) {
      config.type = 'stdio'
      config.command = server.command
      if (server.args) config.args = server.args
      if (server.env) config.env = server.env
    } else {
      continue
    }
    if (server.enabled === false) config.disabled = true
    configs.push(config)
  }
  return configs
}

export function listCodexMcpConfigs(cwd: string, opts?: CodexMcpOptions): McpServerConfig[] {
  const userConfigs = parseConfigFile(join(codexHomeOf(opts), 'config.toml'), 'user')
  const projectConfigs = parseConfigFile(join(cwd, '.codex', 'config.toml'), 'project')
  const merged = new Map<string, McpServerConfig>()
  for (const config of userConfigs) merged.set(config.name, config)
  for (const config of projectConfigs) merged.set(config.name, config)
  return Array.from(merged.values())
}

function assertServerName(name: string): void {
  if (!name || name.length > 128 || !/^[a-zA-Z0-9][a-zA-Z0-9._-]*$/.test(name)) {
    throw Object.assign(new Error('invalid MCP server name'), { code: 'invalid_argument' })
  }
}

export function saveCodexMcpConfig(
  name: string,
  config: Partial<Pick<McpServerConfig, 'type' | 'command' | 'args' | 'env' | 'url' | 'headers'>>,
  scope: Extract<ResourceScope, 'user' | 'project'>,
  cwd: string,
  opts?: CodexMcpOptions,
): void {
  assertServerName(name)
  const filePath = getCodexConfigPath(scope, cwd, opts)
  const data = readConfigFile(filePath)
  const mcpServers = (
    data.mcp_servers && typeof data.mcp_servers === 'object' ? data.mcp_servers : {}
  ) as Record<string, TomlMcpServer>

  if (config.type === 'http' || config.type === 'sse') {
    if (!config.url || typeof config.url !== 'string') {
      throw Object.assign(new Error('http/sse MCP requires url'), { code: 'invalid_argument' })
    }
    mcpServers[name] = {
      url: config.url,
      ...(config.headers && Object.keys(config.headers).length > 0
        ? { http_headers: config.headers }
        : {}),
    }
  } else {
    if (!config.command || typeof config.command !== 'string') {
      throw Object.assign(new Error('stdio MCP requires command'), { code: 'invalid_argument' })
    }
    mcpServers[name] = {
      command: config.command,
      args: config.args ?? [],
      ...(config.env && Object.keys(config.env).length > 0 ? { env: config.env } : {}),
    }
  }

  data.mcp_servers = mcpServers
  writeConfigFile(filePath, data)
}

export function toggleCodexMcpConfig(
  name: string,
  disabled: boolean,
  scope: Extract<ResourceScope, 'user' | 'project'>,
  cwd: string,
  opts?: CodexMcpOptions,
): void {
  assertServerName(name)
  const filePath = getCodexConfigPath(scope, cwd, opts)
  const data = readConfigFile(filePath)
  const mcpServers = data.mcp_servers as Record<string, TomlMcpServer> | undefined
  if (!mcpServers?.[name]) {
    throw Object.assign(new Error(`MCP server not found: ${name}`), { code: 'not_found' })
  }
  mcpServers[name]!.enabled = !disabled
  writeConfigFile(filePath, data)
}

export function deleteCodexMcpConfig(
  name: string,
  scope: Extract<ResourceScope, 'user' | 'project'>,
  cwd: string,
  opts?: CodexMcpOptions,
): void {
  assertServerName(name)
  const filePath = getCodexConfigPath(scope, cwd, opts)
  const data = readConfigFile(filePath)
  const mcpServers = data.mcp_servers as Record<string, TomlMcpServer> | undefined
  if (!mcpServers?.[name]) {
    throw Object.assign(new Error(`MCP server not found: ${name}`), { code: 'not_found' })
  }
  delete mcpServers[name]
  if (Object.keys(mcpServers).length === 0) {
    delete data.mcp_servers
  }
  writeConfigFile(filePath, data)
}
