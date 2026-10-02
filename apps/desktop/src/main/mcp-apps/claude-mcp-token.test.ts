import { readFileSync } from 'node:fs'
import { describe, expect, it, vi } from 'vitest'

vi.mock('../logger', () => ({ default: { warn: () => undefined } }))
import { CLAUDE_MCP_OAUTH_VERIFIED_SDK, claudeMcpOAuthKey, claudeMcpTokenFrom } from './claude-mcp-token'

const config = { type: 'http' as const, url: 'https://mcp.example.com/mcp', headers: {} }

describe('claudeMcpTokenFrom', () => {
  it('derives the CLI key from server name, type, url and headers', () => {
    expect(claudeMcpOAuthKey('linear', config)).toMatch(/^linear\|[0-9a-f]{16}$/)
    expect(claudeMcpOAuthKey('linear', { ...config, headers: { 'X-Team': 'a' } })).not.toBe(claudeMcpOAuthKey('linear', config))
  })

  it('reads the entry under the exact key', () => {
    const data = { mcpOAuth: { [claudeMcpOAuthKey('linear', config)]: { serverName: 'linear', serverUrl: config.url, accessToken: 'at', refreshToken: 'rt', expiresAt: 42 } } }
    expect(claudeMcpTokenFrom(data, 'linear', config)).toEqual({ accessToken: 'at', expiresAt: 42 })
  })

  it('refuses an exact-key entry stored for another URL', () => {
    const data = { mcpOAuth: { [claudeMcpOAuthKey('linear', config)]: { serverName: 'linear', serverUrl: 'https://evil.example.com/mcp', accessToken: 'at' } } }
    expect(claudeMcpTokenFrom(data, 'linear', config)).toBeNull()
  })

  it('falls back to the single entry for the same server and url, never guesses between several', () => {
    const entry = (accessToken: string) => ({ serverName: 'linear', serverUrl: config.url, accessToken })
    expect(claudeMcpTokenFrom({ mcpOAuth: { 'linear|0000000000000000': entry('at') } }, 'linear', config)).toEqual({ accessToken: 'at' })
    expect(claudeMcpTokenFrom({ mcpOAuth: { 'linear|a': entry('a'), 'linear|b': entry('b') } }, 'linear', config)).toBeNull()
    expect(claudeMcpTokenFrom({ mcpOAuth: { 'other|a': { serverName: 'other', serverUrl: config.url, accessToken: 'x' } } }, 'linear', config)).toBeNull()
  })

  it('reads a cleared or foreign layout as not signed in', () => {
    expect(claudeMcpTokenFrom({ mcpOAuth: { [claudeMcpOAuthKey('linear', config)]: { accessToken: '' } } }, 'linear', config)).toBeNull()
    expect(claudeMcpTokenFrom({ mcpOAuth: 'x' }, 'linear', config)).toBeNull()
    expect(claudeMcpTokenFrom({ claudeAiOauth: { accessToken: 'account' } }, 'linear', config)).toBeNull()
  })

  it('is pinned to the SDK version whose credential layout was checked', () => {
    const manifest = JSON.parse(readFileSync(new URL('../../../../../packages/claude/package.json', import.meta.url), 'utf8')) as { dependencies: Record<string, string> }
    // On failure: check the bundled CLI's `mcpOAuth` key and fields again, then update the constant.
    expect(manifest.dependencies['@anthropic-ai/claude-agent-sdk']).toBe(CLAUDE_MCP_OAUTH_VERIFIED_SDK)
  })
})
