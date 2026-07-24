import { describe, it, expect } from 'vitest'
import { resolveAcpClientVersion } from './acp-client-info'

describe('resolveAcpClientVersion', () => {
  it('returns a non-placeholder semver-like version from package or electron', () => {
    const v = resolveAcpClientVersion()
    // In unit tests electron may be unavailable; package.json still ships a version.
    expect(v).toMatch(/^\d+\.\d+/)
    expect(v).not.toBe('0.0.0')
  })
})
