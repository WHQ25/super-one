/**
 * Android devices, and which chat session is driving each one.
 *
 * The counterpart to `IosSimulatorManager`, and deliberately much smaller: adb is the
 * transport, so there is no helper process to build, probe, attach or keep alive. What
 * is left is device discovery, session ownership, and getting a cold AVD to the point
 * where it answers.
 *
 * Booting is the one place Android is harder than iOS. `simctl boot <udid>` addresses
 * the device it starts; `emulator -avd X` starts a process that does NOT report the
 * adb port it ends up on. So a launch is followed by a search: wait for a serial to
 * appear, ask each new one its AVD name, and only then know which device was started.
 */

import type { DeviceDescriptor } from '@superone/shared/device'
import log from '../../logger'
import { Adb, adbPath, emulatorPath, spawnTool, type AdbDevice } from './adb'
import { Avd, parseEmuResponse, type AvdLaunch, type AvdSummary } from './avd'
import {
  avdDeviceId,
  mergeAndroidDevices,
  serialDeviceId,
  type AndroidRuntimeInfo,
} from './device-discovery'

/** How long a cold emulator gets to appear on adb and finish booting. */
const BOOT_TIMEOUT_MS = 180_000
const BOOT_POLL_MS = 1_000

export interface AndroidToolchain {
  adb: Adb
  avd: Avd
}

/** Stands in for the emulator binary when only platform-tools is installed. */
const notInstalled = async () => ({ stdout: Buffer.from(''), stderr: '', code: 0 })

/** Locate the SDK and build the two clients. Null when there is no SDK to find. */
export function detectAndroidToolchain(env?: NodeJS.ProcessEnv): AndroidToolchain | null {
  const adbBinary = adbPath(env)
  if (!adbBinary) return null
  const adb = new Adb(spawnTool(adbBinary, 'adb'))
  const emulatorBinary = emulatorPath(env)
  // adb without the emulator package is a real configuration — a machine set up only
  // to work with physical devices. Everything except the AVD list still works, so it
  // degrades to an empty list rather than reporting no Android at all.
  const avd = new Avd(emulatorBinary ?? '', emulatorBinary ? spawnTool(emulatorBinary, 'emulator') : notInstalled)
  return { adb, avd }
}

export class AndroidDeviceManager {
  private readonly sessionBindings = new Map<string, string>()
  private readonly deviceOwners = new Map<string, string>()
  /** Device id -> adb serial, for the ones that are up. */
  private readonly serials = new Map<string, string>()
  /** AVDs this app started, so it can shut down only what it is responsible for. */
  private readonly launched = new Map<string, AvdLaunch>()
  private lastDevices: DeviceDescriptor[] = []

  constructor(private readonly toolchain: AndroidToolchain) {}

  /**
   * Ask a running device who it is.
   *
   * Four round trips, run together. Each is ~30ms over adb and they are independent,
   * so doing them in sequence would make listing a machine with three devices feel
   * like half a second of nothing.
   */
  private async readRuntimeInfo(serial: string): Promise<AndroidRuntimeInfo> {
    const { adb } = this.toolchain
    const [avdName, sdk, model, characteristics] = await Promise.all([
      // Only an emulator answers this, which is how an AVD is told apart from a phone
      // without having to ask anything else.
      this.avdNameOf(serial).catch(() => null),
      adb.getProp(serial, 'ro.build.version.sdk').catch(() => ''),
      adb.getProp(serial, 'ro.product.model').catch(() => ''),
      adb.getProp(serial, 'ro.build.characteristics').catch(() => ''),
    ])
    const apiLevel = Number.parseInt(sdk, 10)
    return {
      serial,
      ...(avdName ? { avdId: avdName } : {}),
      ...(Number.isInteger(apiLevel) && apiLevel > 0 ? { apiLevel } : {}),
      ...(model ? { model } : {}),
      ...(characteristics ? { characteristics } : {}),
    }
  }

  /**
   * The AVD behind an emulator serial. Null for a physical device.
   *
   * The serial prefix is checked first only to save a round trip: a phone would fail
   * the console command anyway, but it would take a timeout to find out.
   */
  private async avdNameOf(serial: string): Promise<string | null> {
    if (!serial.startsWith('emulator-')) return null
    const output = await this.toolchain.adb.emu(serial, ['avd', 'name']).catch(() => '')
    return parseEmuResponse(output)
  }

  async listDevices(signal?: AbortSignal): Promise<DeviceDescriptor[]> {
    const { adb, avd } = this.toolchain
    const [avds, attached] = await Promise.all([
      avd.list(signal).catch((error: unknown) => {
        log.warn('[android] AVD list failed', error)
        return [] as AvdSummary[]
      }),
      adb.devices(signal).catch((error: unknown) => {
        log.warn('[android] adb devices failed', error)
        return [] as AdbDevice[]
      }),
    ])

    const runtime = new Map<string, AndroidRuntimeInfo>()
    await Promise.all(attached
      // An unauthorized or offline device answers nothing, and asking costs a timeout
      // each. It still appears in the catalog — see `descriptorForPhysical`.
      .filter((device) => device.state === 'device')
      .map(async (device) => {
        runtime.set(device.serial, await this.readRuntimeInfo(device.serial).catch(() => ({
          serial: device.serial,
        })))
      }))

    const devices = mergeAndroidDevices({
      avds,
      attached,
      runtime,
      owners: this.deviceOwners,
    })
    this.rememberSerials(devices, runtime)
    this.lastDevices = devices
    return devices
  }

  /** Keep the id -> serial map current, so an action can address what it was granted. */
  private rememberSerials(
    devices: readonly DeviceDescriptor[],
    runtime: ReadonlyMap<string, AndroidRuntimeInfo>,
  ): void {
    this.serials.clear()
    for (const info of runtime.values()) {
      const id = info.avdId ? avdDeviceId(info.avdId) : serialDeviceId(info.serial)
      if (devices.some((device) => device.id === id)) this.serials.set(id, info.serial)
    }
  }

  /** The adb serial for a device id, if it is up. */
  serialFor(deviceId: string): string | null {
    return this.serials.get(deviceId) ?? null
  }

  controlled(sessionId: string): DeviceDescriptor | null {
    const id = this.sessionBindings.get(sessionId)
    if (!id) return null
    return this.lastDevices.find((device) => device.id === id) ?? null
  }

  /**
   * Give this session the device, starting it if it is not already up.
   *
   * Taking a device another session holds is allowed — the user was asked — so the
   * previous owner is simply dropped. That mirrors the simulator, where the same
   * transfer is what the prompt warns about.
   */
  async boot(
    sessionId: string,
    deviceId: string,
    signal?: AbortSignal,
  ): Promise<DeviceDescriptor | null> {
    let serial = this.serialFor(deviceId)
    if (!serial) {
      const avdId = avdIdFromDeviceId(deviceId)
      if (!avdId) return null
      serial = await this.launchAndFind(avdId, signal)
      if (!serial) return null
    }
    await this.waitForBoot(serial, signal)

    const devices = await this.listDevices(signal)
    const device = devices.find((candidate) => candidate.id === deviceId)
    if (!device) return null

    this.bind(sessionId, deviceId)
    // Re-read so the descriptor handed back carries the ownership just recorded,
    // rather than the state from a moment before the grant.
    return { ...device, boundSessionId: sessionId }
  }

  private bind(sessionId: string, deviceId: string): void {
    const previous = this.sessionBindings.get(sessionId)
    if (previous) this.deviceOwners.delete(previous)
    const displaced = this.deviceOwners.get(deviceId)
    if (displaced) this.sessionBindings.delete(displaced)
    this.sessionBindings.set(sessionId, deviceId)
    this.deviceOwners.set(deviceId, sessionId)
  }

  release(sessionId: string): void {
    const deviceId = this.sessionBindings.get(sessionId)
    this.sessionBindings.delete(sessionId)
    if (deviceId) this.deviceOwners.delete(deviceId)
  }

  /**
   * Start an AVD and work out which serial it landed on.
   *
   * The search is the point: `emulator -avd` does not report its port, so the only way
   * to know is to watch adb for a serial that was not there before and ask it its
   * name. Serials are also reused — an emulator that just died frees 5554 for the next
   * one — so matching on the AVD name rather than on "a serial I had not seen" is what
   * keeps this from binding to the wrong device.
   */
  private async launchAndFind(avdId: string, signal?: AbortSignal): Promise<string | null> {
    const launch = this.toolchain.avd.launch(avdId)
    this.launched.set(avdId, launch)
    let exited = false
    void launch.exited.then(() => { exited = true })

    const deadline = Date.now() + BOOT_TIMEOUT_MS
    while (Date.now() < deadline) {
      if (signal?.aborted) break
      if (exited) {
        log.warn('[android] emulator exited before it reached adb', avdId)
        return null
      }
      const attached = await this.toolchain.adb.devices(signal).catch(() => [])
      for (const device of attached) {
        if (device.state !== 'device' && device.state !== 'offline') continue
        const name = await this.avdNameOf(device.serial).catch(() => null)
        if (name === avdId) return device.serial
      }
      await delay(BOOT_POLL_MS, signal)
    }
    log.warn('[android] emulator never appeared on adb', avdId)
    return null
  }

  /** Wait until the device has finished booting, not merely until adb can see it. */
  private async waitForBoot(serial: string, signal?: AbortSignal): Promise<void> {
    const deadline = Date.now() + BOOT_TIMEOUT_MS
    while (Date.now() < deadline) {
      if (signal?.aborted) return
      const ready = await this.toolchain.adb
        .getProp(serial, 'sys.boot_completed')
        .catch(() => '')
      // The property is absent, then "", then "1". Anything else means still booting —
      // and `adb wait-for-device` returns long before this does, which is exactly the
      // trap: the device answers while its UI does not yet exist.
      if (ready.trim() === '1') return
      await delay(BOOT_POLL_MS, signal)
    }
  }

  /** Shut down only the emulators this app started. */
  async dispose(): Promise<void> {
    for (const launch of this.launched.values()) launch.stop()
    this.launched.clear()
    this.sessionBindings.clear()
    this.deviceOwners.clear()
    this.serials.clear()
  }
}

/** `android:avd:Medium_Phone_API_36.1` -> `Medium_Phone_API_36.1`. */
export function avdIdFromDeviceId(deviceId: string): string | null {
  const match = /^android:avd:(.+)$/.exec(deviceId)
  return match ? match[1]! : null
}

function delay(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    const timer = setTimeout(resolve, ms)
    signal?.addEventListener('abort', () => {
      clearTimeout(timer)
      resolve()
    }, { once: true })
  })
}
