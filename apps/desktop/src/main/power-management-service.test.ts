import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('electron', () => ({
  app: {
    isPackaged: false,
    getAppPath: () => '/app',
    getPath: () => '/user-data',
  },
  powerMonitor: {
    isOnBatteryPower: () => false,
    on: vi.fn(),
    removeListener: vi.fn(),
  },
  powerSaveBlocker: {
    start: vi.fn(() => 1),
    stop: vi.fn(),
  },
}))

vi.mock('./logger', () => ({
  default: {
    info: vi.fn(),
    warn: vi.fn(),
  },
}))

import {
  PowerManagementService,
  parseWindowsAcLidAction,
  resolveLegacyRemotePowerMode,
  type PowerManagementServiceDeps,
  type LidPowerPlatformAdapter,
} from './power-management-service'

function createHarness(options: { battery?: boolean; prepareError?: Error } = {}) {
  let onAcHandler: (() => void) | null = null
  let onBatteryHandler: (() => void) | null = null
  const adapter: LidPowerPlatformAdapter = {
    prepare: vi.fn(async () => {
      if (options.prepareError) throw options.prepareError
    }),
    activate: vi.fn(async () => {}),
    deactivate: vi.fn(async () => {}),
    dispose: vi.fn(async () => {}),
  }
  const startPowerBlocker = vi.fn(() => 42)
  const stopPowerBlocker = vi.fn()
  const deps: PowerManagementServiceDeps = {
    platform: 'darwin',
    isOnBatteryPower: () => options.battery ?? false,
    onAc: (handler) => { onAcHandler = handler },
    onBattery: (handler) => { onBatteryHandler = handler },
    removeOnAc: vi.fn(),
    removeOnBattery: vi.fn(),
    detectLinuxAc: () => true,
    startPowerBlocker,
    stopPowerBlocker,
    createAdapter: () => adapter,
    setInterval,
    clearInterval,
  }
  const service = new PowerManagementService(deps)
  return {
    service,
    adapter,
    startPowerBlocker,
    stopPowerBlocker,
    emitAc: () => onAcHandler?.(),
    emitBattery: () => onBatteryHandler?.(),
  }
}

describe('PowerManagementService', () => {
  beforeEach(() => vi.clearAllMocks())

  it('does nothing until the user enables the setting', async () => {
    const h = createHarness()
    await expect(h.service.start('system')).resolves.toBe(true)
    expect(h.adapter.prepare).not.toHaveBeenCalled()
    expect(h.adapter.activate).not.toHaveBeenCalled()
    expect(h.startPowerBlocker).not.toHaveBeenCalled()
    await h.service.dispose()
  })

  it('activates the platform policy and idle blocker after explicit consent', async () => {
    const h = createHarness()
    await h.service.start('system')
    await h.service.setMode('lid-closed-on-ac', true)

    expect(h.adapter.prepare).toHaveBeenCalledWith(true)
    expect(h.adapter.activate).toHaveBeenCalledOnce()
    expect(h.startPowerBlocker).toHaveBeenCalledOnce()
    await h.service.dispose()
  })

  it('releases only the lid override on battery and re-acquires it on AC', async () => {
    const h = createHarness()
    await h.service.start('lid-closed-on-ac')

    h.emitBattery()
    await vi.waitFor(() => expect(h.adapter.deactivate).toHaveBeenCalled())
    expect(h.stopPowerBlocker).not.toHaveBeenCalled()

    h.emitAc()
    await vi.waitFor(() => expect(h.adapter.activate).toHaveBeenCalledTimes(2))
    expect(h.startPowerBlocker).toHaveBeenCalledOnce()
    expect(h.adapter.activate).toHaveBeenCalledTimes(2)
    await h.service.dispose()
  })

  it('keeps consent armed but inactive until a battery-powered laptop reaches AC', async () => {
    const h = createHarness({ battery: true })
    await expect(h.service.start('lid-closed-on-ac')).resolves.toBe(true)

    expect(h.adapter.prepare).toHaveBeenCalledWith(false)
    expect(h.adapter.activate).not.toHaveBeenCalled()
    expect(h.startPowerBlocker).toHaveBeenCalledOnce()

    h.emitAc()
    await vi.waitFor(() => expect(h.adapter.activate).toHaveBeenCalledOnce())
    expect(h.startPowerBlocker).toHaveBeenCalledOnce()
    await h.service.dispose()
  })

  it('does not persist an active state when platform preparation fails', async () => {
    const h = createHarness({ prepareError: new Error('approval declined') })
    await h.service.start('system')
    await expect(h.service.setMode('lid-closed-on-ac', true)).rejects.toThrow('approval declined')
    expect(h.adapter.activate).not.toHaveBeenCalled()
    expect(h.startPowerBlocker).not.toHaveBeenCalled()
    await expect(h.service.setMode('system', false)).resolves.toBeUndefined()
    await h.service.dispose()
  })

  it('uses the idle blocker without preparing the closed-lid adapter at level one', async () => {
    const h = createHarness()
    await h.service.start('system')
    await h.service.setMode('prevent-idle-sleep')

    expect(h.adapter.prepare).not.toHaveBeenCalled()
    expect(h.adapter.activate).not.toHaveBeenCalled()
    expect(h.startPowerBlocker).toHaveBeenCalledOnce()

    await h.service.setMode('system')
    expect(h.stopPowerBlocker).toHaveBeenCalledWith(42)
    await h.service.dispose()
  })
})

describe('parseWindowsAcLidAction', () => {
  it('reads the AC value without depending on localized labels', () => {
    const output = `
      Current AC Power Setting Index: 0x00000001
      Current DC Power Setting Index: 0x00000002
    `
    expect(parseWindowsAcLidAction(output)).toBe(1)
  })

  it('returns null for an incomplete response', () => {
    expect(parseWindowsAcLidAction('0x00000001')).toBeNull()
  })
})

describe('resolveLegacyRemotePowerMode', () => {
  it('moves the old Remote Control sleep toggle to level one', () => {
    expect(resolveLegacyRemotePowerMode('system', true)).toBe('prevent-idle-sleep')
  })

  it('does not downgrade a closed-lid choice or migrate a disabled toggle', () => {
    expect(resolveLegacyRemotePowerMode('lid-closed-on-ac', true)).toBe('lid-closed-on-ac')
    expect(resolveLegacyRemotePowerMode('system', false)).toBe('system')
  })
})
