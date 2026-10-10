import { beforeEach, describe, expect, it, vi } from 'vitest'

const fixture = vi.hoisted(() => ({
  scripted: true,
  status: { id: 'claude', enabled: true, state: 'ready', runtimeVersion: 'simulated' },
  manager: { get: vi.fn(), update: vi.fn(), enableSimulatedOverlay: vi.fn() },
  install: vi.fn(),
  home: vi.fn(),
}))

vi.mock('@superone/runtime/harness', async importOriginal => ({
  ...await importOriginal<typeof import('@superone/runtime/harness')>(),
  HarnessManager: vi.fn(function () { return fixture.manager }),
  enableHarness: fixture.install,
}))
vi.mock('../database', () => ({ getDb: () => ({}) }))
vi.mock('../session/scripted-harness-gate', () => ({ scriptedHarnessEnabled: () => fixture.scripted }))
vi.mock('../logger', () => ({ default: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }))
vi.mock('./home', () => ({ resolveHarnessHomeRoot: fixture.home }))
vi.mock('./host', () => ({ desktopHarnessDeps: () => ({}), desktopHarnessResolver: {}, desktopHarnessAuthProbe: () => ({}) }))
vi.mock('./tarball-installer', () => ({ desktopPackagePins: () => ({}), isDesktopManagedPinAligned: () => false }))
vi.mock('./grok-installation', () => ({ refreshGrokInstallation: vi.fn() }))

const { alignEnabledManagedHarnesses, enabledManagedHarnessesNeedAlign, enableDesktopHarness, resetHarnessManagerForTests } = await import('./service')

beforeEach(() => {
  resetHarnessManagerForTests()
  vi.clearAllMocks()
  fixture.scripted = true
  fixture.manager.get.mockReturnValue(fixture.status)
  fixture.install.mockResolvedValue(fixture.status)
})

describe('scripted desktop harness installation', () => {
  it('does not offer or execute startup pin alignment', async () => {
    expect(enabledManagedHarnessesNeedAlign()).toBe(false)
    expect(await alignEnabledManagedHarnesses()).toEqual({ aligned: [], failed: [] })
    expect(fixture.home).not.toHaveBeenCalled()
    expect(fixture.install).not.toHaveBeenCalled()
    expect(fixture.manager.update).not.toHaveBeenCalled()
  })

  it('returns simulated readiness without downloading even for a forced enable', async () => {
    expect(await enableDesktopHarness({ harnessId: 'claude', forcePin: true })).toEqual(fixture.status)
    expect(fixture.manager.enableSimulatedOverlay).toHaveBeenCalledOnce()
    expect(fixture.install).not.toHaveBeenCalled()
    expect(fixture.manager.update).not.toHaveBeenCalled()
  })

  it('keeps the real installer enabled outside scripted mode', async () => {
    fixture.scripted = false
    const input = { harnessId: 'claude' as const, forcePin: true }
    expect(await enableDesktopHarness(input)).toEqual(fixture.status)
    expect(fixture.install).toHaveBeenCalledWith(fixture.manager, input, expect.any(Object))
    expect(fixture.manager.enableSimulatedOverlay).not.toHaveBeenCalled()
  })
})
