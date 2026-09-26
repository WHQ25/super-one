import { parseDeviceId } from '@superone/shared/device'
import type {
  DeviceAppearance,
  DeviceEnvironmentAction,
  DeviceEnvironmentResult,
  DeviceEnvironmentState,
  DevicePostureOption,
} from '@superone/shared/device-environment'
import { ANDROID_FONT_SCALES, IOS_CONTENT_SIZES } from '@superone/shared/device-environment'
import { SimctlClient } from '../ios-simulator/simctl'
import { getAndroidDeviceManager } from './android'
import type { Adb } from './android/adb'

interface AndroidTarget { serial: string; adb: Adb }
type IosCommands = Pick<SimctlClient, 'listDevices' | 'appearance' | 'setAppearance' | 'contentSize' | 'setContentSize' | 'setLocation' | 'clearLocation'>

async function androidTextSizeOptions(adb: Adb, serial: string): Promise<string[]> {
  const apiLevel = Number((await adb.shell(serial, ['getprop', 'ro.build.version.sdk'])).trim())
  // Earlier Settings screens stop at 130%; Android 14+ exposes 200%.
  return [...ANDROID_FONT_SCALES.slice(0, apiLevel >= 34 ? undefined : 4)]
}

function androidTarget(deviceId: string): AndroidTarget | null {
  const manager = getAndroidDeviceManager()
  const serial = manager?.serialFor(deviceId)
  return serial ? { serial, adb: manager!.adb } : null
}

/** `adb emu posture` prints a usage line containing only this AVD's available ids. */
export function parsePostureOptions(output: string): DevicePostureOption[] {
  const options = new Map<number, string>()
  for (const match of output.matchAll(/(?:^|\s)(\d+):\s*([\w-]+)/g)) {
    const id = Number(match[1])
    if (id > 0 && Number.isSafeInteger(id)) options.set(id, match[2]!.replaceAll('-', ' '))
  }
  return [...options].map(([id, label]) => ({ id, label }))
}

function appearanceFromAndroid(output: string): DeviceAppearance | null {
  const mode = /(?:night mode|mode):\s*(yes|no|dark|light)\b/i.exec(output)?.[1]?.toLowerCase()
  if (mode === 'yes' || mode === 'dark') return 'dark'
  if (mode === 'no' || mode === 'light') return 'light'
  return null
}

function ensureEmulatorReply(output: string): void {
  const lines = output.split(/\r?\n/).map((line) => line.trim())
  const failure = lines.find((line) => /^KO\b/i.test(line))
  if (failure) throw new Error(failure.trim())
  if (!lines.includes('OK')) throw new Error('The emulator did not confirm the command.')
}

function ensureAndroidShellReply(output: string): void {
  const failure = output.split(/\r?\n/).find((line) => /^(?:error:|unknown command\b)/i.test(line.trim()))
  if (failure) throw new Error(failure.trim())
}

function coordinates(action: Extract<DeviceEnvironmentAction, { kind: 'location' }>): void {
  if (!Number.isFinite(action.latitude) || action.latitude < -90 || action.latitude > 90
    || !Number.isFinite(action.longitude) || action.longitude < -180 || action.longitude > 180) {
    throw new Error('Latitude must be between -90 and 90, and longitude between -180 and 180.')
  }
}

export class DeviceEnvironmentService {
  private readonly listeners = new Set<(deviceId: string) => void>()

  constructor(
    private readonly ios: IosCommands = new SimctlClient(),
    private readonly targetForAndroid: (deviceId: string) => AndroidTarget | null = androidTarget,
  ) {}

  onChange(listener: (deviceId: string) => void): () => void {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  private target(deviceId: string): { provider: 'ios-sim'; udid: string } | { provider: 'android'; target: AndroidTarget } {
    const parsed = parseDeviceId(deviceId)
    if (parsed?.provider === 'ios-sim') return { provider: 'ios-sim', udid: parsed.native }
    if (parsed?.provider === 'android') {
      const target = this.targetForAndroid(deviceId)
      if (!target) throw new Error(`Android device ${deviceId} is not running.`)
      if (target.serial.startsWith('emulator-')) return { provider: 'android', target }
    }
    throw new Error(`UNSUPPORTED: Device environment controls require a running iOS Simulator or Android Emulator (${deviceId}).`)
  }

  private async requireIosRuntime(udid: string): Promise<void> {
    const device = (await this.ios.listDevices()).find((candidate) => candidate.udid === udid)
    if (!device?.booted) throw new Error(`Simulator ${udid} is not running.`)
    if (!device.runtimeIdentifier.includes('SimRuntime.iOS-')) {
      throw new Error('UNSUPPORTED: These environment controls require an iPhone or iPad iOS Simulator.')
    }
  }

  async read(deviceId: string): Promise<DeviceEnvironmentState> {
    const target = this.target(deviceId)
    if (target.provider === 'ios-sim') {
      await this.requireIosRuntime(target.udid)
      const [appearance, contentSize] = await Promise.all([
        this.ios.appearance(target.udid).catch(() => null),
        this.ios.contentSize(target.udid).catch(() => null),
      ])
      return { deviceId, appearance,
        textSize: contentSize && contentSize !== 'unknown' && contentSize !== 'unsupported' ? contentSize : null,
        textSizeSupported: contentSize !== 'unsupported',
        textSizeOptions: contentSize === 'unsupported' ? [] : [...IOS_CONTENT_SIZES],
        locationReadable: false, canClearLocation: true, postures: [], posture: null }
    }
    const { adb, serial } = target.target
    const [appearance, postures, fontScale, supportedTextSizes] = await Promise.all([
      adb.shell(serial, ['cmd', 'uimode', 'night'])
        .then(appearanceFromAndroid).catch(() => null),
      adb.emu(serial, ['posture']).then(parsePostureOptions).catch(() => []),
      adb.shell(serial, ['settings', 'get', 'system', 'font_scale']).catch(() => null),
      androidTextSizeOptions(adb, serial).catch(() => [...ANDROID_FONT_SCALES.slice(0, 4)]),
    ])
    const scale = Number(fontScale?.trim())
    const textSize = fontScale?.trim() && Number.isFinite(scale) && scale > 0 ? String(scale) : null
    const textSizeOptions = [...supportedTextSizes]
    if (textSize && scale >= 0.85 && scale <= Number(textSizeOptions.at(-1))
      && !textSizeOptions.includes(textSize)) {
      textSizeOptions.push(textSize)
      textSizeOptions.sort((a, b) => Number(a) - Number(b))
    }
    return { deviceId, appearance,
      textSize,
      textSizeSupported: true,
      textSizeOptions,
      locationReadable: false, canClearLocation: false, postures, posture: null }
  }

  async configure(deviceId: string, action: DeviceEnvironmentAction): Promise<DeviceEnvironmentResult> {
    const target = this.target(deviceId)
    if (action.kind === 'location') coordinates(action)
    if (action.kind === 'appearance' && action.value !== 'light' && action.value !== 'dark') {
      throw new Error('Appearance must be light or dark.')
    }
    if (action.kind === 'text_size' && typeof action.value !== 'string') {
      throw new Error('Text size must be one of this simulator’s available values.')
    }
    if (target.provider === 'ios-sim') {
      await this.requireIosRuntime(target.udid)
      if (action.kind === 'appearance') await this.ios.setAppearance(target.udid, action.value)
      else if (action.kind === 'text_size') {
        const current = await this.ios.contentSize(target.udid)
        if (current === 'unsupported') throw new Error('UNSUPPORTED: This iOS Simulator does not support text size changes.')
        if (!(IOS_CONTENT_SIZES as readonly string[]).includes(action.value)) {
          throw new Error(`UNSUPPORTED: Text size ${action.value} is not available on this iOS Simulator.`)
        }
        await this.ios.setContentSize(target.udid, action.value)
      }
      else if (action.kind === 'location') await this.ios.setLocation(target.udid, action.latitude, action.longitude)
      else if (action.kind === 'clear_location') await this.ios.clearLocation(target.udid)
      else throw new Error('UNSUPPORTED: Fold posture is available only on supported Android emulators.')
    } else {
      const { adb, serial } = target.target
      if (action.kind === 'clear_location') {
        throw new Error('UNSUPPORTED: Android Emulator has no equivalent clear-location command.')
      }
      if (action.kind === 'appearance') {
        ensureAndroidShellReply(await adb.shell(serial, ['cmd', 'uimode', 'night', action.value === 'dark' ? 'yes' : 'no']))
      } else if (action.kind === 'text_size') {
        const options = (await this.read(deviceId)).textSizeOptions
        if (!options.includes(action.value)) {
          throw new Error(`UNSUPPORTED: Text size ${action.value} is not available on this Android Emulator.`)
        }
        ensureAndroidShellReply(await adb.shell(serial, ['settings', 'put', 'system', 'font_scale', action.value]))
      } else if (action.kind === 'location') {
        // The emulator console expects longitude first; simctl expects latitude first.
        ensureEmulatorReply(await adb.emu(serial, ['geo', 'fix', String(action.longitude), String(action.latitude)]))
      } else {
        if (!Number.isSafeInteger(action.id)) throw new Error('Posture id must be an integer from this device.')
        const options = await this.read(deviceId)
        if (!options.postures.some((posture) => posture.id === action.id)) {
          throw new Error(`UNSUPPORTED: Posture ${action.id} is not available on this emulator. Refresh its options.`)
        }
        ensureEmulatorReply(await adb.emu(serial, ['posture', String(action.id)]))
      }
    }
    for (const listener of this.listeners) listener(deviceId)
    const state = await this.read(deviceId)
    if (action.kind === 'appearance' && state.appearance && state.appearance !== action.value) {
      throw new Error(`Appearance did not change: the device still reports ${state.appearance}.`)
    }
    if (action.kind === 'text_size' && state.textSize !== action.value) {
      throw new Error(`Text size did not change: the device reports ${state.textSize ?? 'an unknown value'}.`)
    }
    return {
      status: (action.kind === 'appearance' && state.appearance === action.value)
        || (action.kind === 'text_size' && state.textSize === action.value)
        ? 'verified' : 'applied',
      deviceId, action, state,
    }
  }
}

/** One event source for changes from the panel or any agent harness. */
export const deviceEnvironment = new DeviceEnvironmentService()
