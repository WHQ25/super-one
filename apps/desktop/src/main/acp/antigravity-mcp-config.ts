import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'
import type { SuperoneMcpStdioConfig } from '../mcp/superone-mcp-stdio-state'
import {
  SUPERONE_MCP_EXPECTED_VARIANT_ENV,
  SUPERONE_MCP_IPC_ENDPOINT_ENV,
  SUPERONE_MCP_IPC_TOKEN_ENV,
  SUPERONE_MCP_SESSION_ID_ENV,
  SUPERONE_MCP_VARIANT_ENV,
} from '../mcp/superone-mcp-stdio-env'
import { variantId, type VariantId } from '../variant'

const SESSION_ENV_KEYS = new Set([
  SUPERONE_MCP_IPC_ENDPOINT_ENV,
  SUPERONE_MCP_IPC_TOKEN_ENV,
  SUPERONE_MCP_SESSION_ID_ENV,
])

export interface AntigravityMcpServerEntry {
  command: string
  args: string[]
  env?: Record<string, string>
}

export function antigravityGlobalSuperoneServerName(variant: VariantId = variantId()): string {
  return variant === 'stable' ? 'superone' : `superone-${variant}`
}

export function resolveAntigravityGlobalMcpConfigPath(homeDir = homedir()): string {
  return join(homeDir, '.gemini', 'config', 'mcp_config.json')
}

export function extractSuperoneSessionEnv(
  stdioConfig: SuperoneMcpStdioConfig,
  variant: VariantId = variantId(),
): Record<string, string> {
  const result: Record<string, string> = {
    [SUPERONE_MCP_VARIANT_ENV]: variant,
  }
  for (const key of SESSION_ENV_KEYS) {
    const val = stdioConfig.env[key]
    if (val) result[key] = val
  }
  return result
}

function buildGenericSuperoneEntry(
  stdioConfig: SuperoneMcpStdioConfig,
  variant: VariantId,
): AntigravityMcpServerEntry {
  const staticEnv: Record<string, string> = {
    [SUPERONE_MCP_EXPECTED_VARIANT_ENV]: variant,
  }
  for (const [key, val] of Object.entries(stdioConfig.env)) {
    if (!SESSION_ENV_KEYS.has(key) && val !== undefined) {
      staticEnv[key] = val
    }
  }
  return { command: stdioConfig.command, args: [...stdioConfig.args], env: staticEnv }
}

function entriesEqual(a: unknown, b: AntigravityMcpServerEntry): boolean {
  if (!a || typeof a !== 'object' || Array.isArray(a)) return false
  const rec = a as Record<string, unknown>
  if (rec.command !== b.command) return false
  if (!Array.isArray(rec.args) || rec.args.length !== b.args.length) return false
  if (!rec.args.every((item, idx) => item === b.args[idx])) return false
  const envA = rec.env && typeof rec.env === 'object' && !Array.isArray(rec.env)
    ? (rec.env as Record<string, unknown>)
    : undefined
  const keysA = envA ? Object.keys(envA).sort() : []
  const keysB = b.env ? Object.keys(b.env).sort() : []
  if (keysA.length !== keysB.length) return false
  return keysB.every((k, idx) => keysA[idx] === k && envA?.[k] === b.env?.[k])
}

export function ensureAntigravityGlobalSuperoneMcpConfig(
  stdioConfig: SuperoneMcpStdioConfig,
  homeDir = homedir(),
  variant: VariantId = variantId(),
): boolean {
  const configPath = resolveAntigravityGlobalMcpConfigPath(homeDir)
  let root: Record<string, unknown> = {}
  if (existsSync(configPath)) {
    try {
      const raw = readFileSync(configPath, 'utf8').trim()
      if (raw) {
        const parsed = JSON.parse(raw) as unknown
        if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return false
        root = parsed as Record<string, unknown>
      }
    } catch {
      return false
    }
  }

  const existingServers = root.mcpServers
  if (existingServers !== undefined && (!existingServers || typeof existingServers !== 'object' || Array.isArray(existingServers))) {
    return false
  }
  const mcpServers = { ...(existingServers as Record<string, unknown> | undefined) }
  const serverName = antigravityGlobalSuperoneServerName(variant)
  const desired = buildGenericSuperoneEntry(stdioConfig, variant)
  if (entriesEqual(mcpServers[serverName], desired)) return true

  mcpServers[serverName] = desired
  const nextRoot = { ...root, mcpServers }
  try {
    mkdirSync(dirname(configPath), { recursive: true })
    writeFileSync(configPath, `${JSON.stringify(nextRoot, null, 2)}\n`, 'utf8')
    return true
  } catch {
    return false
  }
}
