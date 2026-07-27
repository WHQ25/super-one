import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  execFileSync: vi.fn(),
  existsSync: vi.fn(),
  electronToolkitIs: { dev: true },
  info: vi.fn(),
  warn: vi.fn(),
}))

vi.mock('@electron-toolkit/utils', () => ({ is: mocks.electronToolkitIs }))
vi.mock('child_process', () => ({ execFileSync: mocks.execFileSync }))
vi.mock('node:fs', () => ({ existsSync: mocks.existsSync }))
vi.mock('../logger', () => ({
  default: { info: mocks.info, warn: mocks.warn },
}))

import { dedupePath, fixPath } from './resolve-cli'

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

describe('fixPath', () => {
  it('extracts PATH from login shell output containing a startup banner', () => {
    const banner = `${'x'.repeat(1400)}:\nfastfetch output\n`
    mocks.execFileSync.mockReturnValue(
      Buffer.from(`${banner}__SUPERONE_PATH_OUTPUT_START__/opt/homebrew/bin:/usr/bin:/bin__SUPERONE_PATH_OUTPUT_END__\n`),
    )

    fixPath()

    expect(process.env.PATH).toBe('/opt/homebrew/bin:/usr/bin:/bin')
    expect(mocks.execFileSync).toHaveBeenCalledWith(
      '/bin/zsh',
      ['-ilc', `printf '__SUPERONE_PATH_OUTPUT_START__%s__SUPERONE_PATH_OUTPUT_END__' "$PATH"`],
      { timeout: 5000, stdio: ['pipe', 'pipe', 'pipe'] },
    )
  })

  it('preserves the existing PATH when shell output has no markers', () => {
    mocks.execFileSync.mockReturnValue(Buffer.from('fastfetch output\n/usr/bin:/bin'))

    fixPath()

    expect(process.env.PATH).toBe('/original/bin')
    expect(mocks.warn).toHaveBeenCalledWith('[fixPath] Failed to get PATH from login shell')
  })
})

describe('getNodeRuntime', () => {
  it('prefers the Resources node-runtime-stubs clone for the packaged MCP bridge', async () => {
    mocks.electronToolkitIs.dev = false
    const { basename, dirname, join } = await import('node:path')
    const stubsDir = join(dirname(process.execPath), '..', 'Resources', 'node-runtime-stubs')
    const named = join(stubsDir, `${basename(process.execPath)} MCP Bridge`)
    const stamp = join(stubsDir, '.rpath-ok')
    mocks.existsSync.mockImplementation((p: string) => p === named || p === stamp)
    vi.resetModules()

    const { getNodeRuntime } = await import('./resolve-cli')

    expect(getNodeRuntime('mcp-bridge')).toEqual({
      executable: named,
      env: { ELECTRON_RUN_AS_NODE: '1' },
    })
    expect(mocks.info).toHaveBeenCalledWith(
      '[resolve-cli] packaged mode: using named node runtime variant=%s executable=%s',
      'mcp-bridge',
      named,
    )
  })

  it('skips Resources stubs that lack the afterPack rpath stamp (0.48.1 broken clones)', async () => {
    mocks.electronToolkitIs.dev = false
    const { basename, dirname, join } = await import('node:path')
    const stubsDir = join(dirname(process.execPath), '..', 'Resources', 'node-runtime-stubs')
    const named = join(stubsDir, `${basename(process.execPath)} MCP Bridge`)
    const helper = join(
      dirname(dirname(process.execPath)),
      'Frameworks',
      `${basename(process.execPath)} Helper.app`,
      'Contents',
      'MacOS',
      `${basename(process.execPath)} Helper`,
    )
    // Stub binary present, but no .rpath-ok stamp → treat as unusable.
    mocks.existsSync.mockImplementation((p: string) => p === named || p === helper)
    vi.resetModules()

    const { getNodeRuntime } = await import('./resolve-cli')

    expect(getNodeRuntime('mcp-bridge')).toEqual({
      executable: helper,
      env: { ELECTRON_RUN_AS_NODE: '1' },
    })
  })

  it('falls back to a legacy MacOS sibling stub when Resources stubs are missing', async () => {
    mocks.electronToolkitIs.dev = false
    const { basename, dirname, join } = await import('node:path')
    const legacy = join(dirname(process.execPath), `${basename(process.execPath)} MCP Bridge`)
    mocks.existsSync.mockImplementation((p: string) => p === legacy)
    vi.resetModules()

    const { getNodeRuntime } = await import('./resolve-cli')

    expect(getNodeRuntime('mcp-bridge')).toEqual({
      executable: legacy,
      env: { ELECTRON_RUN_AS_NODE: '1' },
    })
  })

  it('falls back to the plain Helper when the named stub is missing', async () => {
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
    expect(mocks.info).toHaveBeenCalledWith(
      '[resolve-cli] packaged mode: named node runtime missing/unusable for variant=%s, falling back to executable=%s',
      'mcp-bridge',
      helper,
    )
  })

  it('falls back to the main Electron executable when named stub and Helper are missing', async () => {
    mocks.electronToolkitIs.dev = false
    mocks.existsSync.mockReturnValue(false)
    vi.resetModules()

    const { getNodeRuntime } = await import('./resolve-cli')

    expect(getNodeRuntime('mcp-bridge')).toEqual({
      executable: process.execPath,
      env: { ELECTRON_RUN_AS_NODE: '1' },
    })
    expect(mocks.info).toHaveBeenCalledWith(
      '[resolve-cli] packaged mode: named node runtime missing/unusable for variant=%s, falling back to executable=%s',
      'mcp-bridge',
      process.execPath,
    )
  })

  it('prefers the Resources node-runtime-stubs clone for the packaged LLM proxy', async () => {
    mocks.electronToolkitIs.dev = false
    const { basename, dirname, join } = await import('node:path')
    const stubsDir = join(dirname(process.execPath), '..', 'Resources', 'node-runtime-stubs')
    const named = join(stubsDir, `${basename(process.execPath)} LLM Proxy`)
    const stamp = join(stubsDir, '.rpath-ok')
    mocks.existsSync.mockImplementation((p: string) => p === named || p === stamp)
    vi.resetModules()

    const { getNodeRuntime } = await import('./resolve-cli')

    expect(getNodeRuntime('llm-proxy')).toEqual({
      executable: named,
      env: { ELECTRON_RUN_AS_NODE: '1' },
    })
  })
})
