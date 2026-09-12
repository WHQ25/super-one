import { describe, expect, it } from 'vitest'
import {
  codexMcpResultHasAuthChallenge,
  readCodexMcpToolsError,
  readCodexMcpWwwAuthenticate,
} from './protocol-v154'

describe('protocol-v154 readers', () => {
  it('reads toolsError only when non-empty', () => {
    expect(readCodexMcpToolsError('discovery timed out')).toBe('discovery timed out')
    expect(readCodexMcpToolsError('')).toBeUndefined()
    expect(readCodexMcpToolsError(null)).toBeUndefined()
  })

  it('reads mcp/www_authenticate from tool result meta', () => {
    expect(readCodexMcpWwwAuthenticate({ 'mcp/www_authenticate': { realm: 'x' } }))
      .toEqual({ realm: 'x' })
    expect(readCodexMcpWwwAuthenticate({})).toBeUndefined()
  })

  it('detects an auth challenge only from www_authenticate meta', () => {
    expect(codexMcpResultHasAuthChallenge({
      meta: { 'mcp/www_authenticate': { authorizationUrl: 'https://auth' } },
    })).toBe(true)
    expect(codexMcpResultHasAuthChallenge({ meta: {} })).toBe(false)
    expect(codexMcpResultHasAuthChallenge(undefined)).toBe(false)
  })
})
