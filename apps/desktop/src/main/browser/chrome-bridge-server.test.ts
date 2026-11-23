import { afterEach, describe, expect, it, vi } from 'vitest'
import { chromeBridgeHome, chromeBridgeSocketPath } from './chrome-bridge-server'

describe('chromeBridgeHome', () => {
  afterEach(() => {
    vi.unstubAllEnvs()
  })

  it('ignores SUPERONE_HOME so each variant owns its bridge socket and native host', () => {
    vi.stubEnv('SUPERONE_HOME', '/Users/me/.superone/alpha')
    vi.stubEnv('SUPERONE_VARIANT', 'alpha')

    expect(chromeBridgeHome('dev', '/Users/me')).toBe('/Users/me/.superone/dev')
    expect(chromeBridgeHome('alpha', '/Users/me')).toBe('/Users/me/.superone/alpha')
    expect(chromeBridgeHome('stable', '/Users/me')).toBe('/Users/me/.superone')
  })

  it('uses a named pipe on Windows and a unix socket elsewhere', () => {
    expect(chromeBridgeSocketPath('C:\\Users\\me\\.superone', 'win32')).toMatch(/^\\\\\.\\pipe\\superone-chrome-bridge-[0-9a-f]{16}$/)
    expect(chromeBridgeSocketPath('/Users/me/.superone', 'darwin')).toBe('/Users/me/.superone/chrome-bridge.sock')
  })
})
