import { createHmac, timingSafeEqual } from 'crypto'

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
  return actualBuffer.length === expectedBuffer.length
    && timingSafeEqual(actualBuffer, expectedBuffer)
}
