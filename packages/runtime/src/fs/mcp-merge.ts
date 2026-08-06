/**
 * Merge enabled user/project MCP configs into harness turn options.
 *
 * Security model (node-hosted Claude / Codex):
 *
 * - **merge** (default): attach host-action `superone` plus every *enabled*
 *   user/project MCP from disk. Claude still uses `strictMcpConfig: true` so
 *   the SDK does **not** auto-load extra project `.mcp.json` / plugins — only
 *   the explicit allowlist we pass. Codex receives the same set as
 *   `config.mcp_servers`.
 * - **host-action-only**: only the SuperOne host-action MCP (if present).
 *   Opt in with env `SUPERONE_MCP_MERGE=0|false|off|host-action-only`, or by
 *   passing `mode: 'host-action-only'` to {@link ensureMcpMerge}.
 *
 * Name `superone` is reserved for host-action and is never taken from disk.
 */

import type { McpServerConfig } from '@superone/shared/agent-types'
import type { ResourceProvider } from '@superone/shared/environment'
import { listMcpConfigs, type McpManageOptions } from './mcp-config'

/** Host-action MCP server name — reserved; never overwritten by disk configs. */
export const HOST_ACTION_MCP_NAME = 'superone'

export type McpMergeMode = 'merge' | 'host-action-only'

export type ClaudeSdkMcpEntry =
  | { type?: 'stdio'; command: string; args?: string[]; env?: Record<string, string> }
  | { type: 'http'; url: string; headers?: Record<string, string> }
  | { type: 'sse'; url: string; headers?: Record<string, string> }
  | { type: 'sdk'; name: string; instance?: unknown }
  | Record<string, unknown>

/** Codex app-server `config.mcp_servers.<name>` entry (stdio or HTTP). */
export type CodexThreadMcpEntry =
  | {
      command: string
      args?: string[]
      env?: Record<string, string>
      enabled?: boolean
    }
  | {
      url: string
      http_headers?: Record<string, string>
      startup_timeout_sec?: number
      enabled?: boolean
    }
  | Record<string, unknown>

export interface EnsureMcpMergeOptions extends McpManageOptions {
  provider: ResourceProvider
  cwd: string
  /**
   * Host-action (or other) servers already built for this turn.
   * Keys win over disk configs with the same name.
   */
  hostActionServers?: Record<string, ClaudeSdkMcpEntry | CodexThreadMcpEntry>
  /**
   * Override merge mode. When omitted, resolved from `env` / process.env.
   */
  mode?: McpMergeMode
  env?: NodeJS.ProcessEnv
  /**
   * Additional reserved names that must not be taken from disk (defaults: superone).
   */
  reservedNames?: string[]
}

export interface EnsureMcpMergeResult {
  mode: McpMergeMode
  /** Claude Agent SDK `options.mcpServers` shape (also usable as a plain map). */
  claudeMcpServers: Record<string, ClaudeSdkMcpEntry>
  /** Codex `threadConfig.mcp_servers` shape. */
  codexMcpServers: Record<string, CodexThreadMcpEntry>
  /** Names loaded from disk (enabled only; excludes reserved). */
  diskNames: string[]
  /**
   * Always true when any server is present — dual-mode allowlist:
   * host-action + explicitly merged enabled disk servers only.
   */
  strictMcpConfig: boolean
}

/**
 * Resolve merge mode from env.
 * `SUPERONE_MCP_MERGE=0|false|off|host-action-only` → host-action-only.
 * Anything else (including unset) → merge.
 */
export function resolveMcpMergeMode(env: NodeJS.ProcessEnv = process.env): McpMergeMode {
  const raw = (env.SUPERONE_MCP_MERGE ?? '').trim().toLowerCase()
  if (raw === '0' || raw === 'false' || raw === 'off' || raw === 'host-action-only') {
    return 'host-action-only'
  }
  return 'merge'
}

/** Convert a disk McpServerConfig into Claude Agent SDK mcpServers entry. */
export function toClaudeSdkMcpEntry(cfg: McpServerConfig): ClaudeSdkMcpEntry | null {
  if (cfg.disabled) return null
  if (cfg.type === 'http') {
    if (!cfg.url) return null
    return {
      type: 'http',
      url: cfg.url,
      ...(cfg.headers && Object.keys(cfg.headers).length > 0 ? { headers: cfg.headers } : {}),
    }
  }
  if (cfg.type === 'sse') {
    if (!cfg.url) return null
    return {
      type: 'sse',
      url: cfg.url,
      ...(cfg.headers && Object.keys(cfg.headers).length > 0 ? { headers: cfg.headers } : {}),
    }
  }
  // stdio (default)
  if (!cfg.command) return null
  return {
    type: 'stdio',
    command: cfg.command,
    ...(cfg.args && cfg.args.length > 0 ? { args: cfg.args } : {}),
    ...(cfg.env && Object.keys(cfg.env).length > 0 ? { env: cfg.env } : {}),
  }
}

/** Convert a disk McpServerConfig into Codex thread mcp_servers entry. */
export function toCodexThreadMcpEntry(cfg: McpServerConfig): CodexThreadMcpEntry | null {
  if (cfg.disabled) return null
  if (cfg.type === 'http' || cfg.type === 'sse') {
    if (!cfg.url) return null
    return {
      url: cfg.url,
      ...(cfg.headers && Object.keys(cfg.headers).length > 0
        ? { http_headers: cfg.headers }
        : {}),
    }
  }
  if (!cfg.command) return null
  return {
    command: cfg.command,
    ...(cfg.args && cfg.args.length > 0 ? { args: cfg.args } : {}),
    ...(cfg.env && Object.keys(cfg.env).length > 0 ? { env: cfg.env } : {}),
  }
}

/**
 * Build harness MCP maps: host-action servers + (optionally) enabled disk configs.
 *
 * Prefer this over letting Claude SDK auto-load `.mcp.json` when host-action is
 * present — that path used `strictMcpConfig: true` and dropped user MCP entirely.
 */
export function ensureMcpMerge(opts: EnsureMcpMergeOptions): EnsureMcpMergeResult {
  const mode = opts.mode ?? resolveMcpMergeMode(opts.env ?? process.env)
  const reserved = new Set(
    [HOST_ACTION_MCP_NAME, ...(opts.reservedNames ?? [])].map((n) => n.toLowerCase()),
  )

  const host = { ...(opts.hostActionServers ?? {}) } as Record<string, ClaudeSdkMcpEntry>
  const claudeMcpServers: Record<string, ClaudeSdkMcpEntry> = { ...host }
  const codexMcpServers: Record<string, CodexThreadMcpEntry> = {}
  for (const [name, entry] of Object.entries(host)) {
    codexMcpServers[name] = entry as CodexThreadMcpEntry
  }

  const diskNames: string[] = []

  if (mode === 'merge') {
    const listed = listMcpConfigs(opts.provider, opts.cwd, {
      homeDir: opts.homeDir,
      codexHome: opts.codexHome,
    })
    for (const cfg of listed) {
      if (cfg.disabled) continue
      if (reserved.has(cfg.name.toLowerCase())) continue
      // Host-action (or prior) wins on name collision.
      if (cfg.name in claudeMcpServers) continue

      if (opts.provider === 'codex') {
        const entry = toCodexThreadMcpEntry(cfg)
        if (!entry) continue
        codexMcpServers[cfg.name] = entry
        claudeMcpServers[cfg.name] = entry as ClaudeSdkMcpEntry
        diskNames.push(cfg.name)
      } else {
        const entry = toClaudeSdkMcpEntry(cfg)
        if (!entry) continue
        claudeMcpServers[cfg.name] = entry
        codexMcpServers[cfg.name] = entry as CodexThreadMcpEntry
        diskNames.push(cfg.name)
      }
    }
  }

  const hasAny = Object.keys(claudeMcpServers).length > 0
  return {
    mode,
    claudeMcpServers,
    codexMcpServers,
    diskNames,
    // Dual-mode allowlist: only servers we put in the map (never silent disk load).
    strictMcpConfig: hasAny,
  }
}
