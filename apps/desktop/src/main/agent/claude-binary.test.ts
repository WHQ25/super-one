/**
 * Regression: the resolver used to cache a miss as `null` forever. During an
 * upgrade the pinned Claude binary lands in ~/.superone/harness a few seconds
 * after launch, so a sticky negative kept every connectClaude call failing for
 * the whole process lifetime — the app could only be fixed by restarting into
 * a luckier race.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

const bundled = vi.hoisted(() => ({
  allowed: false,
  files: new Set<string>(),
  resolve: vi.fn<(name: string) => string>(),
}))
vi.mock('node:module', () => ({ createRequire: () => ({ resolve: bundled.resolve }) }))
vi.mock('node:fs', async importOriginal => ({
  ...await importOriginal<typeof import('node:fs')>(),
  existsSync: (path: unknown) => bundled.files.has(String(path)),
}))

const resolveDesktopManagedBinary = vi.fn<() => string | null>()

vi.mock('../harness/tarball-installer', () => ({
  resolveDesktopManagedBinary: () => resolveDesktopManagedBinary(),
}))
vi.mock('../harness/home', () => ({ resolveHarnessHomeRoot: () => '/tmp/superone-harness-test' }))
vi.mock('../harness/bundled-fallback', () => ({ allowBundledHarnessPlatformPackages: () => bundled.allowed }))

import { resolveSdkClaudeBinary, resetClaudeBinaryCacheForTests } from './claude-binary'

const MANAGED = '/tmp/superone-harness-test/claude/versions/0.3.226/bin/claude'
const originalPlatform = Object.getOwnPropertyDescriptor(process, 'platform')!
const originalArch = Object.getOwnPropertyDescriptor(process, 'arch')!

beforeEach(() => {
  resetClaudeBinaryCacheForTests()
  resolveDesktopManagedBinary.mockReset()
  vi.stubEnv('SUPERONE_CLAUDE_BINARY', '')
  bundled.allowed = false
  bundled.files.clear()
  bundled.resolve.mockReset().mockImplementation(name => {
    const path = name.endsWith('-musl/claude') ? '/sdk/musl/claude' : '/sdk/glibc/claude'
    if (!bundled.files.has(path)) throw new Error('Package is missing')
    return path
  })
  Object.defineProperty(process, 'platform', { value: 'linux' })
  Object.defineProperty(process, 'arch', { value: 'x64' })
  vi.spyOn(process.report, 'getReport').mockReturnValue({ header: { glibcVersionRuntime: '2.36' } } as ReturnType<typeof process.report.getReport>)
})

afterEach(() => {
  Object.defineProperty(process, 'platform', originalPlatform)
  Object.defineProperty(process, 'arch', originalArch)
  vi.restoreAllMocks()
  vi.unstubAllEnvs()
})

describe('resolveSdkClaudeBinary during the harness install window', () => {
  it.each(['glibc', 'musl'])('selects the %s developer binary when both packages exist', libc => {
    bundled.allowed = true
    bundled.files.add('/sdk/glibc/claude')
    bundled.files.add('/sdk/musl/claude')
    vi.mocked(process.report.getReport).mockReturnValue({ header: libc === 'glibc' ? { glibcVersionRuntime: '2.36' } : {} } as ReturnType<typeof process.report.getReport>)
    expect(resolveSdkClaudeBinary()).toBe(`/sdk/${libc}/claude`)
  })

  it('keeps an explicit binary ahead of managed and bundled packages', () => {
    vi.stubEnv('SUPERONE_CLAUDE_BINARY', '/custom/claude')
    bundled.files.add('/custom/claude')
    resolveDesktopManagedBinary.mockReturnValue(MANAGED)
    expect(resolveSdkClaudeBinary()).toBe('/custom/claude')
    expect(resolveDesktopManagedBinary).not.toHaveBeenCalled()
    expect(bundled.resolve).not.toHaveBeenCalled()
  })

  it('keeps the managed binary ahead of installed developer packages', () => {
    bundled.allowed = true
    bundled.files.add('/sdk/musl/claude')
    bundled.files.add('/sdk/glibc/claude')
    resolveDesktopManagedBinary.mockReturnValue(MANAGED)
    expect(resolveSdkClaudeBinary()).toBe(MANAGED)
    expect(bundled.resolve).not.toHaveBeenCalled()
  })

  it('does not use a bundled binary when packaged fallback is disabled', () => {
    bundled.files.add('/sdk/musl/claude')
    bundled.files.add('/sdk/glibc/claude')
    expect(resolveSdkClaudeBinary()).toBeUndefined()
    expect(bundled.resolve).not.toHaveBeenCalled()
  })

  it('discovers a developer package installed after an earlier miss', () => {
    bundled.allowed = true
    expect(resolveSdkClaudeBinary()).toBeUndefined()
    bundled.files.add('/sdk/glibc/claude')
    expect(resolveSdkClaudeBinary()).toBe('/sdk/glibc/claude')
  })

  it('picks up the binary once it lands, without a process restart', () => {
    resolveDesktopManagedBinary.mockReturnValueOnce(null)
    expect(resolveSdkClaudeBinary()).toBeUndefined()

    // Harness finishes installing later in this same process.
    resolveDesktopManagedBinary.mockReturnValue(MANAGED)
    expect(resolveSdkClaudeBinary()).toBe(MANAGED)
  })

  it('caches a successful resolution so repeat calls skip disk probing', () => {
    resolveDesktopManagedBinary.mockReturnValue(MANAGED)

    expect(resolveSdkClaudeBinary()).toBe(MANAGED)
    expect(resolveSdkClaudeBinary()).toBe(MANAGED)
    expect(resolveDesktopManagedBinary).toHaveBeenCalledTimes(1)
  })
})
