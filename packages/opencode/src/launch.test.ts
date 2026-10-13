import { afterEach, describe, expect, it, vi } from 'vitest'
import { openNodeDatabase } from '@superone/runtime/db'
import { HarnessManager } from '@superone/runtime/harness'
import { resolveOpenCodeLaunch } from './launch'
import { OpenCodeV2Client } from './opencode-v2-client'

const cleanup: Array<() => void> = []
afterEach(() => {
  while (cleanup.length) cleanup.pop()!()
  vi.unstubAllEnvs()
})
describe('OpenCode node launch', () => {
  it('resolves catalog configuration after enable and preserves an attached endpoint', () => {
    vi.stubEnv('SUPERONE_OPENCODE_BINARY', '')
    const db = openNodeDatabase(':memory:'),
      manager = new HarnessManager(db)
    cleanup.push(() => db.close())
    expect(resolveOpenCodeLaunch({ harnesses: manager })).toEqual({ binaryPath: undefined, serverUrl: undefined })
    manager.update('opencode', { enabled: true, state: 'ready', command: '/configured/opencode' })
    expect(resolveOpenCodeLaunch({ harnesses: manager }).binaryPath).toBe('/configured/opencode')
    manager.update('opencode', { command: null, configJson: JSON.stringify({ serverUrl: 'http://127.0.0.1:9000' }) })
    expect(resolveOpenCodeLaunch({ harnesses: manager }).serverUrl).toBe('http://127.0.0.1:9000')
  })
  it('keeps an explicit executable ahead of the enabled catalog', () => {
    expect(resolveOpenCodeLaunch({ binaryPath: '/explicit/opencode' }).binaryPath).toBe('/explicit/opencode')
  })
  it('fails before network activity on a runtime missing the Promise method required by the SDK', () => {
    const original = Promise.withResolvers
    try {
      Promise.withResolvers = undefined as never
      expect(() => new OpenCodeV2Client({ baseUrl: 'http://native.invalid', directory: '/tmp' })).toThrow('Node.js 22')
    } finally {
      Promise.withResolvers = original
    }
  })
})
