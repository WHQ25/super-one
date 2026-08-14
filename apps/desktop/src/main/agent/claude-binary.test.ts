/**
 * Regression: the resolver used to cache a miss as `null` forever. During an
 * upgrade the pinned Claude binary lands in ~/.superone/harness a few seconds
 * after launch, so a sticky negative kept every connectClaude call failing for
 * the whole process lifetime — the app could only be fixed by restarting into
 * a luckier race.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'

const resolveDesktopManagedBinary = vi.fn<() => string | null>()

vi.mock('../harness/tarball-installer', () => ({
  resolveDesktopManagedBinary: () => resolveDesktopManagedBinary(),
}))
vi.mock('../harness/home', () => ({ resolveHarnessHomeRoot: () => '/tmp/superone-harness-test' }))
vi.mock('../harness/bundled-fallback', () => ({ allowBundledHarnessPlatformPackages: () => false }))

import { resolveSdkClaudeBinary, resetClaudeBinaryCacheForTests } from './claude-binary'

const MANAGED = '/tmp/superone-harness-test/claude/versions/0.3.226/bin/claude'

beforeEach(() => {
  resetClaudeBinaryCacheForTests()
  resolveDesktopManagedBinary.mockReset()
  delete process.env.SUPERONE_CLAUDE_BINARY
})

describe('resolveSdkClaudeBinary during the harness install window', () => {
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
