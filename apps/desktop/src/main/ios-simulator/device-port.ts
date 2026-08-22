/**
 * The iOS Simulator, as the device catalog and the control grant see it.
 *
 * Everything here is knowledge only this platform has: that a device's family is read
 * from a `com.apple.CoreSimulator.SimDeviceType.*` identifier rather than its name,
 * that one model is installed once per runtime, and that `xcrun simctl` is how a
 * build gets onto it. The catalog above consumes only `DeviceDescriptor` and never
 * learns any of it.
 */

import { formatDeviceId, parseDeviceId, type DeviceDescriptor } from '@superone/shared/device'
import type { IosSimulatorDevice } from '@superone/shared/ios-simulator'
import type { DevicePlatformPort } from '../device/platform-port'

/** The slice of `IosSimulatorManager` this needs, so tests need no Electron. */
export interface IosSimulatorCatalogSource {
  listDevices(): Promise<IosSimulatorDevice[]>
  getSessionState(
    sessionId: string,
    devices?: IosSimulatorDevice[],
  ): Promise<{ phase: string; device?: IosSimulatorDevice | null }>
  boot(
    sessionId: string,
    udid: string,
  ): Promise<{ phase: string; device?: IosSimulatorDevice | null }>
}

const KINDS: Array<{ kind: string; name: string; match: RegExp }> = [
  { kind: 'iphone', name: 'iPhone', match: /iphone/i },
  { kind: 'ipad', name: 'iPad', match: /ipad/i },
  { kind: 'watch', name: 'Apple Watch', match: /watch/i },
  { kind: 'tv', name: 'Apple TV', match: /(apple-?)?tv/i },
  { kind: 'vision', name: 'Apple Vision', match: /vision/i },
]

/**
 * Which family a device belongs to.
 *
 * Read from the device TYPE identifier, not the name: names are user-editable, and a
 * simulator renamed "checkout rig" still has to land under iPhone.
 */
export function deviceKind(
  device: IosSimulatorDevice,
): { kind: string; name: string; rank: number } {
  const subject = device.deviceTypeIdentifier ?? device.name
  const index = KINDS.findIndex((entry) => entry.match.test(subject))
  const hit = KINDS[index]
  // Unmatched sorts last rather than first: an unrecognized device type is the least
  // likely thing anyone is looking for, and it would otherwise head the overview.
  return hit
    ? { kind: hit.kind, name: hit.name, rank: index }
    : { kind: 'other', name: 'Other', rank: KINDS.length }
}

/**
 * The model a device is, independent of what it was named or which runtime it runs.
 *
 * This is the axis the cartesian product collapses along: one "iPhone 17 Pro Max"
 * standing for the ten runtimes it is installed for.
 */
export function deviceModel(device: IosSimulatorDevice): string {
  const tail = device.deviceTypeIdentifier?.split('.').pop()
  return tail ? tail.replace(/-/g, ' ') : device.name
}

/**
 * Newest runtime first, as a sortable number.
 *
 * `iOS-26-4` and `iOS-17-10` have to order by version rather than by string, or a
 * bare model name resolves to a four-year-old runtime that merely sorts late.
 */
export function runtimeRank(device: IosSimulatorDevice): number {
  const tail = device.runtimeIdentifier.split('.').pop() ?? ''
  const parts = tail.match(/\d+/g)?.map(Number) ?? []
  return (parts[0] ?? 0) * 10_000 + (parts[1] ?? 0) * 100 + (parts[2] ?? 0)
}

export function toDeviceDescriptor(device: IosSimulatorDevice): DeviceDescriptor {
  const { kind, name: kindName, rank: kindRank } = deviceKind(device)
  return {
    id: formatDeviceId('ios-sim', device.udid),
    provider: 'ios-sim',
    platform: 'ios',
    name: device.name,
    kind,
    kindName,
    kindRank,
    model: deviceModel(device),
    platformVersion: device.runtimeName,
    versionRank: runtimeRank(device),
    running: device.booted,
    available: device.available,
    ...(device.boundSessionId ? { boundSessionId: device.boundSessionId } : {}),
  }
}

export class IosSimulatorDevicePort implements DevicePlatformPort {
  readonly platform = 'ios' as const

  /**
   * The raw devices behind the last `listDevices`.
   *
   * Kept so `controlled` can hand them straight back to the manager. Reading the
   * session state makes the manager enumerate the catalog itself when it is not given
   * one, and the catalog flow calls both in sequence — without this, every
   * `device_list` would spawn `simctl list devices` twice.
   */
  private lastListed: IosSimulatorDevice[] = []

  constructor(private readonly source: IosSimulatorCatalogSource) {}

  async listDevices(): Promise<DeviceDescriptor[]> {
    const devices = await this.source.listDevices()
    this.lastListed = devices
    return devices.map(toDeviceDescriptor)
  }

  async controlled(
    sessionId: string,
    devices?: DeviceDescriptor[],
  ): Promise<DeviceDescriptor | null> {
    // A caller passing `devices` is telling us it just listed them, so the raw copy
    // cached above is the same generation and is safe to reuse.
    const state = devices
      ? await this.source.getSessionState(sessionId, this.lastListed)
      : await this.source.getSessionState(sessionId)
    return state.phase === 'ready' && state.device ? toDeviceDescriptor(state.device) : null
  }

  async boot(sessionId: string, deviceId: string): Promise<DeviceDescriptor | null> {
    const udid = parseDeviceId(deviceId)?.native ?? deviceId
    const state = await this.source.boot(sessionId, udid)
    return state.phase === 'ready' && state.device ? toDeviceDescriptor(state.device) : null
  }

  controlNote(device: DeviceDescriptor): string {
    const udid = parseDeviceId(device.id)?.native ?? device.id
    return `This session now controls the device. Install a build with \`xcrun simctl install ${udid} <path/to/.app>\` `
      + `and launch it with \`xcrun simctl launch ${udid} <bundle-id>\`, then use device_snapshot to see the screen. `
      // The user is already watching this device here, so a command whose ONLY effect
      // is to show Apple's Simulator window is pure duplication -- and one that merely
      // un-hides an app the host had hidden is not something the host can quietly undo.
      // Scoped to exactly those two: build-and-run commands (`flutter run`,
      // `expo run:ios`) are real work and stay allowed, and neither of them puts a
      // window up that this app cannot deal with on its own.
      + 'The device is already booted and visible in this session, so never run a command whose only '
      + 'job is to show Apple\'s Simulator window — no `open -a Simulator`, no `flutter emulators --launch`. '
      + 'Build-and-run commands are fine.'
  }

  emptyNote(installed: number): string {
    return installed === 0
      ? 'No simulators exist on this machine. Create one in Xcode (or the Activity panel) first.'
      : 'Every simulator on this machine is unavailable — its runtime is probably not installed.'
  }
}
