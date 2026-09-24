import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  existsSync: vi.fn(),
  electronToolkitIs: { dev: true },
  info: vi.fn(),
  warn: vi.fn(),
}))

vi.mock('@electron-toolkit/utils', () => ({ is: mocks.electronToolkitIs }))
vi.mock('node:fs', () => ({ existsSync: mocks.existsSync }))
vi.mock('../logger', () => ({
  default: { info: mocks.info, warn: mocks.warn },
}))

import { dedupePath } from './resolve-cli'
import { usePlatform } from '../../test/platform'

const originalPath = process.env.PATH
const originalShell = process.env.SHELL

beforeEach(() => {
  vi.clearAllMocks()
  mocks.electronToolkitIs.dev = true
  process.env.PATH = '/original/bin'
  process.env.SHELL = '/bin/zsh'
})

afterEach(() => {
  process.env.PATH = originalPath
  process.env.SHELL = originalShell
})

describe('dedupePath', () => {
  it('removes duplicate entries preserving first-seen order', () => {
    expect(dedupePath('/a:/b:/a:/c:/b')).toBe('/a:/b:/c')
  })

  it('drops empty entries from leading/trailing/adjacent colons', () => {
    expect(dedupePath(':/a::/b:')).toBe('/a:/b')
  })

  it('returns empty string for empty input', () => {
    expect(dedupePath('')).toBe('')
  })

  it('handles real-world bloated PATH with repeated inits', () => {
    const bloated = [
      '/Users/jeff/.antigravity/antigravity/bin',
      '/Users/jeff/.antigravity/antigravity/bin',
      '/Users/jeff/.cargo/bin',
      '/opt/homebrew/bin',
      '/Users/jeff/.cargo/bin',
      '/opt/homebrew/bin',
    ].join(':')
    const result = dedupePath(bloated)
    expect(result).toBe('/Users/jeff/.antigravity/antigravity/bin:/Users/jeff/.cargo/bin:/opt/homebrew/bin')
    expect(result.length).toBeLessThan(bloated.length)
  })
})

describe('getNodeRuntime', () => {
  // Electron Helper bundles only exist inside a macOS .app.
  usePlatform('darwin')

  it('uses the named Electron Helper for packaged MCP bridge sidecars', async () => {
    mocks.electronToolkitIs.dev = false
    const { basename, dirname, join } = await import('node:path')
    const namedHelper = join(
      dirname(dirname(process.execPath)),
      'Frameworks',
      `${basename(process.execPath)} MCP Helper.app`,
      'Contents',
      'MacOS',
      `${basename(process.execPath)} MCP Helper`,
    )
    // Obsolete Resources stubs may exist in an upgraded package; ignore them.
    const stubsDir = join(dirname(process.execPath), '..', 'Resources', 'node-runtime-stubs')
    const named = join(stubsDir, `${basename(process.execPath)} MCP Bridge`)
    const stamp = join(stubsDir, '.rpath-ok')
    mocks.existsSync.mockImplementation((p: string) => p === namedHelper || p === named || p === stamp)
    vi.resetModules()

    const { getNodeRuntime } = await import('./resolve-cli')

    expect(getNodeRuntime('mcp-bridge')).toEqual({
      executable: namedHelper,
      env: { ELECTRON_RUN_AS_NODE: '1' },
    })
    expect(mocks.info).toHaveBeenCalledWith(
      '[resolve-cli] packaged mode: using named Electron Helper variant=%s executable=%s',
      'mcp-bridge',
      namedHelper,
    )
  })

  it('uses the named Electron Helper for packaged LLM proxy sidecars', async () => {
    mocks.electronToolkitIs.dev = false
    const { basename, dirname, join } = await import('node:path')
    const namedHelper = join(
      dirname(dirname(process.execPath)),
      'Frameworks',
      `${basename(process.execPath)} LLM Proxy Helper.app`,
      'Contents',
      'MacOS',
      `${basename(process.execPath)} LLM Proxy Helper`,
    )
    mocks.existsSync.mockImplementation((p: string) => p === namedHelper)
    vi.resetModules()

    const { getNodeRuntime } = await import('./resolve-cli')

    expect(getNodeRuntime('llm-proxy')).toEqual({
      executable: namedHelper,
      env: { ELECTRON_RUN_AS_NODE: '1' },
    })
  })

  it('falls back to the plain Electron Helper when a named Helper is missing', async () => {
    mocks.electronToolkitIs.dev = false
    const { basename, dirname, join } = await import('node:path')
    const helper = join(
      dirname(dirname(process.execPath)),
      'Frameworks',
      `${basename(process.execPath)} Helper.app`,
      'Contents',
      'MacOS',
      `${basename(process.execPath)} Helper`,
    )
    mocks.existsSync.mockImplementation((p: string) => p === helper)
    vi.resetModules()

    const { getNodeRuntime } = await import('./resolve-cli')

    expect(getNodeRuntime('mcp-bridge')).toEqual({
      executable: helper,
      env: { ELECTRON_RUN_AS_NODE: '1' },
    })
  })

  it('falls back to the main Electron executable when all Helpers are missing', async () => {
    mocks.electronToolkitIs.dev = false
    mocks.existsSync.mockReturnValue(false)
    vi.resetModules()

    const { getNodeRuntime } = await import('./resolve-cli')

    expect(getNodeRuntime('mcp-bridge')).toEqual({
      executable: process.execPath,
      env: { ELECTRON_RUN_AS_NODE: '1' },
    })
    expect(mocks.info).toHaveBeenCalledWith(
      '[resolve-cli] packaged mode: using Electron as Node runtime variant=%s executable=%s',
      'mcp-bridge',
      process.execPath,
    )
  })
})
