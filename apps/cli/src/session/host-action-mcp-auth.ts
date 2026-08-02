/**
 * Host Action MCP auth — mirrors desktop `superone-mcp-auth.ts` so the
 * `{ url, headers }` config shape is identical for all harnesses.
 */
import { createHmac, timingSafeEqual } from 'node:crypto'

export const SUPERONE_MCP_SESSION_HEADER = 'X-SuperOne-Session-Id'

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
