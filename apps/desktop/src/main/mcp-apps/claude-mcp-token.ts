import { createHash } from 'node:crypto'
import { findClaudeCredentialStore, type ClaudeCredentialData } from '../agent/claude-credential-store'
import type { HostClientConfig, HostClientToken } from './host-client'

/**
 * Claude CLI's own MCP OAuth tokens, read only. SuperOne never refreshes or
 * writes them: the refresh token rotates, so a second writer signs Claude
 * out. The `mcpOAuth` layout is internal to the CLI and was checked against
 * the CLI shipped with this SDK version; a version test fails on a bump so it
 * is checked again. A layout that no longer matches reads as "not signed in".
 */
export const CLAUDE_MCP_OAUTH_VERIFIED_SDK = '0.3.293'

type HttpConfig = Extract<HostClientConfig, { type: 'http' | 'sse' }>

/** The CLI's `mcpOAuth` key: server name, then 16 hex chars of SHA-256 over type, url and headers. */
export function claudeMcpOAuthKey(server: string, config: HttpConfig): string {
  const hash = createHash('sha256').update(JSON.stringify({ type: config.type, url: config.url, headers: config.headers })).digest('hex').slice(0, 16)
  return `${server}|${hash}`
}

const record = (value: unknown): Record<string, unknown> | undefined =>
  value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : undefined

function token(entry: unknown): HostClientToken | null {
  const value = record(entry)
  if (typeof value?.accessToken !== 'string' || !value.accessToken) return null
  return { accessToken: value.accessToken, ...(typeof value.expiresAt === 'number' ? { expiresAt: value.expiresAt } : {}) }
}

/**
 * The token Claude stored for this server. The exact key first; otherwise the
 * single entry for this server name and URL, so an encoding detail of the
 * key's hash cannot hide it. Several such entries are ambiguous: none is used.
 */
export function claudeMcpTokenFrom(data: ClaudeCredentialData, server: string, config: HttpConfig): HostClientToken | null {
  const entries = record(data.mcpOAuth)
  if (!entries) return null
  const exact = record(entries[claudeMcpOAuthKey(server, config)])
  // The key hashes the URL; a stored URL that disagrees is not this server's token.
  if (exact) return exact.serverUrl === undefined || exact.serverUrl === config.url ? token(exact) : null
  const matches = Object.values(entries).filter(entry => record(entry)?.serverName === server && record(entry)?.serverUrl === config.url)
  return matches.length === 1 ? token(matches[0]) : null
}

/** From the session's credential domain (`null`: the CLI's default). */
export function readClaudeMcpToken(credentialDir: string | null, server: string, config: HttpConfig): HostClientToken | null {
  let found: HostClientToken | null = null
  findClaudeCredentialStore(credentialDir, data => (found = claudeMcpTokenFrom(data, server, config)) !== null)
  return found
}
