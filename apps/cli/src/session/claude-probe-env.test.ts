import { afterEach, describe, expect, it, vi } from 'vitest'
import { CLAUDE_CLI_ACCOUNT_PROVIDER_ID } from '@superone/shared/agent-types'
import { claudeAccountProbeEnv, claudeCatalogCacheScope } from './claude-probe-env'

afterEach(() => {
  vi.unstubAllEnvs()
})

describe('claudeAccountProbeEnv', () => {
  it('returns undefined unless the id is a Claude account', () => {
    expect(claudeAccountProbeEnv(null)).toBeUndefined()
    expect(claudeAccountProbeEnv(undefined)).toBeUndefined()
    expect(claudeAccountProbeEnv('custom:empty')).toBeUndefined()
    expect(claudeAccountProbeEnv('claude-account:')).toBeUndefined()
  })

  it('copies the process environment and overlays a managed account', () => {
    vi.stubEnv('PATH', '/usr/bin')
    vi.stubEnv('HOME', '/Users/test')
    vi.stubEnv('ANTHROPIC_API_KEY', 'sk-secret')
    vi.stubEnv('ANTHROPIC_AUTH_TOKEN', 'auth-token')
    vi.stubEnv('ANTHROPIC_BASE_URL', 'https://proxy.example')
    vi.stubEnv('CLAUDE_CODE_OAUTH_TOKEN', 'oauth-token')
    vi.stubEnv('CLAUDE_CONFIG_DIR', '/inherited')

    const env = claudeAccountProbeEnv('claude-account:/accounts/work')

    expect(env?.PATH).toBe('/usr/bin')
    expect(env?.HOME).toBe('/Users/test')
    expect(env).toMatchObject({
      CLAUDE_CONFIG_DIR: '/accounts/work',
      CLAUDE_SECURESTORAGE_CONFIG_DIR: '/accounts/work',
      ANTHROPIC_API_KEY: '',
      ANTHROPIC_AUTH_TOKEN: '',
      ANTHROPIC_BASE_URL: '',
      CLAUDE_CODE_OAUTH_TOKEN: '',
      CLAUDE_CODE_USE_BEDROCK: '0',
      CLAUDE_CODE_USE_VERTEX: '0',
      CLAUDE_CODE_USE_FOUNDRY: '0',
    })
    expect(JSON.stringify(env)).not.toContain('sk-secret')
    expect(JSON.stringify(env)).not.toContain('auth-token')
    expect(JSON.stringify(env)).not.toContain('oauth-token')
    expect(JSON.stringify(env)).not.toContain('https://proxy.example')
  })

  it('keeps the CLI login on the inherited config dir and OAuth token', () => {
    vi.stubEnv('PATH', '/usr/bin')
    vi.stubEnv('HOME', '/Users/test')
    vi.stubEnv('ANTHROPIC_API_KEY', 'sk-secret')
    vi.stubEnv('CLAUDE_CODE_OAUTH_TOKEN', 'oauth-token')
    vi.stubEnv('CLAUDE_CONFIG_DIR', '/inherited')
    vi.stubEnv('CLAUDE_SECURESTORAGE_CONFIG_DIR', '/secure-inherited')

    const env = claudeAccountProbeEnv(CLAUDE_CLI_ACCOUNT_PROVIDER_ID)

    expect(env?.PATH).toBe('/usr/bin')
    expect(env?.HOME).toBe('/Users/test')
    expect(env?.CLAUDE_CONFIG_DIR).toBe('/inherited')
    expect(env?.CLAUDE_SECURESTORAGE_CONFIG_DIR).toBe('/secure-inherited')
    expect(env?.ANTHROPIC_API_KEY).toBe('')
    expect(env?.CLAUDE_CODE_OAUTH_TOKEN).toBe('oauth-token')
  })
})

describe('claudeCatalogCacheScope', () => {
  it('names inherit, the CLI login, and a managed directory', () => {
    expect(claudeCatalogCacheScope(null)).toBe('inherit')
    expect(claudeCatalogCacheScope(undefined)).toBe('inherit')
    expect(claudeCatalogCacheScope('custom:empty')).toBe('inherit')
    expect(claudeCatalogCacheScope(CLAUDE_CLI_ACCOUNT_PROVIDER_ID)).toBe('cli')
    expect(claudeCatalogCacheScope('claude-account:/accounts/work')).toBe('dir:/accounts/work')
  })
})
