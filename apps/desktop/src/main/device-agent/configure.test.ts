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
        canClearLocation: true, postures: [], posture: null, hingeDegrees: null },
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
        locationReadable: false, canClearLocation: true, postures: [], posture: null, hingeDegrees: null },
    })
    const result = await executeDeviceAgentTool('session-with-grant', 'device_configure', {
      kind: 'text_size', textSize: 'accessibility-extra-extra-extra-large', description: 'Increase system text size',
    })
    expect(result.isError).toBeUndefined()
    expect(configure).toHaveBeenCalledWith('ios-sim:sim-1', {
      kind: 'text_size', value: 'accessibility-extra-extra-extra-large',
    })
  })

  it('routes an exact hinge angle, and refuses a hinge call without one', async () => {
    const manager = getIosSimulatorManager('/tmp/superone-device-test')
    vi.spyOn(manager, 'devicesOf').mockReturnValue(['sim-1'])
    vi.spyOn(manager, 'nameOf').mockReturnValue('iPhone Duo')
    const configure = vi.spyOn(deviceEnvironment, 'configure').mockResolvedValue({
      status: 'verified', deviceId: 'ios-sim:sim-1',
      action: { kind: 'hinge', degrees: 120 },
      state: { deviceId: 'ios-sim:sim-1', appearance: 'dark', textSize: 'large',
        textSizeSupported: true, textSizeOptions: ['large'], locationReadable: false, canClearLocation: true,
        postures: [{ id: 1, label: 'closed' }, { id: 2, label: 'half opened' }, { id: 3, label: 'opened' }],
        posture: 2, hingeDegrees: 120 },
    })
    const result = await executeDeviceAgentTool('session-with-grant', 'device_configure', {
      kind: 'hinge', hingeDegrees: 120, description: 'Open the hinge to 120°',
    })
    expect(result.isError).toBeUndefined()
    expect(configure).toHaveBeenCalledWith('ios-sim:sim-1', { kind: 'hinge', degrees: 120 })

    const missing = await executeDeviceAgentTool('session-with-grant', 'device_configure', {
      kind: 'hinge', description: 'Open the hinge',
    })
    expect(missing.isError).toBe(true)
    expect(missing.content[0]?.text).toContain('INVALID_ACTION')
  })
})
