import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  execFileSync: vi.fn(),
  info: vi.fn(),
  warn: vi.fn(),
}))

vi.mock('@electron-toolkit/utils', () => ({ is: { dev: true } }))
vi.mock('child_process', () => ({ execFileSync: mocks.execFileSync }))
vi.mock('../logger', () => ({
  default: { info: mocks.info, warn: mocks.warn },
}))

import { dedupePath, fixPath } from './resolve-cli'

const originalPath = process.env.PATH
const originalShell = process.env.SHELL

beforeEach(() => {
  vi.clearAllMocks()
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
