import { describe, expect, it } from 'vitest'
import { buildAcpProcessEnv } from './process'

describe('buildAcpProcessEnv', () => {
  it('always includes loopback hosts in NO_PROXY for SuperOne MCP HTTP', () => {
    const env = buildAcpProcessEnv({ NO_PROXY: 'example.com', TOKEN: 't' })
    const parts = String(env.NO_PROXY ?? '').split(',')
    expect(parts).toContain('example.com')
    expect(parts).toContain('127.0.0.1')
    expect(parts).toContain('localhost')
    expect(parts).toContain('::1')
    expect(env.no_proxy).toBe(env.NO_PROXY)
    expect(env.TOKEN).toBe('t')
  })

  it('merges launch env without clobbering existing no_proxy entries', () => {
    const env = buildAcpProcessEnv({ no_proxy: 'corp.local,localhost' })
    const parts = String(env.NO_PROXY ?? '').split(',')
    expect(parts).toContain('corp.local')
    expect(parts.filter((p) => p.toLowerCase() === 'localhost')).toHaveLength(1)
    expect(parts).toContain('127.0.0.1')
  })
})
