import { describe, expect, it, vi } from 'vitest'
import type { IosSimulatorFoldPosition } from '@superone/shared/ios-simulator'
import type { SimctlClient } from '../ios-simulator/simctl'
import type { Adb } from './android/adb'
import { DeviceEnvironmentService, parsePostureOptions } from './environment'

function fixture() {
  const ios = {
    listDevices: vi.fn(async () => [{ udid: 'sim-1', booted: true, runtimeIdentifier: 'com.apple.CoreSimulator.SimRuntime.iOS-26-5' }]),
    appearance: vi.fn(async () => 'dark' as const),
    setAppearance: vi.fn(async () => {}),
    contentSize: vi.fn(async () => 'large'),
    setContentSize: vi.fn(async () => {}),
    setLocation: vi.fn(async () => {}),
    clearLocation: vi.fn(async () => {}),
  }
  const adb = {
    shell: vi.fn(async (_serial: string, args: string[]) =>
      args[0] === 'getprop' ? '34\n'
        : args[0] === 'settings' && args[1] === 'get' ? '1.3\n' : 'Night mode: yes\n'),
    emu: vi.fn(async (_serial: string, args: string[]) =>
      args[0] === 'posture' && args.length === 1
        ? 'KO: Usage: "posture <posture_id>" 1: closed\t2: half-opened\t3: opened\n'
        : 'OK\n'),
  }
  // Single-screen unless a test says otherwise.
  const fold = {
    foldPosition: vi.fn(async (): Promise<IosSimulatorFoldPosition | null> => null),
    setFoldPosition: vi.fn(async (_udid: string, _target: IosSimulatorFoldPosition) => {}),
  }
  const environment = new DeviceEnvironmentService(ios as unknown as SimctlClient,
    () => ({ serial: 'emulator-5554', adb: adb as unknown as Adb }), () => fold)
  return { ios, adb, fold, environment }
}

describe('device environment', () => {
  it('reads only advertised emulator postures, and never invents location or posture state', async () => {
    const { environment } = fixture()
    expect(parsePostureOptions('KO: unknown command')).toEqual([])
    expect(await environment.read('android:avd:Pixel_Fold')).toEqual({
      deviceId: 'android:avd:Pixel_Fold', appearance: 'dark', textSize: '1.3', textSizeSupported: true,
      textSizeOptions: ['0.85', '1', '1.15', '1.3', '1.5', '1.8', '2'],
      locationReadable: false,
      canClearLocation: false, postures: [
        { id: 1, label: 'closed' }, { id: 2, label: 'half opened' }, { id: 3, label: 'opened' },
      ], posture: null, hingeDegrees: null,
    })
  })

  it('reads and verifies iOS content size and Android font scale', async () => {
    const { environment, ios, adb } = fixture()
    expect((await environment.read('ios-sim:sim-1')).textSize).toBe('large')
    expect((await environment.read('android:avd:Pixel_Fold')).textSize).toBe('1.3')
    ios.contentSize.mockResolvedValue('accessibility-extra-extra-extra-large')
    expect((await environment.configure('ios-sim:sim-1', {
      kind: 'text_size', value: 'accessibility-extra-extra-extra-large',
    })).status)
      .toBe('verified')
    expect(ios.setContentSize).toHaveBeenCalledWith('sim-1', 'accessibility-extra-extra-extra-large')
    adb.shell.mockImplementation(async (_serial, args) => args[0] === 'getprop' ? '34\n'
      : args[0] === 'settings' && args[1] === 'get' ? '2\n' : 'Night mode: yes\n')
    expect((await environment.configure('android:avd:Pixel_Fold', { kind: 'text_size', value: '2' })).status)
      .toBe('verified')
    expect(adb.shell).toHaveBeenCalledWith('emulator-5554', ['settings', 'put', 'system', 'font_scale', '2'])
    await expect(environment.configure('android:avd:Pixel_Fold', { kind: 'text_size', value: '3' }))
      .rejects.toThrow('UNSUPPORTED')
    ios.contentSize.mockResolvedValue('unsupported')
    expect((await environment.read('ios-sim:sim-1')).textSizeSupported).toBe(false)
    await expect(environment.configure('ios-sim:sim-1', { kind: 'text_size', value: 'large' }))
      .rejects.toThrow('UNSUPPORTED')
  })

  it('limits older Android emulators to their available system font-size stops', async () => {
    const { environment, adb } = fixture()
    adb.shell.mockImplementation(async (_serial, args) => args[0] === 'getprop' ? '33\n'
      : args[0] === 'settings' && args[1] === 'get' ? '1\n' : 'Night mode: no\n')
    expect((await environment.read('android:avd:Pixel_Fold')).textSizeOptions)
      .toEqual(['0.85', '1', '1.15', '1.3'])
    await expect(environment.configure('android:avd:Pixel_Fold', { kind: 'text_size', value: '2' }))
      .rejects.toThrow('UNSUPPORTED')
  })

  it('validates coordinates and sends the platform-specific order as argv', async () => {
    const { environment, ios, adb } = fixture()
    await environment.configure('ios-sim:sim-1', { kind: 'location', latitude: 31.2, longitude: 121.5 })
    expect(ios.setLocation).toHaveBeenCalledWith('sim-1', 31.2, 121.5)
    await environment.configure('android:avd:Pixel_Fold', { kind: 'location', latitude: 31.2, longitude: 121.5 })
    expect(adb.emu).toHaveBeenCalledWith('emulator-5554', ['geo', 'fix', '121.5', '31.2'])
    await expect(environment.configure('android:avd:Pixel_Fold', {
      kind: 'location', latitude: 91, longitude: 0,
    })).rejects.toThrow('Latitude')
    expect(adb.emu).toHaveBeenCalledTimes(2) // one posture read after a successful set
  })

  it('clears only iOS location and rejects unsupported devices', async () => {
    const { environment, ios, adb } = fixture()
    await environment.configure('ios-sim:sim-1', { kind: 'clear_location' })
    expect(ios.clearLocation).toHaveBeenCalledWith('sim-1')
    await expect(environment.configure('android:avd:Pixel_Fold', { kind: 'clear_location' }))
      .rejects.toThrow('UNSUPPORTED')
    await expect(environment.read('ios-mirror:phone')).rejects.toThrow('UNSUPPORTED')
    expect(adb.emu).not.toHaveBeenCalled()
    ios.listDevices.mockResolvedValueOnce([{
      udid: 'sim-1', booted: true, runtimeIdentifier: 'com.apple.CoreSimulator.SimRuntime.watchOS-11-0',
    }])
    await expect(environment.read('ios-sim:sim-1')).rejects.toThrow('UNSUPPORTED')
    const physical = new DeviceEnvironmentService(ios as unknown as SimctlClient,
      () => ({ serial: 'ABC123', adb: adb as unknown as Adb }))
    await expect(physical.read('android:ABC123')).rejects.toThrow('UNSUPPORTED')
  })

  it('offers a foldable simulator the emulator posture ids, with the current one and its angle', async () => {
    const { environment, fold } = fixture()
    const single = await environment.read('ios-sim:sim-1')
    expect(single.postures).toEqual([])
    expect(single.hingeDegrees).toBeNull()

    fold.foldPosition.mockResolvedValue({ hingeDegrees: 45, tent: false })
    const state = await environment.read('ios-sim:sim-1')

    expect(state.postures).toEqual([
      { id: 1, label: 'closed' }, { id: 2, label: 'half opened' }, { id: 3, label: 'opened' }, { id: 5, label: 'tent' },
    ])
    // Unlike the emulator console, the host moved this hinge and knows where it is;
    // any angle short of either end reads as half open.
    expect(state.posture).toBe(2)
    expect(state.hingeDegrees).toBe(45)
  })

  it('moves a foldable simulator\'s hinge and refuses ids it does not have', async () => {
    const { environment, fold } = fixture()
    fold.foldPosition.mockResolvedValue({ hingeDegrees: 0, tent: false })
    fold.setFoldPosition.mockImplementation(async (_udid, target) => { fold.foldPosition.mockResolvedValue(target) })

    const result = await environment.configure('ios-sim:sim-1', { kind: 'posture', id: 3 })

    expect(fold.setFoldPosition).toHaveBeenCalledWith('sim-1', { hingeDegrees: 180, tent: false }, { hold: true })
    // Read back from the host, so it is verified rather than merely delivered.
    expect(result.status).toBe('verified')
    await expect(environment.configure('ios-sim:sim-1', { kind: 'posture', id: 4 }))
      .rejects.toThrow(/UNSUPPORTED: Posture 4/)

    const hinge = await environment.configure('ios-sim:sim-1', { kind: 'hinge', degrees: 120 })
    expect(fold.setFoldPosition).toHaveBeenLastCalledWith('sim-1', { hingeDegrees: 120, tent: false })
    expect(hinge.status).toBe('verified')

    // A tent is the emulator's posture 5, read back as itself.
    const tent = await environment.configure('ios-sim:sim-1', { kind: 'posture', id: 5 })
    expect(fold.setFoldPosition).toHaveBeenLastCalledWith('sim-1', { hingeDegrees: 60, tent: true }, { hold: true })
    expect(tent.state.posture).toBe(5)
    expect(tent.status).toBe('verified')

    // The angle alone picks the form: 0 closed, up to 60 a tent, wider open.
    await environment.configure('ios-sim:sim-1', { kind: 'hinge', degrees: 40 })
    expect(fold.setFoldPosition).toHaveBeenLastCalledWith('sim-1', { hingeDegrees: 40, tent: true })
    await environment.configure('ios-sim:sim-1', { kind: 'hinge', degrees: 61 })
    expect(fold.setFoldPosition).toHaveBeenLastCalledWith('sim-1', { hingeDegrees: 61, tent: false })
    await environment.configure('ios-sim:sim-1', { kind: 'hinge', degrees: 0 })
    expect(fold.setFoldPosition).toHaveBeenLastCalledWith('sim-1', { hingeDegrees: 0, tent: false })
    await expect(environment.configure('ios-sim:sim-1', { kind: 'hinge', degrees: 181 }))
      .rejects.toThrow(/between 0 and 180/)
    await expect(environment.configure('android:avd:Pixel_Fold', { kind: 'hinge', degrees: 120 }))
      .rejects.toThrow(/UNSUPPORTED/)
  })

  it('validates dynamic posture ids and treats KO as failure', async () => {
    const { environment, adb } = fixture()
    await expect(environment.configure('android:avd:Pixel_Fold', { kind: 'posture', id: 5 }))
      .rejects.toThrow('UNSUPPORTED')
    expect(adb.emu).not.toHaveBeenCalledWith('emulator-5554', ['posture', '5'])
    adb.emu.mockImplementation(async (_serial, args) => args.length === 1
      ? 'KO: Usage: "posture <posture_id>" 1: closed 2: half-opened\n'
      : 'KO: Failed to set posture\n')
    await expect(environment.configure('android:avd:Pixel_Fold', { kind: 'posture', id: 2 }))
      .rejects.toThrow('KO: Failed')
    adb.emu.mockImplementation(async (_serial, args) => args.length === 1
      ? 'KO: Usage: "posture <posture_id>" 1: closed 2: half-opened\n'
      : '')
    await expect(environment.configure('android:avd:Pixel_Fold', { kind: 'posture', id: 2 }))
      .rejects.toThrow('did not confirm')
  })

  it('notifies listeners after a successful change only', async () => {
    const { environment } = fixture()
    const changed = vi.fn()
    environment.onChange(changed)
    expect((await environment.configure('ios-sim:sim-1', { kind: 'appearance', value: 'dark' })).status)
      .toBe('verified')
    expect(changed).toHaveBeenCalledWith('ios-sim:sim-1')
    await expect(environment.configure('ios-sim:sim-1', { kind: 'location', latitude: Infinity, longitude: 0 }))
      .rejects.toThrow()
    expect(changed).toHaveBeenCalledTimes(1)
  })

  it('treats a shell error message as a failed appearance change', async () => {
    const { environment, adb } = fixture()
    adb.shell.mockResolvedValue('Error: unknown command night')
    await expect(environment.configure('android:avd:Pixel_Fold', { kind: 'appearance', value: 'dark' }))
      .rejects.toThrow('Error: unknown command')
  })

  it('reports a read-back mismatch instead of claiming the appearance changed', async () => {
    const { environment } = fixture()
    await expect(environment.configure('ios-sim:sim-1', { kind: 'appearance', value: 'light' }))
      .rejects.toThrow('still reports dark')
  })
})
