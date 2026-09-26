import { afterEach, describe, expect, it, vi } from 'vitest'

vi.mock('electron', () => ({ app: { getPath: () => '/tmp/superone-device-test' } }))

import { deviceEnvironment } from '../device/environment'
import { getIosSimulatorManager } from '../ios-simulator'
import { executeDeviceAgentTool } from './index'

describe('device_configure authorization', () => {
  afterEach(() => vi.restoreAllMocks())

  it('refuses a session with no device grant before reading or changing settings', async () => {
    const read = vi.spyOn(deviceEnvironment, 'read')
    const configure = vi.spyOn(deviceEnvironment, 'configure')
    const result = await executeDeviceAgentTool('session-without-grant', 'device_configure', {
      kind: 'appearance', appearance: 'dark', description: 'Set dark mode',
    })
    expect(result.isError).toBe(true)
    expect(result.content[0]?.text).toContain('NO_DEVICE')
    expect(read).not.toHaveBeenCalled()
    expect(configure).not.toHaveBeenCalled()
  })

  it('routes an approved session to the shared environment service', async () => {
    const manager = getIosSimulatorManager('/tmp/superone-device-test')
    vi.spyOn(manager, 'devicesOf').mockReturnValue(['sim-1'])
    vi.spyOn(manager, 'nameOf').mockReturnValue('iPhone')
    const configure = vi.spyOn(deviceEnvironment, 'configure').mockResolvedValue({
      status: 'verified', deviceId: 'ios-sim:sim-1',
      action: { kind: 'appearance', value: 'dark' },
      state: { deviceId: 'ios-sim:sim-1', appearance: 'dark', locationReadable: false,
        textSize: 'large', textSizeSupported: true,
        textSizeOptions: ['small', 'large'],
        canClearLocation: true, postures: [], posture: null },
    })
    const result = await executeDeviceAgentTool('session-with-grant', 'device_configure', {
      kind: 'appearance', appearance: 'dark', description: 'Set dark mode',
    })
    expect(result.isError).toBeUndefined()
    expect(configure).toHaveBeenCalledWith('ios-sim:sim-1', { kind: 'appearance', value: 'dark' })
  })

  it('routes a text size preset through the same controlled tool', async () => {
    const manager = getIosSimulatorManager('/tmp/superone-device-test')
    vi.spyOn(manager, 'devicesOf').mockReturnValue(['sim-1'])
    vi.spyOn(manager, 'nameOf').mockReturnValue('iPhone')
    const configure = vi.spyOn(deviceEnvironment, 'configure').mockResolvedValue({
      status: 'verified', deviceId: 'ios-sim:sim-1',
      action: { kind: 'text_size', value: 'accessibility-extra-extra-extra-large' },
      state: { deviceId: 'ios-sim:sim-1', appearance: 'dark', textSize: 'accessibility-extra-extra-extra-large',
        textSizeSupported: true, textSizeOptions: ['extra-large', 'accessibility-extra-extra-extra-large'],
        locationReadable: false, canClearLocation: true, postures: [], posture: null },
    })
    const result = await executeDeviceAgentTool('session-with-grant', 'device_configure', {
      kind: 'text_size', textSize: 'accessibility-extra-extra-extra-large', description: 'Increase system text size',
    })
    expect(result.isError).toBeUndefined()
    expect(configure).toHaveBeenCalledWith('ios-sim:sim-1', {
      kind: 'text_size', value: 'accessibility-extra-extra-extra-large',
    })
  })
})
