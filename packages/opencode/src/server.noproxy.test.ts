import { describe, expect, it } from 'vitest'
import { buildOpenCodeServeEnv } from './server'

describe('buildOpenCodeServeEnv', () => {
  it('always includes loopback hosts in NO_PROXY for SuperOne MCP HTTP', () => {
    const env = buildOpenCodeServeEnv({ NO_PROXY: 'example.com' })
    const parts = String(env.NO_PROXY ?? '').split(',')
    expect(parts).toContain('example.com')
    expect(parts).toContain('127.0.0.1')
    expect(parts).toContain('localhost')
    expect(parts).toContain('::1')
    expect(env.no_proxy).toBe(env.NO_PROXY)
  })

  it('preserves OPENCODE_CONFIG_CONTENT default and caller overrides', () => {
    expect(buildOpenCodeServeEnv().OPENCODE_CONFIG_CONTENT).toBe('{}')
    expect(buildOpenCodeServeEnv({ OPENCODE_CONFIG_CONTENT: '{"x":1}' }).OPENCODE_CONFIG_CONTENT).toBe(
      '{"x":1}',
    )
  })
})
