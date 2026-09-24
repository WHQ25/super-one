import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  execFile: vi.fn(),
  stdinEnd: vi.fn(),
  info: vi.fn(),
  warn: vi.fn(),
}))

vi.mock('child_process', () => ({ execFile: mocks.execFile }))
vi.mock('./logger', () => ({
  default: { info: mocks.info, warn: mocks.warn },
}))

// vitest.setup.ts stubs this module for every other test.
const { ensureShellPath, refreshShellPath } =
  await vi.importActual<typeof import('./shell-path')>('./shell-path')

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

function shellPrints(stdout: string): void {
  mocks.execFile.mockImplementation((_file, _args, _opts, callback) => {
    callback(null, stdout, '')
    return { stdin: { end: mocks.stdinEnd } }
  })
}

describe('ensureShellPath', () => {
  it('extracts PATH from login shell output containing a startup banner', async () => {
    const banner = `${'x'.repeat(1400)}:\nfastfetch output\n`
    shellPrints(`${banner}__SUPERONE_PATH_OUTPUT_START__/opt/homebrew/bin:/usr/bin:/bin__SUPERONE_PATH_OUTPUT_END__\n`)

    await refreshShellPath()

    expect(process.env.PATH).toBe('/opt/homebrew/bin:/usr/bin:/bin')
    expect(mocks.execFile).toHaveBeenCalledWith(
      '/bin/zsh',
      ['-ilc', `printf '__SUPERONE_PATH_OUTPUT_START__%s__SUPERONE_PATH_OUTPUT_END__' "$PATH"`],
      { timeout: 5000 },
      expect.any(Function),
    )
    expect(mocks.stdinEnd).toHaveBeenCalled()
  })

  it('preserves the existing PATH when shell output has no markers', async () => {
    shellPrints('fastfetch output\n/usr/bin:/bin')

    await refreshShellPath()

    expect(process.env.PATH).toBe('/original/bin')
    expect(mocks.warn).toHaveBeenCalledWith('[fixPath] Failed to get PATH from login shell')
  })

  it('keeps the newest read when an older one finishes last', async () => {
    const callbacks: Array<(error: Error | null, stdout: string) => void> = []
    mocks.execFile.mockImplementation((_file, _args, _opts, callback) => {
      callbacks.push(callback)
      return { stdin: { end: mocks.stdinEnd } }
    })
    const marked = (path: string) => `__SUPERONE_PATH_OUTPUT_START__${path}__SUPERONE_PATH_OUTPUT_END__`

    const older = refreshShellPath()
    const newer = refreshShellPath()
    callbacks[1](null, marked('/new/bin'))
    callbacks[0](null, marked('/old/bin'))
    await Promise.all([older, newer])

    expect(process.env.PATH).toBe('/new/bin')
  })

  it('runs the login shell once for concurrent and later callers', async () => {
    shellPrints('__SUPERONE_PATH_OUTPUT_START__/opt/homebrew/bin__SUPERONE_PATH_OUTPUT_END__')

    const first = refreshShellPath()
    await Promise.all([ensureShellPath(), ensureShellPath(), first])
    await ensureShellPath()

    expect(mocks.execFile).toHaveBeenCalledTimes(1)
  })
})
