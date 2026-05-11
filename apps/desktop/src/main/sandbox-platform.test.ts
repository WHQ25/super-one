import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'

vi.mock('./logger', () => ({
  default: { info: () => {}, warn: () => {}, debug: () => {}, error: () => {} },
}))

const ORIGINAL_PLATFORM = process.platform

function setPlatform(platform: NodeJS.Platform): void {
  Object.defineProperty(process, 'platform', { value: platform, configurable: true })
}

function restorePlatform(): void {
  Object.defineProperty(process, 'platform', { value: ORIGINAL_PLATFORM, configurable: true })
}

describe('sandbox-platform capability classification', () => {
  beforeEach(() => {
    vi.resetModules()
  })

  afterEach(() => {
    restorePlatform()
    vi.restoreAllMocks()
    vi.resetModules()
  })

  it('returns always on darwin', async () => {
    setPlatform('darwin')
    const { getSandboxCapability } = await import('./sandbox-platform')
    const cap = getSandboxCapability()
    expect(cap.supportLevel).toBe('always')
    expect(cap.defaultMode).toBe('on')
  })

  it('returns conditional on linux when not WSL1', async () => {
    setPlatform('linux')
    vi.doMock('node:fs', async () => {
      const actual = await vi.importActual<typeof import('node:fs')>('node:fs')
      return { ...actual, readFileSync: () => 'Linux version 5.15.0 generic' }
    })
    const { getSandboxCapability } = await import('./sandbox-platform')
    const cap = getSandboxCapability()
    expect(cap.supportLevel).toBe('conditional')
    expect(cap.defaultMode).toBe('off')
  })

  it('returns unsupported on WSL1', async () => {
    setPlatform('linux')
    vi.doMock('node:fs', async () => {
      const actual = await vi.importActual<typeof import('node:fs')>('node:fs')
      return { ...actual, readFileSync: () => 'Linux 4.4.0-19041-Microsoft' }
    })
    const { getSandboxCapability } = await import('./sandbox-platform')
    const cap = getSandboxCapability()
    expect(cap.supportLevel).toBe('unsupported')
    expect(cap.defaultMode).toBe('off')
  })

  it('returns conditional on WSL2', async () => {
    setPlatform('linux')
    vi.doMock('node:fs', async () => {
      const actual = await vi.importActual<typeof import('node:fs')>('node:fs')
      return { ...actual, readFileSync: () => 'Linux 5.10.16.3-microsoft-standard-WSL2' }
    })
    const { getSandboxCapability } = await import('./sandbox-platform')
    const cap = getSandboxCapability()
    expect(cap.supportLevel).toBe('conditional')
  })

  it('returns unsupported on win32', async () => {
    setPlatform('win32')
    const { getSandboxCapability } = await import('./sandbox-platform')
    const cap = getSandboxCapability()
    expect(cap.supportLevel).toBe('unsupported')
    expect(cap.defaultMode).toBe('off')
  })

  it('returns unsupported on unknown platforms', async () => {
    setPlatform('freebsd' as NodeJS.Platform)
    const { getSandboxCapability } = await import('./sandbox-platform')
    expect(getSandboxCapability().supportLevel).toBe('unsupported')
  })
})

describe('coerceSandboxModeForCapability', () => {
  beforeEach(() => {
    vi.resetModules()
  })

  afterEach(() => {
    restorePlatform()
    vi.resetModules()
  })

  it('forces non-off modes to off when unsupported', async () => {
    setPlatform('win32')
    const { coerceSandboxModeForCapability } = await import('./sandbox-platform')
    expect(coerceSandboxModeForCapability('on')).toBe('off')
    expect(coerceSandboxModeForCapability('auto')).toBe('off')
    expect(coerceSandboxModeForCapability('off')).toBe('off')
    expect(coerceSandboxModeForCapability(undefined)).toBe(undefined)
  })

  it('passes mode through when supported', async () => {
    setPlatform('darwin')
    const { coerceSandboxModeForCapability } = await import('./sandbox-platform')
    expect(coerceSandboxModeForCapability('on')).toBe('on')
    expect(coerceSandboxModeForCapability('auto')).toBe('auto')
  })
})

describe('probeSandboxDependencies', () => {
  beforeEach(() => {
    vi.resetModules()
  })

  afterEach(() => {
    restorePlatform()
    vi.resetModules()
  })

  it('returns ok immediately on darwin', async () => {
    setPlatform('darwin')
    const { probeSandboxDependencies } = await import('./sandbox-platform')
    const result = await probeSandboxDependencies()
    expect(result.ok).toBe(true)
  })

  it('returns not-ok when bwrap and socat missing on linux', async () => {
    setPlatform('linux')
    vi.doMock('node:fs', async () => {
      const actual = await vi.importActual<typeof import('node:fs')>('node:fs')
      return { ...actual, readFileSync: () => 'Linux 5.15' }
    })
    vi.doMock('node:child_process', () => ({
      spawnSync: () => ({ status: 1, stdout: '', stderr: '' }),
    }))
    const { probeSandboxDependencies } = await import('./sandbox-platform')
    const result = await probeSandboxDependencies()
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.missing).toEqual(['bubblewrap', 'socat'])
      expect(result.installHint).toMatch(/bubblewrap/)
    }
  })

  it('returns ok when bwrap and socat present on linux', async () => {
    setPlatform('linux')
    vi.doMock('node:fs', async () => {
      const actual = await vi.importActual<typeof import('node:fs')>('node:fs')
      return { ...actual, readFileSync: () => 'Linux 5.15' }
    })
    vi.doMock('node:child_process', () => ({
      spawnSync: () => ({ status: 0, stdout: '/usr/bin/bin\n', stderr: '' }),
    }))
    const { probeSandboxDependencies } = await import('./sandbox-platform')
    const result = await probeSandboxDependencies()
    expect(result.ok).toBe(true)
  })

  it('caches probe result', async () => {
    setPlatform('darwin')
    const { probeSandboxDependencies } = await import('./sandbox-platform')
    const a = await probeSandboxDependencies()
    const b = await probeSandboxDependencies()
    expect(a).toBe(b)
  })
})
