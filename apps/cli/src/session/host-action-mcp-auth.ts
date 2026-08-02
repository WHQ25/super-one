/**
 * Host Action MCP auth + harness config builders.
 *
 * Mirrors desktop `superone-mcp-auth.ts` / stdio-state helpers so
 * `{ url, headers }` (and Codex `http_headers`) shapes stay identical.
 */
import { createHmac, timingSafeEqual } from 'node:crypto'
import { HOST_ACTION_MCP_NAME } from './host-action-mcp-core'

export const SUPERONE_MCP_SESSION_HEADER = 'X-SuperOne-Session-Id'

/** Codex aborts MCP startup after this many seconds (matches desktop). */
export const SUPERONE_MCP_STARTUP_TIMEOUT_SEC = 60

export function deriveSuperoneMcpSessionToken(masterToken: string, sessionId: string): string {
  return createHmac('sha256', masterToken).update(sessionId).digest('base64url')
}

export function isValidSuperoneMcpSessionToken(
  masterToken: string,
  sessionId: string,
  candidate: string | null,
): boolean {
  if (!candidate) return false
  const expected = deriveSuperoneMcpSessionToken(masterToken, sessionId)
  const actualBuffer = Buffer.from(candidate)
  const expectedBuffer = Buffer.from(expected)
  return (
    actualBuffer.length === expectedBuffer.length && timingSafeEqual(actualBuffer, expectedBuffer)
  )
}

/** Config shape matching desktop `SuperoneMcpHttpConfig` — harnesses consume identically. */
export interface SuperoneMcpHttpConfig {
  url: string
  headers: Record<string, string>
}

/** Codex app-server `config.mcp_servers.superone` entry. */
export interface CodexSuperoneMcpConfig {
  url: string
  http_headers: Record<string, string>
  startup_timeout_sec: number
}

/** OpenCode `mcp.add` remote config. */
export interface OpenCodeSuperoneMcpConfig {
  type: 'remote'
  url: string
  headers: Record<string, string>
  enabled: true
}

/** ACP session/new HTTP MCP server descriptor. */
export interface AcpSuperoneMcpServer {
  type: 'http'
  name: string
  url: string
  headers: Array<{ name: string; value: string }>
}

export function buildSuperoneMcpHttpConfig(
  httpUrl: string,
  masterToken: string,
  sessionId: string,
): SuperoneMcpHttpConfig {
  const sessionToken = deriveSuperoneMcpSessionToken(masterToken, sessionId)
  return {
    url: httpUrl,
    headers: {
      Authorization: `Bearer ${sessionToken}`,
      [SUPERONE_MCP_SESSION_HEADER]: sessionId,
    },
  }
}

export function buildCodexSuperoneMcpConfig(
  httpUrl: string,
  masterToken: string,
  sessionId: string,
): CodexSuperoneMcpConfig {
  const base = buildSuperoneMcpHttpConfig(httpUrl, masterToken, sessionId)
  return {
    url: base.url,
    http_headers: base.headers,
    startup_timeout_sec: SUPERONE_MCP_STARTUP_TIMEOUT_SEC,
  }
}

export function buildOpenCodeSuperoneMcpConfig(
  httpUrl: string,
  masterToken: string,
  sessionId: string,
): OpenCodeSuperoneMcpConfig {
  const base = buildSuperoneMcpHttpConfig(httpUrl, masterToken, sessionId)
  return {
    type: 'remote',
    url: base.url,
    headers: base.headers,
    enabled: true,
  }
}

export function buildAcpSuperoneMcpServer(
  httpUrl: string,
  masterToken: string,
  sessionId: string,
): AcpSuperoneMcpServer {
  const base = buildSuperoneMcpHttpConfig(httpUrl, masterToken, sessionId)
  return {
    type: 'http',
    name: HOST_ACTION_MCP_NAME,
    url: base.url,
    headers: Object.entries(base.headers).map(([name, value]) => ({ name, value })),
  }
}

/** Claude Agent SDK `options.mcpServers` HTTP entry (fallback / non-SDK path). */
export function buildClaudeHttpMcpServers(
  httpUrl: string,
  masterToken: string,
  sessionId: string,
): Record<string, { type: 'http'; url: string; headers: Record<string, string> }> {
  const cfg = buildSuperoneMcpHttpConfig(httpUrl, masterToken, sessionId)
  return {
    [HOST_ACTION_MCP_NAME]: {
      type: 'http' as const,
      url: cfg.url,
      headers: cfg.headers,
    },
  }
}
